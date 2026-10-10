/**
 * Purchase lines, from file / API / screen to published entries.
 *
 *   read      file rows → lines (chunks of 2,000, one INSERT … unnest each); every line keeps
 *             its problems (no amount, no date, facility not found…)
 *   prepare   suppliers registered and linked; duplicates of earlier uploads marked; lines
 *             grouped by description + supplier + account — decisions are made per group
 *   map       remembered choice → code in the file → clear description → supplier default →
 *             account default → weaker description match → (approved AI) → average factor;
 *             account type (capital / not a purchase) and the capital-goods list; overlap with
 *             other categories decided by default (fuel / energy excluded, travel moved…)
 *   calculate each line with the best factor (supplier, else spend-based) — chunks of 5,000;
 *             then groups ranked by emissions: the largest (company coverage, 95 %) wait for a
 *             person to confirm, the small tail is accepted as it is
 *   publish   ready lines summed into one entry per facility × period × category × spend
 *             category × method, each linked back to its lines
 *
 * Progress of a running job is written to the job row (its own transaction), so the screen
 * can follow it while the work runs.
 */
import { createHash } from 'node:crypto';
import { buildIndex, calcPurchase, chooseFx, classify, detectOverlap, normText, type ClassIndex, type FxMethod, type FxRate, type PriceIndex, type PurchaseContext, type SpendFactor, type UnitFactor } from '@ekotrace/calc';
import { platformTx, tenantTx, type Tx } from '../../db/pool.js';
import { config } from '../../config.js';
import { aiChoose } from '../../lib/aiMap.js';
import { scopeOf } from '../../lib/access.js';
import type { User } from '../../lib/auth.js';
import { cellText, detectKind, sheetRows, type Cell } from '../../lib/sheet.js';
import { normSupplier, readAmount, readBool, readDate, type Columns, type DateFormat, type Field } from './fields.js';
import { resolveSuppliers } from './supplierMatch.js';

export const MAX_LINES = 200_000;
const INSERT_CHUNK = 2000, CALC_CHUNK = 5000;
export const DEMO_SOURCE = 'DEMO-SPEND';

export interface BatchSettings {
  sheet?: string;
  headerRow: number;                 // index among the non-empty rows
  columns: Columns;
  dateFormat: DateFormat;
  currency: string;                  // when the file has no currency column
  facilityId?: string | null;        // the whole file (no facility column), or lines with no facility written
  period?: { year?: number; month?: string } | null; // when the file has no dates
  facilityMap?: Record<string, string>;
  includeDuplicates?: boolean;
}

export async function progress(jobId: number | undefined, stage: string, done: number, total?: number) {
  if (!jobId) return;
  await platformTx((c) => c.query('UPDATE job SET progress = $2 WHERE id = $1', [jobId, JSON.stringify({ stage, done, ...(total != null ? { total } : {}) })]));
}

// ------------------------------------------------------------------ lines --
export interface RawLine {
  date?: Cell; description?: Cell; amount?: Cell; currency?: Cell; quantity?: Cell; unit?: Cell; supplier?: Cell; category?: Cell;
  gl?: Cell; po?: Cell; facility?: Cell; supplierEf?: Cell; supplierEfUnit?: Cell; capital?: Cell; supplierRef?: Cell; supplierCountry?: Cell;
}
export interface LineIn {
  rowNo: number; description: string; categoryText: string | null; gl: string | null; po: string | null; supplierText: string | null; supplierNorm: string | null; supplierRef: string | null; supplierCountry: string | null;
  facilityId: string | null; facilityText: string | null; purchaseDate: string | null; periodStart: string | null; periodEnd: string | null;
  amount: number | null; currency: string | null; quantity: number | null; unit: string | null; supplierEf: number | null; supplierEfUnit: string | null;
  capital: boolean | null; problems: string[]; groupKey: string; fingerprint: string;
}
export interface Facilities { byName: Map<string, string>; ids: Set<string> }
const fnorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function loadFacilities(c: Tx): Promise<Facilities> {
  const rows = (await c.query(`SELECT id, name, location FROM org_node WHERE kind = 'facility' AND active`)).rows as { id: string; name: string }[];
  return { byName: new Map(rows.map((r) => [fnorm(r.name), r.id])), ids: new Set(rows.map((r) => r.id)) };
}
const monthEnd = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };

/** Lines with the same description, category text and account (vague descriptions are later split by supplier). */
export function groupKey(description: string, category: string | null, gl: string | null = null) {
  return `${normText(description) || '(blank)'}|${normText(category ?? '')}|${normText(gl ?? '')}`.slice(0, 330);
}

/** One raw row (file cells or API values) → a line ready to store, with its problems. */
export function buildLine(r: RawLine, rowNo: number, s: BatchSettings, fac: Facilities): LineIn {
  const problems: string[] = [];
  const description = cellText(r.description).slice(0, 1000);
  const categoryText = cellText(r.category).slice(0, 300) || null;
  const amt = readAmount(r.amount ?? null);
  const qty = r.quantity != null ? readAmount(r.quantity).value : null;
  let currency = (cellText(r.currency) || amt.currency || s.currency || '').toUpperCase();
  if (currency === 'DHS' || currency === 'DH' || currency === 'AED.') currency = 'AED';
  if (currency && !/^[A-Z]{3}$/.test(currency)) { problems.push(`Currency "${currency}" not recognised`); currency = ''; }
  // period
  const date = readDate(r.date ?? null, s.dateFormat);
  let periodStart: string | null = null, periodEnd: string | null = null;
  if (date) { periodStart = `${date.slice(0, 7)}-01`; periodEnd = monthEnd(date); }
  else if (s.period?.month) { periodStart = `${s.period.month}-01`; periodEnd = monthEnd(`${s.period.month}-01`); }
  else if (s.period?.year) { periodStart = `${s.period.year}-01-01`; periodEnd = `${s.period.year}-12-31`; }
  if (!periodStart) problems.push(cellText(r.date) ? `Date "${cellText(r.date)}" not read` : 'Date missing');
  // facility
  const ft = cellText(r.facility);
  let facilityId: string | null = null;
  if (ft) facilityId = s.facilityMap?.[ft] ?? (fac.ids.has(ft) ? ft : fac.byName.get(fnorm(ft)) ?? null);
  else facilityId = s.facilityId ?? null;
  if (!facilityId) problems.push(ft ? `Facility "${ft}" not found` : 'Facility missing');
  if (!description) problems.push('Description missing');
  if (amt.value == null && qty == null) problems.push(cellText(r.amount) ? `Amount "${cellText(r.amount)}" not read` : 'Amount missing');
  if (amt.value != null && !currency) problems.push('Currency missing');
  const supplierText = cellText(r.supplier).slice(0, 300) || null;
  const supplierNorm = supplierText ? normSupplier(supplierText) || null : null;
  const ef = r.supplierEf != null && cellText(r.supplierEf) !== '' ? readAmount(r.supplierEf).value : null;
  const fp = createHash('sha1').update([date ?? periodStart, amt.value, currency, supplierNorm, normText(description), cellText(r.po)].join('|')).digest('base64url').slice(0, 22);
  return {
    rowNo, description: description || '(no description)', categoryText, gl: cellText(r.gl).slice(0, 300) || null, po: cellText(r.po).slice(0, 120) || null,
    supplierText, supplierNorm, supplierRef: cellText(r.supplierRef).slice(0, 80) || null, supplierCountry: cellText(r.supplierCountry).slice(0, 80) || null, facilityId, facilityText: ft || null, purchaseDate: date, periodStart, periodEnd,
    amount: amt.value, currency: currency || null, quantity: qty, unit: cellText(r.unit).slice(0, 30) || null,
    supplierEf: ef, supplierEfUnit: cellText(r.supplierEfUnit).replace(/^kg\s*co2e?\s*\/\s*/i, '').slice(0, 30) || null,
    capital: r.capital != null ? readBool(r.capital) : null, problems, groupKey: groupKey(description, categoryText, cellText(r.gl) || null), fingerprint: fp,
  };
}

export async function insertLines(c: Tx, tenant: string, batchId: string, ls: LineIn[]) {
  if (!ls.length) return;
  const col = <K extends keyof LineIn>(k: K) => ls.map((l) => l[k]);
  await c.query(
    `INSERT INTO purchase_line (tenant_id, batch_id, row_no, group_key, facility_id, facility_text, period_start, period_end, purchase_date, description, category_text,
                                gl_account, po_ref, supplier_text, supplier_norm, amount, currency, quantity, unit, supplier_ef, supplier_ef_unit, capital, problems, fingerprint, supplier_ref, supplier_country)
     SELECT $1, $2, r, k, f, ft, ps, pe, pd, d, ct, gl, po, st, sn, a, cu, q, u, ef, efu, cap,
            CASE WHEN pr = '' THEN '{}'::text[] ELSE string_to_array(pr, E'\\x1f') END, fp, sr, sc
       FROM unnest($3::int[], $4::text[], $5::uuid[], $6::text[], $7::date[], $8::date[], $9::date[], $10::text[], $11::text[],
                   $12::text[], $13::text[], $14::text[], $15::text[], $16::numeric[], $17::text[], $18::numeric[], $19::text[], $20::numeric[], $21::text[], $22::boolean[],
                   $23::text[], $24::text[], $25::text[], $26::text[])
            AS x(r, k, f, ft, ps, pe, pd, d, ct, gl, po, st, sn, a, cu, q, u, ef, efu, cap, pr, fp, sr, sc)`,
    [tenant, batchId, col('rowNo'), col('groupKey'), col('facilityId'), col('facilityText'), col('periodStart'), col('periodEnd'), col('purchaseDate'), col('description'), col('categoryText'),
     col('gl'), col('po'), col('supplierText'), col('supplierNorm'), col('amount'), col('currency'), col('quantity'), col('unit'), col('supplierEf'), col('supplierEfUnit'), col('capital'),
     ls.map((l) => l.problems.join('\u001f')), col('fingerprint'), col('supplierRef'), col('supplierCountry')]);
}

/** Reads the uploaded file of a batch into lines (job "purchase_ingest"). */
export async function readFileLines(jobId: number | undefined, tenant: string, batchId: string) {
  const b = await tenantTx(tenant, async (c) => (await c.query(
    `SELECT b.settings, d.data, d.filename FROM purchase_batch b JOIN document d ON d.id = b.document_id WHERE b.id = $1`, [batchId])).rows[0]);
  if (!b) throw new Error('Batch or its file not found');
  const s = b.settings as BatchSettings;
  const buf: Buffer = b.data;
  const kind = detectKind(buf, b.filename);
  const fac = await tenantTx(tenant, (c) => loadFacilities(c));
  await tenantTx(tenant, (c) => c.query('DELETE FROM purchase_line WHERE batch_id = $1', [batchId]));
  let i = -1, header: string[] | null = null, rowNo = 0, chunk: LineIn[] = [];
  const idx: Partial<Record<Field, number[]>> = {};
  const flush = async () => { const part = chunk; chunk = []; await tenantTx(tenant, (c) => insertLines(c, tenant, batchId, part)); await progress(jobId, 'reading', rowNo); };
  for await (const row of sheetRows(buf, kind, s.sheet)) {
    i++;
    if (i < s.headerRow) continue;
    if (i === s.headerRow) {
      header = row.map((x) => cellText(x));
      for (const [f, h] of Object.entries(s.columns) as [Field, string | string[]][]) {
        const hs = Array.isArray(h) ? h : [h];
        const pos = hs.map((x) => header!.indexOf(x)).filter((p) => p >= 0);
        if (pos.length) idx[f] = pos;
      }
      if (!idx.description || (!idx.amount && !idx.quantity)) throw new Error('The description and amount columns were not found in the file');
      continue;
    }
    const pick = (f: Field): Cell => { const p = idx[f]; if (!p) return null; return p.length === 1 ? row[p[0]!] ?? null : p.map((x) => cellText(row[x])).filter(Boolean).join(' — '); };
    rowNo++;
    if (rowNo > MAX_LINES) throw new Error(`More than ${MAX_LINES.toLocaleString('en')} lines: split the file`);
    chunk.push(buildLine({
      date: pick('date'), description: pick('description'), amount: pick('amount'), currency: pick('currency'), quantity: pick('quantity'), unit: pick('unit'),
      supplier: pick('supplier'), category: pick('category'), gl: pick('gl'), po: pick('po'), facility: pick('facility'), supplierEf: pick('supplierEf'),
      supplierEfUnit: pick('supplierEfUnit'), capital: pick('capital'), supplierRef: pick('supplierRef'), supplierCountry: pick('supplierCountry'),
    }, rowNo, s, fac));
    if (chunk.length >= INSERT_CHUNK) await flush();
  }
  if (chunk.length) await flush();
  if (!header) throw new Error('No header row found');
  if (!rowNo) throw new Error('No lines below the header row');
  return rowNo;
}

// ---------------------------------------------------------------- prepare --
/** Fresh planner statistics after many rows changed (else tens of thousands of lines look like a handful). */
async function freshStats(c: Tx, ...tables: string[]) {
  await c.query('SAVEPOINT stats');
  try { await c.query(`ANALYZE ${tables.join(', ')}`); await c.query('RELEASE SAVEPOINT stats'); } catch { await c.query('ROLLBACK TO SAVEPOINT stats'); }
}

/** Suppliers, duplicates, groups. */
export async function prepareBatch(c: Tx, tenant: string, batchId: string, origin: 'upload' | 'api' | 'manual' = 'upload') {
  // fresh statistics: the planner otherwise takes tens of thousands of new lines for a handful
  if (origin !== 'manual') await freshStats(c, 'purchase_line');
  await resolveSuppliers(c, tenant, batchId, origin);
  const settings = (await c.query('SELECT settings FROM purchase_batch WHERE id = $1', [batchId])).rows[0]?.settings as BatchSettings | undefined;
  await c.query(
    `UPDATE purchase_line l SET dup_of = o.id
       FROM (SELECT DISTINCT ON (fingerprint) id, fingerprint FROM purchase_line
              WHERE tenant_id = $2 AND batch_id <> $1 AND fingerprint IN (SELECT fingerprint FROM purchase_line WHERE batch_id = $1)
              ORDER BY fingerprint, id) o
      WHERE l.batch_id = $1 AND l.fingerprint = o.fingerprint`, [batchId, tenant]);
  if (!settings?.includeDuplicates)
    await c.query(`UPDATE purchase_line SET problems = array_append(problems, 'Duplicate of a line uploaded earlier') WHERE batch_id = $1 AND dup_of IS NOT NULL AND NOT ('Duplicate of a line uploaded earlier' = ANY(problems))`, [batchId]);
  // a clear description is one kind of purchase whoever sold it; a vague one ("Monthly charges")
  // is split by supplier, so that each supplier's default category can decide
  if (origin !== 'manual') {
    const ix = await spendIndex(c);
    const known = new Set((await c.query(`SELECT pattern FROM purchase_rule WHERE field = 'text' AND item_id IS NOT NULL`)).rows.map((r) => r.pattern as string));
    const keys = (await c.query(
      `SELECT group_key AS key, min(description) AS d, mode() WITHIN GROUP (ORDER BY category_text) AS cat, mode() WITHIN GROUP (ORDER BY gl_account) AS gl
         FROM purchase_line WHERE batch_id = $1 AND position('|s:' in group_key) = 0 GROUP BY 1`, [batchId])).rows as { key: string; d: string; cat: string | null; gl: string | null }[];
    const vague = keys.filter((k) => !known.has(normText(k.d)) && !/\b\d{6}\b/.test(`${k.cat ?? ''} ${k.d}`)
      && classify(ix.index, k.d, 2, [k.cat, k.gl && !/^\d+$/.test(k.gl) ? k.gl : ''].filter(Boolean).join(' · ')).confidence < STRONG).map((k) => k.key);
    if (vague.length)
      await c.query(`UPDATE purchase_line SET group_key = left(group_key, 330) || '|s:' || coalesce(supplier_id::text, supplier_norm, '') WHERE batch_id = $1 AND group_key = ANY($2)`, [batchId, vague]);
  }
  await c.query(
    `INSERT INTO purchase_group (tenant_id, batch_id, key, description, category_text, gl_account, supplier, supplier_id, lines)
     SELECT $1, $2, group_key, min(description), mode() WITHIN GROUP (ORDER BY category_text), mode() WITHIN GROUP (ORDER BY gl_account),
            mode() WITHIN GROUP (ORDER BY supplier_text), mode() WITHIN GROUP (ORDER BY supplier_id), count(*)
       FROM purchase_line WHERE batch_id = $2 GROUP BY group_key
     ON CONFLICT (batch_id, key) DO UPDATE SET lines = EXCLUDED.lines, supplier_id = EXCLUDED.supplier_id`, [tenant, batchId]);
}

// -------------------------------------------------------------------- map --
interface SpendIndex { sig: string; index: ClassIndex; naics: Map<number, string | null>; names: Map<number, string>; capital: Set<number> }
let indexCache: SpendIndex | null = null;
export async function spendIndex(c: Tx): Promise<SpendIndex> {
  const sig = (await c.query(
    `SELECT count(*) || ':' || coalesce(max(i.id), 0) || ':' || coalesce((SELECT max(id) FROM factor WHERE basis = 'scope3'), 0) || ':' || coalesce(sum(cardinality(i.aliases)), 0) || ':' || count(*) FILTER (WHERE (i.attrs->>'capital')::boolean) AS s
       FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE c.code = 'purchased_goods' AND i.active`)).rows[0].s;
  if (indexCache && indexCache.sig === sig) return indexCache;
  const rows = (await c.query(
    `SELECT i.id, i.name, i.aliases, i.attrs->>'naics' AS naics, coalesce(i.attrs->>'group', s.name) AS grp, coalesce((i.attrs->>'capital')::boolean, false) AS capital, i.code LIKE 'old:%' AS old
       FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
      WHERE c.code = 'purchased_goods' AND i.active AND i.code NOT LIKE 'purchase:%'
        AND EXISTS (SELECT 1 FROM factor f WHERE f.item_id = i.id AND f.status = 'active')`)).rows;
  const fresh = {
    sig, index: buildIndex(rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, group: r.grp, key: r.naics ?? undefined, boost: /^(42|44|45)/.test(r.naics ?? '') ? 0.85 : 1 }))),
    naics: new Map<number, string | null>(rows.map((r) => [r.id, r.naics])), names: new Map<number, string>(rows.map((r) => [r.id, r.name])),
    // the capital-goods list (previous Ekotrace products marked capital), and the EPA codes whose
    // products on that list are all capital goods (machinery, vehicles, computers…)
    capital: (() => {
      const by = new Map<string, { all: number; cap: number }>();
      for (const r of rows) if (r.old && r.naics) { const x = by.get(r.naics) ?? { all: 0, cap: 0 }; x.all++; if (r.capital) x.cap++; by.set(r.naics, x); }
      return new Set<number>(rows.filter((r) => r.capital || (r.naics && (by.get(r.naics)?.cap ?? 0) > 0 && by.get(r.naics)!.cap === by.get(r.naics)!.all)).map((r) => r.id));
    })(),
  };
  indexCache = fresh;
  return fresh;
}

interface GroupRow {
  key: string; description: string; category_text: string | null; gl_account: string | null; supplier: string | null; supplier_id: string | null;
  item_id: number | null; map_method: string | null; decision: string | null; target: string | null; capital: boolean; confirmed: boolean; updated_by: string | null;
}
type Rule = { id: string; field: string; pattern: string; item_id: number | null; decision: string | null; target: string | null; capital: boolean | null; account_type: string | null; label: string | null };
/** Methods a person (or a remembered choice) stands behind; the others are suggestions. */
export const CONFIRMED_METHODS = ['rule', 'code', 'manual', 'supplier', 'gl', 'category'];
const STRONG = 0.6, WEAK = 0.3;
const MOVE_TO = ['business_travel', 'upstream_transport', 'upstream_leased'];

/**
 * Spend category, capital goods and other-category decision of each group not settled by a
 * person (or of `keys`). First answer wins: remembered choice for the description → NAICS code
 * in the file → clear description match → supplier default → account default → category text
 * default → weaker description match → approved AI (large unclear groups only) → average factor.
 */
export async function mapGroups(c: Tx, tenant: string, batchId: string, opts: { keys?: string[]; jobId?: number } = {}) {
  const groups = (await c.query(
    `SELECT key, description, category_text, gl_account, supplier, supplier_id::text, item_id, map_method, decision, target, capital, confirmed, updated_by FROM purchase_group
      WHERE batch_id = $1 AND ($2::text[] IS NULL OR key = ANY($2))`, [batchId, opts.keys ?? null])).rows as GroupRow[];
  const ix = await spendIndex(c);
  const rules = (await c.query('SELECT id, field, pattern, item_id, decision, target, capital, account_type, label FROM purchase_rule')).rows as Rule[];
  const rule = new Map(rules.map((r) => [`${r.field}:${r.pattern}`, r]));
  const naicsItem = new Map<string, number>(); ix.naics.forEach((n, id) => { if (n) naicsItem.set(n, id); });
  const avg = new Map<string, number>((await c.query(`SELECT code, id FROM item WHERE code IN ('purchase:average-services','purchase:average-goods')
                                                       AND EXISTS (SELECT 1 FROM factor f WHERE f.item_id = item.id AND f.status = 'active')`)).rows.map((r) => [r.code, r.id]));
  type Upd = { key: string; item: number | null; method: string | null; conf: number | null; cand: unknown; decision: string | null; target: string | null; capital: boolean;
    capitalWhy: string | null; capitalSet: boolean; overlap: string | null; why: string | null; confirmed: boolean };
  const upd: Upd[] = [];
  const hits = new Map<string, number>();
  const hit = (r: Rule) => hits.set(r.id, (hits.get(r.id) ?? 0) + 1);
  const tenantRow = (await c.query('SELECT ai_mapping FROM tenant WHERE id = $1', [tenant])).rows[0];
  const forAi: { g: GroupRow; u: Upd }[] = [];
  let n = 0;
  for (const g of groups) {
    const settled = g.confirmed && g.updated_by != null;   // a person decided this group: keep it
    const u: Upd = { key: g.key, item: g.item_id, method: g.map_method, conf: null, cand: null, decision: settled ? g.decision : null, target: settled ? g.target : null,
      capital: settled ? g.capital : false, capitalWhy: null, capitalSet: settled, overlap: null, why: null, confirmed: settled };
    const rText = rule.get(`text:${normText(g.description)}`);
    const rSup = g.supplier_id ? rule.get(`supplier:${g.supplier_id}`) : undefined;
    const rGl = g.gl_account ? rule.get(`gl:${normText(g.gl_account)}`) : undefined;
    const rCat = g.category_text ? rule.get(`category:${normText(g.category_text)}`) : undefined;
    if (!settled) {
      u.item = null; u.method = null; u.confirmed = false;
      let cl: ReturnType<typeof classify> | null = null;
      const text = () => (cl ??= classify(ix.index, g.description, 5, [g.category_text, g.gl_account && !/^\d+$/.test(g.gl_account) ? g.gl_account : ''].filter(Boolean).join(' · ')));
      const code = /\b(\d{6})\b/.exec(`${g.category_text ?? ''} ${g.description}`)?.[1];
      if (rText?.item_id) { u.item = rText.item_id; u.method = 'rule'; u.conf = 1; hit(rText); }                         // 1. remembered for this description
      else if (code && naicsItem.has(code)) { u.item = naicsItem.get(code)!; u.method = 'code'; u.conf = 1; }             // 2. NAICS code in the file
      else if (text().itemId && text().confidence >= STRONG) { u.item = text().itemId; u.method = 'text'; u.conf = text().confidence; } // 3. clear description
      else if (rSup?.item_id) { u.item = rSup.item_id; u.method = 'supplier'; u.conf = 1; hit(rSup); }                    // 4. supplier default
      else if (rGl?.item_id) { u.item = rGl.item_id; u.method = 'gl'; u.conf = 1; hit(rGl); }                             // 5. account default
      else if (rCat?.item_id) { u.item = rCat.item_id; u.method = 'category'; u.conf = 1; hit(rCat); }                    //    category-text default
      else if (text().itemId && text().confidence >= WEAK) { u.item = text().itemId; u.method = 'text'; u.conf = text().confidence; } // 6. weaker match
      if (cl) u.cand = (cl as ReturnType<typeof classify>).candidates;
      if (!u.item && tenantRow?.ai_mapping && config.aiMap && text().candidates.length) forAi.push({ g, u });               // 7. AI (only if switched on)
      u.confirmed = CONFIRMED_METHODS.includes(u.method ?? '');
      // decisions remembered for this description, else the account's, supplier's or category's
      const dr = [rText, rGl, rSup, rCat].find((r) => r?.decision);
      if (dr) { u.decision = dr.decision; u.target = dr.target; }
      // capital goods: a remembered choice → the account type → the capital-goods list
      const cr = [rText, rSup, rCat].find((r) => r?.capital != null);
      if (cr) { u.capital = !!cr.capital; u.capitalWhy = cr.capital ? 'remembered choice' : null; u.capitalSet = true; }
      else if (rGl?.account_type === 'capital' || rGl?.capital) { u.capital = true; u.capitalWhy = `account “${g.gl_account}” is a capital account`; u.capitalSet = true; }
      else if (rGl?.account_type === 'purchase') u.capitalSet = true;   // an expense account: not capital goods
      if (rGl?.account_type === 'not_purchase') { u.decision = 'exclude'; u.target = null; u.overlap = 'not_purchase'; u.why = `account “${g.gl_account}” is not a purchase`; u.confirmed = true; }
    }
    upd.push(u);
    if (++n % 2000 === 0) await progress(opts.jobId, 'mapping', n, groups.length);
  }
  // AI, for unclear groups (only among the candidates)
  if (forAi.length) {
    try {
      await progress(opts.jobId, 'mapping (AI)', 0, forAi.length);
      const res = await aiChoose(forAi.map(({ g, u }) => ({ key: g.key, text: [g.description, g.category_text].filter(Boolean).join(' · '), candidates: ((u.cand ?? []) as { itemId: number }[]).map((x) => ({ id: x.itemId, name: ix.names.get(x.itemId) ?? '' })) })));
      for (const r of res) {
        const u = forAi.find((x) => x.g.key === r.key)?.u;
        if (u && r.itemId) { u.item = r.itemId; u.method = 'ai'; u.conf = r.confidence; }
      }
    } catch (e) {
      await c.query(`UPDATE purchase_batch SET error = $2 WHERE id = $1`, [batchId, `AI mapping not used: ${(e as Error).message}`]);
    }
  }
  for (const u of upd) {
    const g = groups.find((x) => x.key === u.key)!;
    // 8. nothing identifies it: the average factor of services (or of goods, when the best guess is a product)
    if (!u.item && !u.confirmed) {
      const best = ((u.cand ?? []) as { itemId: number }[])[0];
      const goods = /^(1|2[13]|3)/.test((best && ix.naics.get(best.itemId)) ?? '') || /\b(pcs|kg|t|ton|tonnes?|litres?|l|m3|ea|each|nos|box|bags?)\b/i.test(g.description);
      const id = avg.get(goods ? 'purchase:average-goods' : 'purchase:average-services');
      if (id) { u.item = id; u.method = 'fallback'; u.conf = null; }
    }
    if (u.overlap === 'not_purchase') continue;
    // other categories: flagged and decided by default (a person confirms the large ones)
    const o = detectOverlap([g.description, g.category_text, g.gl_account].filter(Boolean).join(' '), u.item ? ix.naics.get(u.item) : null);
    if (o && o.target !== 'capital_goods') {
      u.overlap = o.target; u.why = o.why;
      if (!u.decision) { if (['fuel', 'energy', 'waste'].includes(o.target)) u.decision = 'exclude'; else if (MOVE_TO.includes(o.target)) { u.decision = 'move'; u.target = o.target; } }
      if (u.decision === 'move' && !u.target && MOVE_TO.includes(o.target)) u.target = o.target;
    }
    if (!u.capitalSet && u.item && ix.capital.has(u.item)) { u.capital = true; u.capitalWhy = 'on the capital-goods list'; }
    if (o?.target === 'capital_goods' && !u.capital && !u.capitalSet) { u.overlap = 'capital_goods'; u.why = o.why; }      // a hint only
  }
  for (let i = 0; i < upd.length; i += 5000) {
    const p = upd.slice(i, i + 5000);
    await c.query(
      `UPDATE purchase_group g SET item_id = x.item, map_method = x.method, confidence = x.conf, candidates = coalesce(x.cand, g.candidates),
              decision = x.decision, target = x.target, capital = x.capital, capital_why = x.cwhy, overlap = x.overlap, overlap_why = x.why, confirmed = x.confirmed, updated_at = now()
         FROM unnest($2::text[], $3::int[], $4::text[], $5::numeric[], $6::jsonb[], $7::text[], $8::text[], $9::boolean[], $10::text[], $11::text[], $12::text[], $13::boolean[])
              AS x(key, item, method, conf, cand, decision, target, capital, cwhy, overlap, why, confirmed)
        WHERE g.batch_id = $1 AND g.key = x.key`,
      [batchId, p.map((u) => u.key), p.map((u) => u.item), p.map((u) => u.method), p.map((u) => u.conf), p.map((u) => (u.cand ? JSON.stringify(u.cand) : null)),
       p.map((u) => u.decision), p.map((u) => u.target), p.map((u) => u.capital), p.map((u) => u.capitalWhy), p.map((u) => u.overlap), p.map((u) => u.why), p.map((u) => u.confirmed)]);
  }
  for (const [id, h] of hits) await c.query('UPDATE purchase_rule SET hits = hits + $2 WHERE id = $1', [id, h]);
}

/**
 * Groups ranked by emissions: the largest, up to the company's coverage (95 % by default),
 * must be confirmed by a person — their ready lines wait as "check"; the small tail is
 * accepted with its best answer. Spend categories of services have similar factors, so a
 * wrong guess in the tail barely moves the total.
 */
export async function markMaterial(c: Tx, batchId: string) {
  await c.query(
    `UPDATE purchase_group g SET co2e = x.co2e FROM (SELECT group_key, sum(abs(co2e)) AS co2e FROM purchase_line WHERE batch_id = $1 GROUP BY group_key) x
      WHERE g.batch_id = $1 AND g.key = x.group_key`, [batchId]);
  await c.query(
    `UPDATE purchase_group g SET material = r.material FROM (
       SELECT key, coalesce(sum(co2e) OVER (ORDER BY co2e DESC NULLS LAST, key ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
                   < (SELECT review_coverage FROM tenant WHERE id = g0.tenant_id) * nullif(sum(co2e) OVER (), 0) AND co2e > 0 AS material
         FROM purchase_group g0 WHERE batch_id = $1) r
      WHERE g.batch_id = $1 AND g.key = r.key`, [batchId]);
  await c.query(
    `${GRP} UPDATE purchase_line l SET status = CASE WHEN g.material AND NOT g.confirmed THEN 'check' ELSE 'ready' END
       FROM grp g WHERE l.batch_id = $1 AND g.key = l.group_key AND l.status IN ('ready','check')
        AND l.status <> CASE WHEN g.material AND NOT g.confirmed THEN 'check' ELSE 'ready' END`, [batchId]);
}

// -------------------------------------------------------------- calculate --
interface Ctx { tenant: { fx_method: FxMethod; currency: string }; rates: FxRate[]; cpi: PriceIndex[]; units: Map<string, { code: string; dimension: string; to_base: number }> }

async function calcContext(c: Tx): Promise<Ctx> {
  const tenant = (await c.query(`SELECT fx_method, currency FROM tenant WHERE id = nullif(current_setting('app.tenant_id', true), '')::uuid`)).rows[0];
  // the company's own rates first, so they win over the platform list
  const rates = (await c.query(`SELECT currency, kind, to_char(period, 'YYYY-MM-DD') AS period, per_usd::float8 AS "perUsd", source FROM fx_rate ORDER BY (tenant_id IS NULL), period DESC`)).rows as FxRate[];
  const cpi = (await c.query(`SELECT year, value::float8 AS value FROM price_index WHERE region = 'US' ORDER BY year`)).rows as PriceIndex[];
  const units = new Map<string, { code: string; dimension: string; to_base: number }>();
  for (const u of (await c.query('SELECT code, dimension, to_base::float8 AS to_base, aliases FROM unit WHERE active')).rows) {
    units.set(u.code.toLowerCase(), u); for (const a of u.aliases ?? []) if (!units.has(a.toLowerCase())) units.set(a.toLowerCase(), u);
  }
  return { tenant, rates, cpi, units };
}
const unitOf = (ctx: Ctx, s: string | null) => (s ? ctx.units.get(s.trim().toLowerCase()) ?? ctx.units.get(s.trim().toLowerCase().replace(/s$/, '')) : undefined);

interface LineRow {
  id: string; group_key: string; facility_id: string | null; period_start: string | null; purchase_date: string | null; amount: string | null; currency: string | null;
  quantity: string | null; unit: string | null; supplier_id: string | null; supplier_ef: string | null; supplier_ef_unit: string | null; capital: boolean | null; problems: string[];
  activity_id: string | null;
}

type SupF = { id: string; item_id: number | null; co2e: number; unit: string; price_year: number | null; valid_from: string; valid_to: string; source: string; name: string };
interface Env {
  ctx: Ctx; pc: PurchaseContext; groups: Map<string, { key: string; item_id: number | null; decision: string | null; target: string | null; overlap: string | null; capital: boolean }>;
  spend: Map<number, SpendFactor & { id: number }>; sup: Map<string, SupF[]>; generic: number;
}

/** Everything needed to calculate the lines of a batch: rates, CPI, group mappings, factors. */
async function loadEnv(c: Tx, batchId: string, lineFilter?: string): Promise<Env> {
  const ctx = await calcContext(c);
  const pc: PurchaseContext = {
    rates: ctx.rates, fxMethod: ctx.tenant.fx_method, index: () => ctx.cpi,
    convertQty: (v: number, from: string, to: string) => { const a = unitOf(ctx, from), b = unitOf(ctx, to); return a && b && a.dimension === b.dimension ? (v * a.to_base) / b.to_base : null; },
  };
  const groups = new Map((await c.query(
    `SELECT key, item_id, decision, target, overlap, capital FROM purchase_group WHERE batch_id = $1`, [batchId])).rows.map((g) => [g.key, g]));
  // spend factor per item: the active one, real sources before the demo placeholders
  const itemIds = [...new Set([...groups.values()].map((g) => g.item_id).filter(Boolean))];
  const spend = new Map<number, SpendFactor & { id: number }>();
  for (const f of (await c.query(
    `SELECT DISTINCT ON (f.item_id) f.id, f.item_id, f.co2e::float8 AS co2e, f.unit, f.price_year, i.name, s.code AS source
       FROM factor f JOIN item i ON i.id = f.item_id JOIN factor_source s ON s.id = f.source_id
      WHERE f.item_id = ANY($1) AND f.status = 'active' AND f.basis = 'scope3' AND f.unit IN (SELECT code FROM unit WHERE dimension LIKE 'money_%')
      ORDER BY f.item_id, (s.code = $2), f.valid_from DESC`, [itemIds, DEMO_SOURCE])).rows)
    spend.set(f.item_id, { id: f.id, co2e: f.co2e, currency: f.unit, priceYear: f.price_year, name: f.name, source: f.source === DEMO_SOURCE ? 'DEMO placeholder (not real)' : f.source });
  const sup = new Map<string, SupF[]>();
  for (const f of (await c.query(
    `SELECT e.id, e.supplier_id, e.item_id, e.co2e::float8 AS co2e, e.unit, e.price_year, to_char(e.valid_from,'YYYY-MM-DD') AS valid_from, to_char(e.valid_to,'YYYY-MM-DD') AS valid_to, e.source, s.name
       FROM supplier_ef e JOIN supplier s ON s.id = e.supplier_id
      WHERE e.supplier_id IN (SELECT DISTINCT supplier_id FROM purchase_line WHERE batch_id = $1 AND supplier_id IS NOT NULL ${lineFilter ?? ''})`, [batchId])).rows) {
    const a = sup.get(f.supplier_id) ?? []; a.push(f); sup.set(f.supplier_id, a);
  }
  const generic = (await c.query(`SELECT id FROM item WHERE code = 'purchase:supplier-specific'`)).rows[0]?.id as number;
  return { ctx, pc, groups, spend, sup, generic };
}

/** One line: its status, factor and result (or why it cannot be calculated). */
function computeLine(env: Env, l: LineRow) {
  const { ctx, pc, groups, spend, sup, generic } = env;
  const g = groups.get(l.group_key);
  const date = l.purchase_date ?? l.period_start ?? '2000-01-01';
  const amount = l.amount != null ? Number(l.amount) : null;
  let usd: number | null = null;
  if (amount != null && l.currency) { const fx = chooseFx(ctx.rates, l.currency, date, ctx.tenant.fx_method); if (fx) usd = amount / fx.perUsd; }
  // best supplier factor: on the line itself, else for this spend category, else for everything from the supplier
  let supplierUnit: UnitFactor | null = null, supplierMoney: SpendFactor | null = null, supplierEfId: string | null = null;
  const ownProblem: string[] = [];
  if (l.supplier_ef != null && l.supplier_ef_unit) {
    const u = unitOf(ctx, l.supplier_ef_unit) ?? (/^[A-Z]{3}$/i.test(l.supplier_ef_unit) ? { code: l.supplier_ef_unit.toUpperCase(), dimension: `money_${l.supplier_ef_unit.toUpperCase()}`, to_base: 1 } : undefined);
    if (!u) ownProblem.push(`Unit "${l.supplier_ef_unit}" of the supplier factor not recognised`);
    else if (u.dimension.startsWith('money_')) supplierMoney = { co2e: Number(l.supplier_ef), currency: u.code, priceYear: null, name: 'Supplier factor on the line', source: 'file' };
    else supplierUnit = { co2e: Number(l.supplier_ef), unit: u.code, name: 'Supplier factor on the line', source: 'file' };
  } else if (l.supplier_id && sup.has(l.supplier_id)) {
    const cands = sup.get(l.supplier_id)!.filter((f) => f.valid_from <= date && f.valid_to >= date && (f.item_id == null || f.item_id === g?.item_id))
      .sort((a, b) => (b.item_id != null ? 1 : 0) - (a.item_id != null ? 1 : 0));
    const unitF = cands.find((f) => !unitOf(ctx, f.unit)?.dimension.startsWith('money_'));
    const moneyF = cands.find((f) => unitOf(ctx, f.unit)?.dimension.startsWith('money_'));
    if (unitF && l.quantity != null) { supplierUnit = { id: unitF.id, co2e: unitF.co2e, unit: unitF.unit, name: `${unitF.name} (supplier)`, source: unitF.source }; supplierEfId = unitF.id; }
    if (moneyF) { supplierMoney = { id: moneyF.id, co2e: moneyF.co2e, currency: moneyF.unit, priceYear: moneyF.price_year, name: `${moneyF.name} (supplier)`, source: moneyF.source }; supplierEfId ??= moneyF.id; }
  }
  const factor = g?.item_id ? spend.get(g.item_id) ?? null : null;
  let status: string, res: ReturnType<typeof calcPurchase> | null = null, err: string | null = null;
  const problems = [...l.problems, ...ownProblem];
  if (g?.item_id && !factor && !supplierUnit && !supplierMoney) err = 'No spend factor for this category';
  if (!err && (factor || supplierUnit || supplierMoney)) {
    try { res = calcPurchase({ date, amount, currency: l.currency, quantity: l.quantity != null ? Number(l.quantity) : null, unit: l.unit, supplierUnit, supplierMoney, spend: factor }, pc); }
    catch (e) { err = (e as Error).message; }
  }
  if (problems.length) status = 'problem';
  else if (g?.decision === 'exclude') status = 'excluded';
  else if (g?.overlap && g.overlap !== 'capital_goods' && !g.decision) status = 'flagged'; // "capital goods?" is a hint, not a stop
  else if (!g?.item_id && !supplierUnit && !supplierMoney) status = 'unmapped';
  else if (err || !res) status = 'problem';
  else status = 'ready';
  const baseUnit = !res ? null : res.method === 'spend' ? factor!.currency : supplierUnit && res.factorUnit === `kg CO2e / ${supplierUnit.unit}` ? supplierUnit.unit : supplierMoney!.currency;
  return {
    res, row: {
      id: l.id, status, method: res?.method ?? null, item: g?.item_id ?? (res ? generic : null), factor: res && res.method === 'spend' ? factor?.id ?? null : null,
      sef: res?.method === 'supplier' ? supplierEfId : null, fx: res?.fx?.perUsd ?? null, fxKind: res?.fx?.kind ?? null, cpi: res?.cpi?.ratio ?? null,
      base: res?.baseAmount ?? null, baseUnit, co2e: res?.co2e ?? null, usd, warnings: res?.warnings ?? [], err: err ?? (ownProblem[0] ?? null),
    },
  };
}

const LINE_COLS = `id, group_key, facility_id, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(purchase_date,'YYYY-MM-DD') AS purchase_date, amount, currency, quantity, unit,
              supplier_id, supplier_ef, supplier_ef_unit, capital, problems, activity_id`;

/** (Re)calculates the lines of a batch — all, some groups, or some suppliers — except published ones. */
export async function calcLines(c: Tx, batchId: string, opts: { keys?: string[]; supplierIds?: string[]; jobId?: number } = {}) {
  const env = await loadEnv(c, batchId);
  let last = '0', done = 0;
  const total = Number((await c.query(`SELECT count(*) FROM purchase_line WHERE batch_id = $1 AND status <> 'published'`, [batchId])).rows[0].count);
  for (;;) {
    const rows = (await c.query(
      `SELECT ${LINE_COLS} FROM purchase_line
        WHERE batch_id = $1 AND id > $2 AND status <> 'published' AND ($3::text[] IS NULL OR group_key = ANY($3)) AND ($4::uuid[] IS NULL OR supplier_id = ANY($4))
        ORDER BY id LIMIT $5`, [batchId, last, opts.keys ?? null, opts.supplierIds ?? null, CALC_CHUNK])).rows as LineRow[];
    if (!rows.length) break;
    last = rows[rows.length - 1]!.id;
    const out = rows.map((l) => computeLine(env, l).row);
    await c.query(
      `UPDATE purchase_line l SET status = x.status, method = x.method, item_id = x.item, factor_id = x.factor, supplier_ef_id = x.sef, fx_per_usd = x.fx, fx_kind = x.fxk,
              cpi_ratio = x.cpi, base_amount = x.base, base_unit = x.bu, co2e = x.co2e, usd = x.usd, warnings = CASE WHEN x.w = '' THEN '{}' ELSE string_to_array(x.w, E'\\x1f') END, calc_error = x.err
         FROM unnest($1::bigint[], $2::text[], $3::text[], $4::int[], $5::bigint[], $6::uuid[], $7::numeric[], $8::text[], $9::numeric[], $10::numeric[], $11::text[], $12::numeric[], $13::numeric[], $14::text[], $15::text[])
              AS x(id, status, method, item, factor, sef, fx, fxk, cpi, base, bu, co2e, usd, w, err)
        WHERE l.id = x.id`,
      [out.map((o) => o.id), out.map((o) => o.status), out.map((o) => o.method), out.map((o) => o.item), out.map((o) => o.factor), out.map((o) => o.sef), out.map((o) => o.fx),
       out.map((o) => o.fxKind), out.map((o) => o.cpi), out.map((o) => o.base), out.map((o) => o.baseUnit), out.map((o) => o.co2e), out.map((o) => o.usd),
       out.map((o) => o.warnings.join('\u001f')), out.map((o) => o.err)]);
    done += rows.length;
    await progress(opts.jobId, 'calculating', done, total);
  }
  await c.query(
    `UPDATE purchase_group g SET usd = coalesce(x.usd, 0), lines = x.n
       FROM (SELECT group_key, sum(usd) AS usd, count(*) AS n FROM purchase_line WHERE batch_id = $1 GROUP BY group_key) x
      WHERE g.batch_id = $1 AND g.key = x.group_key`, [batchId]);
  if (!opts.keys && !opts.supplierIds && total > 5000) await freshStats(c, 'purchase_line', 'purchase_group');
  await markMaterial(c, batchId);
}

/** The calculation of one line, step by step (for the line's detail). */
export async function explainLine(c: Tx, lineId: string) {
  const l = (await c.query(`SELECT batch_id, ${LINE_COLS} FROM purchase_line WHERE id = $1`, [lineId])).rows[0] as (LineRow & { batch_id: string }) | undefined;
  if (!l) return null;
  const env = await loadEnv(c, l.batch_id, `AND id = ${Number(lineId)}`);
  const { res, row } = computeLine(env, l);
  return { status: row.status, method: row.method, co2e: row.co2e, steps: res?.steps ?? [], warnings: res?.warnings ?? [], error: row.err, factor: res ? { name: res.factorName, source: res.factorSource, value: res.factorValue, unit: res.factorUnit } : null };
}

// ---------------------------------------------------------------- publish --
/** The batch's groups, read once (a join per line would check row security for every line). */
const GRP = `WITH grp AS MATERIALIZED (SELECT key, decision, target, capital, material, confirmed FROM purchase_group WHERE batch_id = $1)`;
const CATEGORY_SQL = `CASE WHEN g.decision = 'move' AND g.target IS NOT NULL THEN g.target WHEN coalesce(l.capital, g.capital) THEN 'capital_goods' ELSE 'purchased_goods' END`;

export interface PublishResult { entries: number; lines: number; co2e: number; skipped: { facility: string; lines: number }[] }

/** Ready lines → entries (one per facility × period × category × spend category × method × unit). */
export async function publishBatch(c: Tx, tenant: string, batchId: string, user: User): Promise<PublishResult> {
  if (Number((await c.query(`SELECT count(*) FROM purchase_line WHERE batch_id = $1`, [batchId])).rows[0].count) > 5000) await freshStats(c, 'purchase_line', 'purchase_group');
  const scope = await scopeOf(c, user);
  const allowed = [...scope.enter];
  const b = (await c.query(`SELECT b.name, t.gwp_set FROM purchase_batch b JOIN tenant t ON t.id = b.tenant_id WHERE b.id = $1`, [batchId])).rows[0];
  const skipped = (await c.query(
    `SELECT coalesce(f.name, 'no facility') AS facility, count(*)::int AS lines FROM purchase_line l LEFT JOIN org_node f ON f.id = l.facility_id
      WHERE l.batch_id = $1 AND l.status = 'ready' AND NOT (l.facility_id = ANY($2)) GROUP BY 1`, [batchId, allowed])).rows;
  const agg = (await c.query(
    `${GRP} SELECT l.facility_id, to_char(l.period_start,'YYYY-MM-DD') AS ps, to_char(l.period_end,'YYYY-MM-DD') AS pe, ${CATEGORY_SQL} AS cat, l.item_id, l.method, l.base_unit,
            min(l.factor_id) AS factor_id, count(*)::int AS n, sum(l.co2e)::float8 AS co2e, sum(l.base_amount)::float8 AS base, sum(l.usd)::float8 AS usd,
            count(*) FILTER (WHERE cardinality(l.warnings) > 0)::int AS warned,
            (array_agg(DISTINCT s.name) FILTER (WHERE l.method = 'supplier'))[1:5] AS suppliers,
            min(i.name) AS item_name, min(fs.code) AS source
       FROM purchase_line l JOIN grp g ON g.key = l.group_key JOIN item i ON i.id = l.item_id
       LEFT JOIN supplier s ON s.id = l.supplier_id LEFT JOIN factor f ON f.id = l.factor_id LEFT JOIN factor_source fs ON fs.id = f.source_id
      WHERE l.batch_id = $1 AND l.status = 'ready' AND l.facility_id = ANY($2)
      GROUP BY 1, 2, 3, 4, 5, 6, 7`, [batchId, allowed])).rows;
  if (!agg.length) return { entries: 0, lines: 0, co2e: 0, skipped };
  // spend per currency per entry
  const spendRows = (await c.query(
    `${GRP} SELECT l.facility_id, to_char(l.period_start,'YYYY-MM-DD') AS ps, ${CATEGORY_SQL} AS cat, l.item_id, l.method, l.base_unit, l.currency, sum(l.amount)::float8 AS amount
       FROM purchase_line l JOIN grp g ON g.key = l.group_key
      WHERE l.batch_id = $1 AND l.status = 'ready' AND l.facility_id = ANY($2) AND l.currency IS NOT NULL GROUP BY 1, 2, 3, 4, 5, 6, 7`, [batchId, allowed])).rows;
  const keyOf = (r: { facility_id: string; ps: string; cat: string; item_id: number; method: string; base_unit: string }) => [r.facility_id, r.ps, r.cat, r.item_id, r.method, r.base_unit].join('|');
  const spendBy = new Map<string, Record<string, number>>();
  for (const r of spendRows) { const k = keyOf(r); const m = spendBy.get(k) ?? {}; m[r.currency] = (m[r.currency] ?? 0) + r.amount; spendBy.set(k, m); }
  const cats = new Map((await c.query(`SELECT code, id FROM category WHERE calc_method = 'spend'`)).rows.map((r) => [r.code, r.id]));
  const fmt = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 2 });
  let entries = 0, lines = 0, co2e = 0;
  for (let i = 0; i < agg.length; i += 1000) {
    const part = agg.slice(i, i + 1000).map((r) => {
      const key = keyOf(r), spendBy1 = spendBy.get(key) ?? {};
      const spendTxt = Object.entries(spendBy1).map(([cur, v]) => `${cur} ${fmt(v)}`).join(' + ');
      const per = r.base ? r.co2e / r.base : 0;
      const steps = [
        `${r.n} purchase line${r.n === 1 ? '' : 's'} from "${b.name}"${spendTxt ? `: ${spendTxt}` : ''}`,
        r.method === 'spend'
          ? `Spend-based: each line converted to ${r.base_unit} of the factor's price year (exchange rate of its month, US CPI), × ${per.toPrecision(4)} kg CO2e/${r.base_unit} (${r.item_name}, ${r.source === DEMO_SOURCE ? 'DEMO placeholder factor' : r.source})`
          : `Supplier-specific factor${r.suppliers?.length ? ` (${r.suppliers.join(', ')})` : ''}: ${fmt(r.base)} ${r.base_unit} in total`,
        `Sum of the lines = ${fmt(r.co2e)} kg CO2e (each line's steps are on the purchase batch)`,
      ];
      return { r, key, steps, spend: spendBy1, per };
    });
    const ins = await c.query(
      `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set, co2e_direct, co2e_scope3,
                             steps, warnings, note, created_by, factors, purchase_batch_id)
       SELECT $1, f, c, i, ps, pe, q, u, inp, 'actual', $2, 0, co2, st, w, $3, $4, fa, $5
         FROM unnest($6::uuid[], $7::int[], $8::int[], $9::date[], $10::date[], $11::numeric[], $12::text[], $13::jsonb[], $14::numeric[], $15::jsonb[], $16::jsonb[], $17::jsonb[])
              AS x(f, c, i, ps, pe, q, u, inp, co2, st, w, fa)
       RETURNING id, inputs->>'key' AS key, co2e_scope3`,
      [tenant, b.gwp_set, `From purchases: ${b.name}`, user.id, batchId,
       part.map((p) => p.r.facility_id), part.map((p) => cats.get(p.r.cat)), part.map((p) => p.r.item_id), part.map((p) => p.r.ps), part.map((p) => p.r.pe),
       part.map((p) => p.r.base), part.map((p) => p.r.base_unit),
       part.map((p) => JSON.stringify({ source: 'purchases', batchId, key: p.key, lines: p.r.n, method: p.r.method, spend: p.spend, usd: p.r.usd })),
       part.map((p) => p.r.co2e), part.map((p) => JSON.stringify(p.steps)),
       part.map((p) => JSON.stringify(p.r.warned ? [`${p.r.warned} line${p.r.warned === 1 ? '' : 's'} with a warning (exchange rate or price index fallback): see the purchase batch`] : [])),
       part.map((p) => JSON.stringify([{ basis: 'scope3', label: p.r.method === 'spend' ? 'Spend-based' : 'Supplier-specific', factorId: p.r.factor_id, source: p.r.method === 'spend' ? (p.r.source === DEMO_SOURCE ? 'DEMO placeholder' : p.r.source) : 'Supplier',
         validFrom: null, co2ePerUnit: p.per, unit: p.r.base_unit, unitName: p.r.base_unit, perEnteredUnit: p.per, enteredUnit: p.r.base_unit, enteredUnitName: p.r.base_unit, quantity: p.r.base, method: 'published' }]))]);
    const factorOf = new Map(part.map((p) => [p.key, p.r.factor_id]));
    await c.query(
      `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
       SELECT a, $1, 'scope3', 'CO2e', NULL, v, fid, 'published' FROM unnest($2::uuid[], $3::numeric[], $4::bigint[]) AS x(a, v, fid)`,
      [tenant, ins.rows.map((r) => r.id), ins.rows.map((r) => r.co2e_scope3), ins.rows.map((r) => factorOf.get(r.key) ?? null)]);
    await c.query(
      `${GRP} UPDATE purchase_line l SET activity_id = a.id, status = 'published'
         FROM grp g, unnest($2::uuid[], $3::text[]) AS a(id, key)
        WHERE l.batch_id = $1 AND l.status = 'ready' AND g.key = l.group_key
          AND a.key = concat_ws('|', l.facility_id, to_char(l.period_start,'YYYY-MM-DD'), ${CATEGORY_SQL}, l.item_id, l.method, l.base_unit)`,
      [batchId, ins.rows.map((r) => r.id), ins.rows.map((r) => r.key)]);
    entries += ins.rowCount ?? 0;
    for (const p of part) { lines += p.r.n; co2e += p.r.co2e; }
  }
  await c.query(`UPDATE purchase_batch SET status = 'published', published_at = now(), published_by = $2, updated_at = now() WHERE id = $1`, [batchId, user.id]);
  return { entries, lines, co2e, skipped };
}

/** Takes the entries of a batch back (approved ones stay); the lines can be changed and published again. */
export async function reopenBatch(c: Tx, batchId: string): Promise<{ removed: number; kept: number }> {
  const kept = Number((await c.query(`SELECT count(*) FROM activity WHERE purchase_batch_id = $1 AND status = 'approved'`, [batchId])).rows[0].count);
  const del = await c.query(`DELETE FROM activity WHERE purchase_batch_id = $1 AND status <> 'approved'`, [batchId]);
  await c.query(`UPDATE purchase_line SET status = 'new' WHERE batch_id = $1 AND status = 'published' AND activity_id IS NULL`, [batchId]);
  await calcLines(c, batchId);
  await c.query(`UPDATE purchase_batch SET status = 'review', updated_at = now() WHERE id = $1`, [batchId]);
  return { removed: del.rowCount ?? 0, kept };
}
