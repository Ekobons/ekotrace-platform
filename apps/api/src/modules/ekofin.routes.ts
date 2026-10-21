/**
 * EKOFIN — financed emissions (PCAF Part A) for banks, investors and other financial institutions.
 * Every route needs EKOFIN switched on for the company (tenant.products).
 *
 *   GET    /api/fin/meta                              asset classes, scores, factor libraries, what the user may do
 *   GET    /api/fin/portfolios                        portfolios with their reporting periods
 *   POST   /api/fin/portfolios                        PUT/DELETE /api/fin/portfolios/:id
 *   POST   /api/fin/portfolios/:id/periods            a reporting date (optionally copying the holdings of another one)
 *   GET    /api/fin/periods/:id                       holdings with results and the portfolio summary (locked: as locked)
 *   DELETE /api/fin/periods/:id                       a draft period and its holdings
 *   POST   /api/fin/periods/:id/lock · unlock         lock keeps the figures; unlock needs a reason (super admin)
 *   GET    /api/fin/periods/:id/export                holdings with results as CSV
 *   POST   /api/fin/periods/:id/holdings              PUT/DELETE /api/fin/holdings/:id
 *   PUT    /api/fin/holdings/:id/layer                use a given PCAF layer (with a reason), or the best again
 *   POST   /api/fin/periods/:id/import?commit=&mode=  a loan book / positions file (Excel or CSV): preview, then add or replace
 *   GET    /api/fin/import-template                   the upload template
 *   GET    /api/fin/counterparties?q=                 POST /api/fin/counterparties
 *   GET    /api/fin/counterparties/:id                profile: financials, emissions, holdings, sector factors that apply
 *   PUT    /api/fin/counterparties/:id                DELETE (no holdings)
 *   PUT    /api/fin/counterparties/:id/financials     one financial year (added or replaced);  DELETE /api/fin/financials/:id
 *   PUT    /api/fin/counterparties/:id/emissions      one year and score (added or replaced);   DELETE /api/fin/emissions/:id
 *   GET    /api/fin/factors?library=                  sector factor libraries and their rows
 *   POST   /api/fin/factors/import?commit=            load factors (platform admin);  DELETE /api/fin/factors/library?name=
 *   GET    /api/fin/factors/template
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ASSET_CLASSES, SCORE_LABEL, type AssetClass } from '@ekotrace/calc';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { cellText, detectKind, findHeaderRow, sheetRows, type Cell } from '../lib/sheet.js';
import { sendWorkbook, styleHeader, toIsoDate } from '../lib/xlsx.js';
import { assetClassOf, computePeriod, normCompany, pickFactor, requireEkofin, type FinPeriodResult } from '../lib/ekofin.js';
import { PRODUCT_SLUG } from '../lib/brand.js';

const EDIT = ['super_admin', 'admin', 'manager', 'preparer'] as const;
const LOCK = ['super_admin', 'admin'] as const;
const uuid = z.string().uuid();
const idOf = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'].includes(req.user.role);
const cur = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'A 3-letter currency code, e.g. USD');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const STD = ['NACE', 'GICS', 'ISIC', 'NAICS', 'OTHER'] as const;
const KINDS: Record<string, string> = { loan_book: 'Loan book', fund: 'Fund', mandate: 'Investment mandate', other: 'Other' };
const assetClass = z.enum(Object.keys(ASSET_CLASSES) as [AssetClass, ...AssetClass[]]);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((s) => (s ? s : null));
const optNum = z.number().finite().nullable().optional().transform((x) => (x == null ? null : x));
const low = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const blankNull = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional().or(z.literal('').transform(() => null));

/** Runs fn in the company's transaction after checking EKOFIN is on. */
async function finTx<T>(req: FastifyRequest, fn: (c: Tx, tenant: string) => Promise<T>): Promise<T> {
  const tenant = requireTenant(req);
  return tenantTx(tenant, async (c) => { await requireEkofin(c, tenant); return fn(c, tenant); });
}
async function draftPeriod(c: Tx, periodId: string) {
  const p = (await c.query(`SELECT id, status, portfolio_id FROM fin_period WHERE id = $1 FOR UPDATE`, [periodId])).rows[0];
  if (!p) throw notFound('Reporting period');
  if (p.status === 'locked') throw new AppError('This reporting period is locked. A super admin can unlock it, with a reason.', 409, 'LOCKED');
  return p as { id: string; status: string; portfolio_id: string };
}
async function draftOfHolding(c: Tx, holdingId: string) {
  const h = (await c.query(`SELECT period_id FROM fin_holding WHERE id = $1`, [holdingId])).rows[0];
  if (!h) throw notFound('Holding');
  return draftPeriod(c, h.period_id);
}

const portfolioBody = z.object({
  name: z.string().trim().min(2).max(160), kind: z.enum(Object.keys(KINDS) as [string, ...string[]]).default('loan_book'), currency: cur.default('USD'),
  factorLibrary: optText(80), includeScope3: z.boolean().default(false), description: z.string().trim().max(2000).default(''),
});
const counterpartyBody = z.object({
  name: z.string().trim().min(1).max(200), country: blankNull(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Country as a 2-letter ISO code')),
  lei: blankNull(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{20}$/, 'An LEI has 20 letters and digits')),
  isin: blankNull(z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, 'An ISIN has 12 characters, e.g. US0378331005')),
  localId: optText(80), listed: z.boolean().default(false), sectorStandard: z.enum(STD).default('NACE'), sectorCode: optText(20), sectorName: optText(160),
  contactEmail: blankNull(z.string().trim().email().max(190)), note: z.string().trim().max(2000).default(''),
});
const holdingBody = z.object({
  counterpartyId: uuid, assetClass, outstanding: z.number().finite().min(0).max(1e15), currency: cur, internalRef: optText(80),
  origination: date.nullable().optional().transform((x) => x ?? null), note: z.string().trim().max(1000).default(''),
});
const financialsBody = z.object({
  year: z.number().int().min(1990).max(2100), currency: cur, evic: optNum, equity: optNum, debt: optNum, revenue: optNum, totalAssets: optNum, source: z.string().trim().max(300).default(''),
}).refine((b) => [b.evic, b.equity, b.debt, b.revenue, b.totalAssets].some((x) => x != null), 'Enter at least one figure')
  .refine((b) => [b.evic, b.debt, b.revenue, b.totalAssets].every((x) => x == null || x >= 0), 'Figures cannot be negative (except equity)');
const emissionBody = z.object({
  year: z.number().int().min(1990).max(2100), score: z.union([z.literal(1), z.literal(2), z.literal(3)]), s1: z.number().finite().min(0), s2: z.number().finite().min(0),
  s3: z.number().finite().min(0).nullable().optional().transform((x) => x ?? null), source: z.string().trim().min(2).max(300), documentId: uuid.nullable().optional().transform((x) => x ?? null),
  note: z.string().trim().max(1000).default(''),
});

async function upsertCounterparty(c: Tx, tenant: string, req: FastifyRequest, b: z.infer<typeof counterpartyBody>, id?: string) {
  const norm = normCompany(b.name) || b.name.toLowerCase();
  for (const [col, v] of [['lei', b.lei], ['isin', b.isin]] as const) {
    if (!v) continue;
    const ex = (await c.query(`SELECT id, name FROM fin_counterparty WHERE ${col} = $1 AND id IS DISTINCT FROM $2::uuid`, [v, id ?? null])).rows[0];
    if (ex) throw new AppError(`${col.toUpperCase()} ${v} is already used by ${ex.name}`, 409, 'DUPLICATE');
  }
  const vals = [b.name, norm, b.country ?? null, b.lei ?? null, b.isin ?? null, b.localId, b.listed, b.sectorStandard, b.sectorCode?.toUpperCase() ?? null, b.sectorName, b.contactEmail ?? null, b.note];
  if (id) {
    const r = await c.query(`UPDATE fin_counterparty SET name=$2, norm=$3, country=$4, lei=$5, isin=$6, local_id=$7, listed=$8, sector_standard=$9, sector_code=$10, sector_name=$11, contact_email=$12, note=$13,
                               updated_name=$14, updated_at=now() WHERE id = $1`, [id, ...vals, req.user.name]);
    if (!r.rowCount) throw notFound('Counterparty');
    return id;
  }
  return (await c.query(`INSERT INTO fin_counterparty (tenant_id, name, norm, country, lei, isin, local_id, listed, sector_standard, sector_code, sector_name, contact_email, note, created_name)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [tenant, ...vals, req.user.name])).rows[0].id as string;
}

async function readTable(buf: unknown, filename: string, max: number) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
  const kind = detectKind(buf, filename);
  if (kind === 'xls') throw new AppError('Save the file as .xlsx or .csv');
  if (kind === 'unknown') throw new AppError('Send an Excel (.xlsx) or CSV file');
  const all: Cell[][] = [];
  for await (const r of sheetRows(buf, kind)) { all.push(r); if (all.length > max + 20) throw new AppError(`At most ${max.toLocaleString('en')} rows per file`); }
  const h = findHeaderRow(all);
  return { header: (all[h] ?? []).map((x) => cellText(x)), rows: all.slice(h + 1) };
}
const colOf = (header: string[], names: string[]) => {
  const H = header.map(low);
  for (const n of names) { const i = H.findIndex((x) => x === n); if (i >= 0) return i; }
  for (const n of names) { const i = H.findIndex((x) => ` ${x} `.includes(` ${n} `)); if (i >= 0) return i; }
  return -1;
};
const num = (s: string): number | null => {
  const t = s.replace(/[\s,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : NaN;
};
const yes = (s: string) => /^(y|yes|true|1|listed|x)$/i.test(s.trim());

/** Columns of a positions file (header text matched loosely; first match wins). */
const HOLDING_COLS: Record<string, string[]> = {
  name: ['counterparty name', 'counterparty', 'borrower name', 'borrower', 'issuer name', 'issuer', 'investee', 'company name', 'customer name', 'company', 'name'],
  lei: ['lei'], isin: ['isin'], localId: ['customer id', 'company id', 'registration number', 'cin', 'local id', 'cr number', 'trade licence'],
  country: ['country', 'country of risk', 'domicile'], listed: ['listed'],
  sectorStandard: ['sector standard', 'classification'], sectorCode: ['sector code', 'nace code', 'nace', 'gics code', 'gics', 'isic', 'naics', 'industry code'], sectorName: ['sector', 'industry', 'sector name'],
  assetClass: ['asset class', 'instrument type', 'product type', 'product', 'instrument'],
  outstanding: ['outstanding amount', 'outstanding', 'exposure', 'balance', 'market value', 'amount'], currency: ['currency', 'ccy'],
  internalRef: ['loan id', 'facility id', 'position id', 'account number', 'deal id', 'reference', 'ref'], origination: ['origination date', 'origination', 'start date'],
  finYear: ['financial year', 'fiscal year', 'fy'], finCurrency: ['financials currency', 'reporting currency'], evic: ['evic'], equity: ['total equity', 'equity'], debt: ['total debt', 'debt'],
  revenue: ['revenue', 'turnover', 'sales'], totalAssets: ['total assets', 'assets'],
  emYear: ['emissions year', 'ghg year'], s1: ['scope 1', 'scope1', 's1'], s2: ['scope 2', 'scope2', 's2'], s3: ['scope 3', 'scope3', 's3'],
  verified: ['verified', 'assured'], emSource: ['emissions source', 'ghg source'],
};
const TEMPLATE: [string, string, number][] = [
  ['Counterparty name *', 'Legal name of the borrower or investee', 34], ['LEI', '20 characters', 24], ['ISIN', 'Listed securities', 16], ['Customer ID', 'Your internal or registry ID', 16],
  ['Country', '2-letter ISO code', 9], ['Listed', 'yes / no', 8], ['Sector standard', 'NACE (default), GICS, ISIC, NAICS', 14], ['Sector code', 'e.g. C24 (NACE)', 12], ['Sector', 'Name of the sector', 22],
  ['Asset class *', 'listed equity, corporate bond, business loan, unlisted equity', 18], ['Outstanding *', 'At the reporting date', 16], ['Currency *', 'e.g. USD', 9],
  ['Loan ID', 'Your reference', 14], ['Origination date', 'yyyy-mm-dd', 14],
  ['Financial year', 'Of the figures that follow', 12], ['EVIC', 'Listed companies', 16], ['Total equity', '', 16], ['Total debt', '', 16], ['Revenue', '', 16], ['Total assets', '', 16],
  ['Emissions year', '', 12], ['Scope 1', 'tCO2e', 12], ['Scope 2', 'tCO2e', 12], ['Scope 3', 'tCO2e (optional)', 12], ['Verified', 'yes = third-party assured', 9], ['Emissions source', 'e.g. Sustainability report 2025', 28],
];

export async function ekofinRoutes(app: FastifyInstance) {
  app.get('/api/fin/meta', async (req) => finTx(req, async (c) => {
    const libs = (await c.query(`SELECT library, count(*)::int AS n, min(year) AS from_year, max(year) AS to_year, array_agg(DISTINCT sector_standard) AS standards, array_agg(DISTINCT basis) AS bases
                                    FROM fin_factor GROUP BY library ORDER BY library`)).rows;
    return {
      assetClasses: ASSET_CLASSES, scores: SCORE_LABEL, kinds: KINDS, standards: STD, libraries: libs,
      canEdit: canEdit(req), canLock: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), canUnlock: ['super_admin', 'platform_admin'].includes(req.user.role),
      canManage: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), canLayer: ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role),
      canFactors: req.user.role === 'platform_admin',
    };
  }));

  // ------------------------------------------------------------- portfolios --
  app.get('/api/fin/portfolios', async (req) => finTx(req, async (c) => {
    const ps = (await c.query(`SELECT id, name, kind, currency, factor_library, include_scope3, description, archived, created_name, created_at FROM fin_portfolio ORDER BY archived, name`)).rows;
    const periods = (await c.query(
      `SELECT pe.id, pe.portfolio_id, to_char(pe.as_of, 'YYYY-MM-DD') AS as_of, pe.status, pe.locked_name, pe.locked_at,
              (SELECT count(*)::int FROM fin_holding h WHERE h.period_id = pe.id) AS holdings,
              (pe.result -> 'summary' -> 'financed' ->> 'total')::float8 AS locked_total
         FROM fin_period pe ORDER BY pe.as_of DESC`)).rows;
    return { portfolios: ps.map((p) => ({ ...p, periods: periods.filter((x) => x.portfolio_id === p.id) })) };
  }));

  app.post('/api/fin/portfolios', async (req) => {
    requireRole(req, 'super_admin', 'admin');
    const b = portfolioBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      if ((await c.query(`SELECT 1 FROM fin_portfolio WHERE lower(name) = lower($1)`, [b.name])).rowCount) throw new AppError('A portfolio with this name exists', 409, 'DUPLICATE');
      const id = (await c.query(`INSERT INTO fin_portfolio (tenant_id, name, kind, currency, factor_library, include_scope3, description, created_by, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.name, b.kind, b.currency, b.factorLibrary, b.includeScope3, b.description, req.user.id, req.user.name])).rows[0].id;
      await audit(c, req, 'fin.portfolio.create', 'fin_portfolio', id, b);
      return { id };
    });
  });

  app.put('/api/fin/portfolios/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    const b = portfolioBody.extend({ archived: z.boolean().default(false) }).parse(req.body);
    return finTx(req, async (c) => {
      const old = (await c.query(`SELECT currency FROM fin_portfolio WHERE id = $1`, [id])).rows[0];
      if (!old) throw notFound('Portfolio');
      if (old.currency !== b.currency && (await c.query(`SELECT 1 FROM fin_period WHERE portfolio_id = $1 AND status = 'locked'`, [id])).rowCount)
        throw new AppError('The portfolio has locked periods; its reporting currency cannot change');
      if ((await c.query(`SELECT 1 FROM fin_portfolio WHERE lower(name) = lower($1) AND id <> $2`, [b.name, id])).rowCount) throw new AppError('A portfolio with this name exists', 409, 'DUPLICATE');
      await c.query(`UPDATE fin_portfolio SET name=$2, kind=$3, currency=$4, factor_library=$5, include_scope3=$6, description=$7, archived=$8 WHERE id = $1`,
        [id, b.name, b.kind, b.currency, b.factorLibrary, b.includeScope3, b.description, b.archived]);
      await audit(c, req, 'fin.portfolio.update', 'fin_portfolio', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/fin/portfolios/:id', async (req) => {
    requireRole(req, 'super_admin');
    const id = idOf(req);
    return finTx(req, async (c) => {
      if ((await c.query(`SELECT 1 FROM fin_period WHERE portfolio_id = $1 AND status = 'locked'`, [id])).rowCount) throw new AppError('The portfolio has locked periods: archive it instead', 409, 'LOCKED');
      const r = await c.query(`DELETE FROM fin_portfolio WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Portfolio');
      await audit(c, req, 'fin.portfolio.delete', 'fin_portfolio', id, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- periods --
  app.post('/api/fin/portfolios/:id/periods', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ asOf: date, copyFrom: uuid.nullable().optional(), note: z.string().trim().max(500).default('') }).parse(req.body);
    return finTx(req, async (c, tenant) => {
      if (!(await c.query(`SELECT 1 FROM fin_portfolio WHERE id = $1`, [id])).rowCount) throw notFound('Portfolio');
      if ((await c.query(`SELECT 1 FROM fin_period WHERE portfolio_id = $1 AND as_of = $2`, [id, b.asOf])).rowCount) throw new AppError('This portfolio already has a period at that date', 409, 'DUPLICATE');
      const pid = (await c.query(`INSERT INTO fin_period (tenant_id, portfolio_id, as_of, note, created_name) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenant, id, b.asOf, b.note, req.user.name])).rows[0].id;
      let copied = 0;
      if (b.copyFrom) {
        if (!(await c.query(`SELECT 1 FROM fin_period WHERE id = $1 AND portfolio_id = $2`, [b.copyFrom, id])).rowCount) throw notFound('Period to copy');
        copied = (await c.query(`INSERT INTO fin_holding (tenant_id, period_id, counterparty_id, asset_class, outstanding, currency, internal_ref, origination, force_score, force_reason, note, created_name)
                                 SELECT tenant_id, $2, counterparty_id, asset_class, outstanding, currency, internal_ref, origination, force_score, force_reason, note, $3 FROM fin_holding WHERE period_id = $1`,
          [b.copyFrom, pid, req.user.name])).rowCount ?? 0;
      }
      await audit(c, req, 'fin.period.create', 'fin_period', pid, { ...b, copied });
      return { id: pid, copied };
    });
  });

  app.get('/api/fin/periods/:id', async (req) => {
    const id = idOf(req);
    return finTx(req, async (c, tenant) => {
      const p = (await c.query(`SELECT pe.status, pe.result, pe.note, pe.locked_name, pe.locked_at, po.name FROM fin_period pe JOIN fin_portfolio po ON po.id = pe.portfolio_id WHERE pe.id = $1`, [id])).rows[0];
      if (!p) throw notFound('Reporting period');
      if (p.status === 'locked' && p.result) {
        const r = p.result as FinPeriodResult;
        return { ...r, period: { ...r.period, status: 'locked', lockedName: p.locked_name, lockedAt: p.locked_at, note: p.note }, portfolio: { ...r.portfolio, name: p.name }, locked: true };
      }
      return { ...(await computePeriod(c, tenant, id)), locked: false };
    });
  });

  app.delete('/api/fin/periods/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return finTx(req, async (c) => {
      await draftPeriod(c, id);
      await c.query(`DELETE FROM fin_period WHERE id = $1`, [id]);
      await audit(c, req, 'fin.period.delete', 'fin_period', id);
      return { ok: true };
    });
  });

  app.post('/api/fin/periods/:id/lock', async (req) => {
    requireRole(req, ...LOCK);
    const id = idOf(req);
    return finTx(req, async (c, tenant) => {
      await draftPeriod(c, id);
      const r = await computePeriod(c, tenant, id);
      if (!r.lines.length) throw new AppError('There are no holdings to lock');
      await c.query(`UPDATE fin_period SET status = 'locked', result = $2, locked_by = $3, locked_name = $4, locked_at = now() WHERE id = $1`, [id, JSON.stringify(r), req.user.id, req.user.name]);
      await audit(c, req, 'fin.period.lock', 'fin_period', id, { holdings: r.lines.length, financed: r.summary.financed.total, score: r.summary.score });
      return { ok: true };
    });
  });

  app.post('/api/fin/periods/:id/unlock', async (req) => {
    requireRole(req, 'super_admin');
    const id = idOf(req);
    const b = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    return finTx(req, async (c) => {
      const r = await c.query(`UPDATE fin_period SET status = 'draft', result = NULL, locked_by = NULL, locked_name = NULL, locked_at = NULL WHERE id = $1 AND status = 'locked' RETURNING id`, [id]);
      if (!r.rowCount) throw new AppError('This period is not locked');
      await audit(c, req, 'fin.period.unlock', 'fin_period', id, b);
      return { ok: true };
    });
  });

  app.get('/api/fin/periods/:id/export', async (req, reply) => {
    const id = idOf(req);
    const r = await finTx(req, async (c, tenant): Promise<FinPeriodResult> => {
      const p = (await c.query(`SELECT status, result FROM fin_period WHERE id = $1`, [id])).rows[0];
      if (!p) throw notFound('Reporting period');
      return p.status === 'locked' && p.result ? (p.result as FinPeriodResult) : computePeriod(c, tenant, id);
    });
    const q = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rc = r.portfolio.currency;
    const head = ['Counterparty', 'Country', 'Sector', 'Asset class', 'Loan ID', `Outstanding (${rc})`, 'Outstanding (original)', 'Currency', 'Attribution factor', 'Denominator',
      'PCAF score', 'Layer', 'Company Scope 1 (t)', 'Company Scope 2 (t)', 'Company Scope 3 (t)', 'Financed Scope 1 (t)', 'Financed Scope 2 (t)', 'Financed Scope 1+2 (t)', 'Financed Scope 3 (t)',
      'Layer chosen by a user', 'Reason', 'Warnings'];
    const f3 = (x: number | null | undefined) => (x == null ? '' : x.toFixed(3));
    const lines = r.lines.map((l) => [l.name, l.country, l.sector, ASSET_CLASSES[l.assetClass], l.internalRef, l.outstanding.toFixed(2), l.outstandingOrig, l.currency,
      l.result.attribution?.toFixed(6) ?? '', l.result.denominator.kind === 'evic' ? 'EVIC' : l.result.denominator.kind === 'equity_debt' ? 'Equity + debt' : '',
      l.result.score ?? '', l.result.score ? SCORE_LABEL[l.result.score] : '', f3(l.result.company?.s1), f3(l.result.company?.s2), f3(l.result.company?.s3),
      f3(l.result.financed?.s1), f3(l.result.financed?.s2), f3(l.result.financed?.total), f3(l.result.financed?.s3),
      l.forceScore ?? '', l.forceReason ?? '', l.result.warnings.join(' | ')].map(q).join(','));
    const name = `${PRODUCT_SLUG}-ekofin-${r.portfolio.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.period.asOf}.csv`;
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send('\uFEFF' + [head.join(','), ...lines].join('\n'));
  });

  // --------------------------------------------------------------- holdings --
  app.post('/api/fin/periods/:id/holdings', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = holdingBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      await draftPeriod(c, id);
      if (!(await c.query(`SELECT 1 FROM fin_counterparty WHERE id = $1`, [b.counterpartyId])).rowCount) throw notFound('Counterparty');
      const hid = (await c.query(`INSERT INTO fin_holding (tenant_id, period_id, counterparty_id, asset_class, outstanding, currency, internal_ref, origination, note, created_name)
                                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, id, b.counterpartyId, b.assetClass, b.outstanding, b.currency, b.internalRef, b.origination, b.note, req.user.name])).rows[0].id;
      await audit(c, req, 'fin.holding.create', 'fin_holding', hid, b);
      return { id: hid };
    });
  });

  app.put('/api/fin/holdings/:id', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = holdingBody.parse(req.body);
    return finTx(req, async (c) => {
      await draftOfHolding(c, id);
      if (!(await c.query(`SELECT 1 FROM fin_counterparty WHERE id = $1`, [b.counterpartyId])).rowCount) throw notFound('Counterparty');
      await c.query(`UPDATE fin_holding SET counterparty_id=$2, asset_class=$3, outstanding=$4, currency=$5, internal_ref=$6, origination=$7, note=$8, updated_name=$9, updated_at=now() WHERE id = $1`,
        [id, b.counterpartyId, b.assetClass, b.outstanding, b.currency, b.internalRef, b.origination, b.note, req.user.name]);
      await audit(c, req, 'fin.holding.update', 'fin_holding', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/fin/holdings/:id', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    return finTx(req, async (c) => {
      await draftOfHolding(c, id);
      await c.query(`DELETE FROM fin_holding WHERE id = $1`, [id]);
      await audit(c, req, 'fin.holding.delete', 'fin_holding', id);
      return { ok: true };
    });
  });

  app.put('/api/fin/holdings/:id/layer', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = idOf(req);
    const b = z.object({ score: z.number().int().min(1).max(5).nullable(), reason: z.string().trim().max(500).default('') }).parse(req.body);
    if (b.score != null && b.reason.length < 3) throw new AppError('Say why this layer is used instead of the best one');
    return finTx(req, async (c) => {
      await draftOfHolding(c, id);
      await c.query(`UPDATE fin_holding SET force_score = $2, force_reason = $3, updated_name = $4, updated_at = now() WHERE id = $1`, [id, b.score, b.score == null ? null : b.reason, req.user.name]);
      await audit(c, req, b.score == null ? 'fin.holding.layer.reset' : 'fin.holding.layer.force', 'fin_holding', id, b);
      return { ok: true };
    });
  });

  // ----------------------------------------------------------------- import --
  app.get('/api/fin/import-template', async (req, reply) => {
    await finTx(req, async () => null);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Holdings');
    ws.addRow(TEMPLATE.map((t) => t[0]));
    ws.addRow(['Example Steel Company', '', '', 'C-1001', 'AE', 'no', 'NACE', 'C24', 'Manufacture of basic metals', 'business loan', 25000000, 'USD', 'LN-2023-0042', '2023-06-30',
      2025, '', 120000000, 80000000, 300000000, 450000000, '', '', '', '', '', '']);
    styleHeader(ws, TEMPLATE.map((t) => t[2]));
    const help = wb.addWorksheet('Columns');
    help.addRow(['Column', 'What to put']);
    for (const [h, d] of TEMPLATE) help.addRow([h, d]);
    help.addRow([]);
    help.addRow(['Matching', 'A counterparty is matched to an existing one by LEI, then ISIN, then customer ID, then name and country. Otherwise it is created.']);
    help.addRow(['Financials', 'EVIC for listed companies; total equity and total debt for others. Revenue lets the sector factor estimate emissions (PCAF score 4).']);
    help.addRow(['Emissions', 'Reported Scope 1 and 2 (tCO2e). Verified = yes gives PCAF score 1, otherwise 2.']);
    styleHeader(help, [20, 110]);
    return sendWorkbook(reply, wb, 'ekofin-holdings-template.xlsx');
  });

  app.post('/api/fin/periods/:id/import', { bodyLimit: 40 * 1024 * 1024 }, async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const { commit, mode } = z.object({ commit: z.coerce.number().int().min(0).max(1).default(0), mode: z.enum(['add', 'replace']).default('add') }).parse(req.query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'holdings.xlsx'));
    const t = await readTable(req.body, filename, 50000);
    const map = Object.fromEntries(Object.entries(HOLDING_COLS).map(([k, names]) => [k, colOf(t.header, names)])) as Record<string, number>;
    const missing = ['name', 'outstanding'].filter((k) => map[k]! < 0);
    if (missing.length) throw new AppError(`No ${missing.map((m) => (m === 'name' ? 'counterparty name' : 'outstanding amount')).join(' or ')} column found. Columns seen: ${t.header.filter(Boolean).slice(0, 15).join(', ')}`);
    return finTx(req, async (c, tenant) => {
      await draftPeriod(c, id);
      const po = (await c.query(`SELECT po.currency FROM fin_period pe JOIN fin_portfolio po ON po.id = pe.portfolio_id WHERE pe.id = $1`, [id])).rows[0];
      type Cp = { id: string; name: string; norm?: string; country?: string | null };
      const cps = (await c.query(`SELECT id, name, norm, country, lei, isin, local_id FROM fin_counterparty`)).rows;
      const byLei = new Map<string, Cp>(cps.filter((x) => x.lei).map((x) => [x.lei, x])), byIsin = new Map<string, Cp>(cps.filter((x) => x.isin).map((x) => [x.isin, x]));
      const byLocal = new Map<string, Cp>(cps.filter((x) => x.local_id).map((x) => [String(x.local_id).toLowerCase(), x]));
      const byNorm = new Map<string, Cp[]>();
      for (const x of cps) byNorm.set(x.norm, [...(byNorm.get(x.norm) ?? []), x]);
      const out: { row: number; name: string; action: 'match' | 'new' | 'error'; detail: string }[] = [];
      const fresh = new Map<string, string>(); // a company that appears in the file but not in the register: key → id once created
      let holdings = 0, newCps = 0, fins = 0, ems = 0;
      if (commit && mode === 'replace') await c.query(`DELETE FROM fin_holding WHERE period_id = $1`, [id]);
      for (const [i, r] of t.rows.entries()) {
        const get = (k: string) => (map[k]! >= 0 ? cellText(r[map[k]!]) : '');
        const name = get('name');
        if (!name) continue;
        const row = i + 1, errs: string[] = [];
        const lei = get('lei').toUpperCase().replace(/\s+/g, ''), isin = get('isin').toUpperCase().replace(/\s+/g, ''), localId = get('localId'), country = get('country').toUpperCase();
        if (lei && !/^[A-Z0-9]{20}$/.test(lei)) errs.push(`LEI "${lei}" is not 20 letters and digits`);
        if (isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) errs.push(`ISIN "${isin}" is not valid`);
        if (country && !/^[A-Z]{2}$/.test(country)) errs.push(`Country "${country}" is not a 2-letter code`);
        const listed = map.listed! >= 0 ? yes(get('listed')) : !!isin;
        const ac = map.assetClass! >= 0 && get('assetClass') ? assetClassOf(get('assetClass'), listed) : (listed ? 'listed_equity' : 'business_loan');
        if (!ac) errs.push(`Asset class "${get('assetClass')}" not recognised (listed equity, corporate bond, business loan, unlisted equity)`);
        const amount = num(get('outstanding'));
        if (amount == null || Number.isNaN(amount) || amount < 0) errs.push(`Outstanding "${get('outstanding')}" is not an amount`);
        const ccy = (get('currency') || po.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(ccy)) errs.push(`Currency "${ccy}" is not a 3-letter code`);
        const orig = get('origination') ? toIsoDate(get('origination')) : null;
        const std = (get('sectorStandard').toUpperCase() || 'NACE') as (typeof STD)[number];
        if (!STD.includes(std)) errs.push(`Sector standard "${std}" (NACE, GICS, ISIC, NAICS or OTHER)`);
        const f = { year: num(get('finYear')), evic: num(get('evic')), equity: num(get('equity')), debt: num(get('debt')), revenue: num(get('revenue')), totalAssets: num(get('totalAssets')) };
        const e = { year: num(get('emYear')), s1: num(get('s1')), s2: num(get('s2')), s3: num(get('s3')) };
        for (const [k, v] of Object.entries({ ...f, emissionsYear: e.year, s1: e.s1, s2: e.s2, s3: e.s3 })) if (Number.isNaN(v)) errs.push(`${k} is not a number`);
        const hasFin = [f.evic, f.equity, f.debt, f.revenue, f.totalAssets].some((x) => x != null);
        const hasEm = e.s1 != null || e.s2 != null;
        if (hasFin && f.year == null) errs.push('Financial figures need the financial year');
        if (hasEm && (e.year == null || e.s1 == null || e.s2 == null)) errs.push('Emissions need the year, Scope 1 and Scope 2');
        if (errs.length) { out.push({ row, name, action: 'error', detail: errs.join('; ') }); continue; }
        // an existing counterparty: LEI, then ISIN, then customer ID, then the same name (and country, when both have one)
        const norm = normCompany(name) || name.toLowerCase();
        let m: Cp | undefined, how = '';
        if (lei && byLei.get(lei)) { m = byLei.get(lei); how = 'LEI'; }
        else if (isin && byIsin.get(isin)) { m = byIsin.get(isin); how = 'ISIN'; }
        else if (localId && byLocal.get(localId.toLowerCase())) { m = byLocal.get(localId.toLowerCase()); how = 'customer ID'; }
        else { const cand = (byNorm.get(norm) ?? []).filter((x) => !country || !x.country || x.country === country); if (cand.length === 1) { m = cand[0]; how = 'name'; } }
        const key = lei || isin || (localId ? `id:${localId.toLowerCase()}` : `n:${norm}:${country}`);
        const again = !m && fresh.has(key);
        out.push({ row, name, action: m || again ? 'match' : 'new',
          detail: `${m ? `${how}: ${m.name}` : again ? 'same new company as an earlier row' : 'new counterparty'} · ${ASSET_CLASSES[ac!]} · ${ccy} ${amount!.toLocaleString('en-GB')}${hasFin ? ` · FY ${f.year}` : ''}${hasEm ? ` · emissions ${e.year}` : ''}` });
        if (!commit) { if (!m) fresh.set(key, ''); continue; }
        let cpId = m?.id ?? fresh.get(key);
        if (!cpId) {
          cpId = (await c.query(`INSERT INTO fin_counterparty (tenant_id, name, norm, country, lei, isin, local_id, listed, sector_standard, sector_code, sector_name, created_name)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [tenant, name, norm, country || null, lei || null, isin || null, localId || null, listed, std, get('sectorCode').toUpperCase() || null, get('sectorName') || null, req.user.name])).rows[0].id as string;
          fresh.set(key, cpId); newCps++;
          const cp: Cp = { id: cpId, name, norm, country: country || null };
          if (lei) byLei.set(lei, cp);
          if (isin) byIsin.set(isin, cp);
        } else if (m) {
          // fill only the blanks of an existing counterparty: the file never overwrites what someone typed
          await c.query(`UPDATE fin_counterparty SET country = coalesce(country, $2), local_id = coalesce(local_id, $3), sector_code = coalesce(sector_code, $4), sector_name = coalesce(sector_name, $5) WHERE id = $1`,
            [cpId, country || null, localId || null, get('sectorCode').toUpperCase() || null, get('sectorName') || null]);
        }
        if (hasFin) {
          await c.query(`INSERT INTO fin_financials (tenant_id, counterparty_id, year, currency, evic, equity, debt, revenue, total_assets, source, updated_name)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                         ON CONFLICT (counterparty_id, year) DO UPDATE SET currency = EXCLUDED.currency, evic = coalesce(EXCLUDED.evic, fin_financials.evic), equity = coalesce(EXCLUDED.equity, fin_financials.equity),
                           debt = coalesce(EXCLUDED.debt, fin_financials.debt), revenue = coalesce(EXCLUDED.revenue, fin_financials.revenue), total_assets = coalesce(EXCLUDED.total_assets, fin_financials.total_assets),
                           source = EXCLUDED.source, updated_name = EXCLUDED.updated_name, updated_at = now()`,
            [tenant, cpId, f.year, (get('finCurrency') || ccy).toUpperCase(), f.evic, f.equity, f.debt, f.revenue, f.totalAssets, `Upload ${filename}`, req.user.name]);
          fins++;
        }
        if (hasEm) {
          await c.query(`INSERT INTO fin_emission (tenant_id, counterparty_id, year, score, s1, s2, s3, source, created_by, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                         ON CONFLICT (counterparty_id, year, score) DO UPDATE SET s1 = EXCLUDED.s1, s2 = EXCLUDED.s2, s3 = EXCLUDED.s3, source = EXCLUDED.source, created_name = EXCLUDED.created_name, created_at = now()`,
            [tenant, cpId, e.year, yes(get('verified')) ? 1 : 2, e.s1, e.s2, e.s3, get('emSource') || `Upload ${filename}`, req.user.id, req.user.name]);
          ems++;
        }
        await c.query(`INSERT INTO fin_holding (tenant_id, period_id, counterparty_id, asset_class, outstanding, currency, internal_ref, origination, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tenant, id, cpId, ac, amount, ccy, get('internalRef') || null, orig, req.user.name]);
        holdings++;
      }
      const n = (a: string) => out.filter((x) => x.action === a).length;
      if (commit) {
        if (n('error')) throw new AppError(`${n('error')} row${n('error') === 1 ? ' has' : 's have'} problems; fix them and upload again (nothing was saved)`, 400, 'ROWS_INVALID');
        await audit(c, req, 'fin.import', 'fin_period', id, { filename, mode, holdings, newCounterparties: newCps, financials: fins, emissions: ems });
      }
      return {
        committed: !!commit, mode, columns: Object.fromEntries(Object.entries(map).filter(([, v]) => v >= 0).map(([k, v]) => [k, t.header[v] ?? ''])),
        totals: { rows: out.length, match: n('match'), new: n('new'), error: n('error') },
        saved: { holdings, counterparties: newCps, financials: fins, emissions: ems }, rows: out.slice(0, 500),
      };
    });
  });

  // --------------------------------------------------------- counterparties --
  app.get('/api/fin/counterparties', async (req) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    return finTx(req, async (c) => ({
      counterparties: (await c.query(
        `SELECT cp.id, cp.name, cp.country, cp.lei, cp.isin, cp.local_id, cp.listed, cp.sector_standard, cp.sector_code, cp.sector_name,
                (SELECT count(*)::int FROM fin_holding h WHERE h.counterparty_id = cp.id) AS holdings,
                (SELECT max(year) FROM fin_financials f WHERE f.counterparty_id = cp.id) AS fin_year,
                (SELECT min(score) FROM fin_emission e WHERE e.counterparty_id = cp.id) AS best_score,
                (SELECT max(year) FROM fin_emission e WHERE e.counterparty_id = cp.id) AS em_year
           FROM fin_counterparty cp
          WHERE $1::text IS NULL OR cp.norm LIKE '%' || $2 || '%' OR cp.lei = upper($1) OR cp.isin = upper($1) OR lower(cp.local_id) = lower($1)
          ORDER BY cp.name LIMIT 2000`, [q || null, q ? normCompany(q) || q.toLowerCase() : ''])).rows,
    }));
  });

  app.get('/api/fin/counterparties/:id', async (req) => {
    const id = idOf(req);
    return finTx(req, async (c) => {
      const cp = (await c.query(`SELECT * FROM fin_counterparty WHERE id = $1`, [id])).rows[0];
      if (!cp) throw notFound('Counterparty');
      const financials = (await c.query(`SELECT id, year, currency, evic::float8 AS evic, equity::float8 AS equity, debt::float8 AS debt, revenue::float8 AS revenue, total_assets::float8 AS total_assets, source, updated_name, updated_at
                                           FROM fin_financials WHERE counterparty_id = $1 ORDER BY year DESC`, [id])).rows;
      const emissions = (await c.query(`SELECT e.id, e.year, e.score, e.s1::float8 AS s1, e.s2::float8 AS s2, e.s3::float8 AS s3, e.source, e.note, e.document_id, d.filename AS document, e.created_name, e.created_at
                                          FROM fin_emission e LEFT JOIN document d ON d.id = e.document_id WHERE e.counterparty_id = $1 ORDER BY e.year DESC, e.score`, [id])).rows;
      const holdings = (await c.query(
        `SELECT h.id, h.asset_class, h.outstanding::float8 AS outstanding, h.currency, h.internal_ref, h.force_score, po.id AS portfolio_id, po.name AS portfolio, pe.id AS period_id, to_char(pe.as_of, 'YYYY-MM-DD') AS as_of, pe.status
           FROM fin_holding h JOIN fin_period pe ON pe.id = h.period_id JOIN fin_portfolio po ON po.id = pe.portfolio_id WHERE h.counterparty_id = $1 ORDER BY pe.as_of DESC, po.name`, [id])).rows;
      const libs = [...new Set((await c.query(`SELECT factor_library FROM fin_portfolio WHERE factor_library IS NOT NULL AND NOT archived`)).rows.map((x) => x.factor_library as string))];
      const rows = libs.length ? (await c.query(`SELECT library, sector_standard, sector_code, sector_name, region, year, basis, currency, s1::float8 AS s1, s2::float8 AS s2, s3::float8 AS s3, source
                                                  FROM fin_factor WHERE library = ANY($1) AND sector_standard = $2`, [libs, cp.sector_standard])).rows : [];
      const y = new Date().getUTCFullYear();
      const factors = libs.flatMap((lib) => (['revenue', 'assets'] as const).map((basis) => pickFactor(rows.filter((r) => r.library === lib), cp.sector_standard, cp.sector_code, cp.country, basis, y)))
        .filter((x) => x != null);
      return {
        counterparty: cp, financials, emissions, holdings, factors,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 200`)).rows,
      };
    });
  });

  app.post('/api/fin/counterparties', async (req) => {
    requireRole(req, ...EDIT);
    const b = counterpartyBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      const id = await upsertCounterparty(c, tenant, req, b);
      await audit(c, req, 'fin.counterparty.create', 'fin_counterparty', id, b);
      return { id };
    });
  });

  app.put('/api/fin/counterparties/:id', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = counterpartyBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      await upsertCounterparty(c, tenant, req, b, id);
      await audit(c, req, 'fin.counterparty.update', 'fin_counterparty', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/fin/counterparties/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return finTx(req, async (c) => {
      if ((await c.query(`SELECT 1 FROM fin_holding WHERE counterparty_id = $1`, [id])).rowCount) throw new AppError('This counterparty has holdings; remove them first', 409, 'IN_USE');
      const r = await c.query(`DELETE FROM fin_counterparty WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Counterparty');
      await audit(c, req, 'fin.counterparty.delete', 'fin_counterparty', id, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  app.put('/api/fin/counterparties/:id/financials', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = financialsBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      if (!(await c.query(`SELECT 1 FROM fin_counterparty WHERE id = $1`, [id])).rowCount) throw notFound('Counterparty');
      const r = (await c.query(`INSERT INTO fin_financials (tenant_id, counterparty_id, year, currency, evic, equity, debt, revenue, total_assets, source, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                                ON CONFLICT (counterparty_id, year) DO UPDATE SET currency = EXCLUDED.currency, evic = EXCLUDED.evic, equity = EXCLUDED.equity, debt = EXCLUDED.debt, revenue = EXCLUDED.revenue,
                                  total_assets = EXCLUDED.total_assets, source = EXCLUDED.source, updated_name = EXCLUDED.updated_name, updated_at = now() RETURNING id`,
        [tenant, id, b.year, b.currency, b.evic, b.equity, b.debt, b.revenue, b.totalAssets, b.source, req.user.name])).rows[0];
      await audit(c, req, 'fin.financials.save', 'fin_financials', r.id, { counterparty: id, ...b });
      return { id: r.id };
    });
  });

  app.delete('/api/fin/financials/:id', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    return finTx(req, async (c) => {
      const r = await c.query(`DELETE FROM fin_financials WHERE id = $1 RETURNING counterparty_id, year`, [id]);
      if (!r.rowCount) throw notFound('Financial year');
      await audit(c, req, 'fin.financials.delete', 'fin_financials', id, r.rows[0]);
      return { ok: true };
    });
  });

  app.put('/api/fin/counterparties/:id/emissions', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = emissionBody.parse(req.body);
    return finTx(req, async (c, tenant) => {
      if (!(await c.query(`SELECT 1 FROM fin_counterparty WHERE id = $1`, [id])).rowCount) throw notFound('Counterparty');
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      if (b.score === 1 && !b.documentId) throw new AppError('Verified emissions (score 1) need the assurance statement or report: attach it from the Document vault');
      const r = (await c.query(`INSERT INTO fin_emission (tenant_id, counterparty_id, year, score, s1, s2, s3, source, document_id, note, created_by, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                                ON CONFLICT (counterparty_id, year, score) DO UPDATE SET s1 = EXCLUDED.s1, s2 = EXCLUDED.s2, s3 = EXCLUDED.s3, source = EXCLUDED.source, document_id = EXCLUDED.document_id,
                                  note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_name = EXCLUDED.created_name, created_at = now() RETURNING id`,
        [tenant, id, b.year, b.score, b.s1, b.s2, b.s3, b.source, b.documentId, b.note, req.user.id, req.user.name])).rows[0];
      await audit(c, req, 'fin.emissions.save', 'fin_emission', r.id, { counterparty: id, ...b });
      return { id: r.id };
    });
  });

  app.delete('/api/fin/emissions/:id', async (req) => {
    requireRole(req, ...EDIT);
    const id = idOf(req);
    return finTx(req, async (c) => {
      const r = await c.query(`DELETE FROM fin_emission WHERE id = $1 RETURNING counterparty_id, year, score`, [id]);
      if (!r.rowCount) throw notFound('Emissions record');
      await audit(c, req, 'fin.emissions.delete', 'fin_emission', id, r.rows[0]);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- factors --
  app.get('/api/fin/factors', async (req) => {
    const { library } = z.object({ library: z.string().trim().max(80).optional() }).parse(req.query);
    if (req.user.role !== 'platform_admin') await finTx(req, async () => null);
    return platformTx(async (c) => {
      const libraries = (await c.query(`SELECT library, count(*)::int AS n, min(year) AS from_year, max(year) AS to_year, array_agg(DISTINCT sector_standard) AS standards, max(created_at) AS loaded_at
                                          FROM fin_factor GROUP BY library ORDER BY library`)).rows;
      const lib = library ?? libraries[0]?.library;
      const rows = lib ? (await c.query(`SELECT id, sector_standard, sector_code, sector_name, region, year, basis, currency, s1::float8 AS s1, s2::float8 AS s2, s3::float8 AS s3, source, note
                                           FROM fin_factor WHERE library = $1 ORDER BY sector_standard, sector_code, region, year DESC, basis LIMIT 5000`, [lib])).rows : [];
      return { libraries, library: lib ?? null, rows, canEdit: req.user.role === 'platform_admin' };
    });
  });

  app.get('/api/fin/factors/template', async (req, reply) => {
    requirePlatformAdmin(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Factors');
    const cols: [string, number][] = [['Library *', 24], ['Sector standard *', 14], ['Sector code *', 12], ['Sector name', 34], ['Region', 9], ['Year *', 8], ['Basis *', 10], ['Currency *', 9],
      ['Scope 1 *', 12], ['Scope 2 *', 12], ['Scope 3', 12], ['Source *', 40], ['Note', 30]];
    ws.addRow(cols.map((x) => x[0]));
    styleHeader(ws, cols.map((x) => x[1]));
    const help = wb.addWorksheet('How to fill');
    help.addRow(['Column', 'What to put']);
    for (const l of [['Basis', 'revenue = tCO2e per million of revenue (PCAF score 4); assets = tCO2e per million of total assets (score 5)'],
      ['Scope 1 / 2 / 3', 'tCO2e per million of the currency'], ['Region', 'GLOBAL or a 2-letter country code'],
      ['Sector code', 'A shorter code applies to every longer code that starts with it (C24 covers C24.1, C24.10…)'],
      ['Source', 'Name and version of the database the values come from. Check its licence allows use in this platform.']]) help.addRow(l);
    styleHeader(help, [18, 110]);
    return sendWorkbook(reply, wb, 'ekofin-sector-factors-template.xlsx');
  });

  app.post('/api/fin/factors/import', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const { commit } = z.object({ commit: z.coerce.number().int().min(0).max(1).default(0) }).parse(req.query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'factors.xlsx'));
    const t = await readTable(req.body, filename, 100000);
    const C: Record<string, string[]> = { library: ['library'], std: ['sector standard', 'standard'], code: ['sector code', 'code'], name: ['sector name', 'sector'], region: ['region', 'country'],
      year: ['year'], basis: ['basis'], currency: ['currency'], s1: ['scope 1', 's1'], s2: ['scope 2', 's2'], s3: ['scope 3', 's3'], source: ['source'], note: ['note'] };
    const map = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, colOf(t.header, v)])) as Record<string, number>;
    const miss = ['library', 'code', 'year', 'basis', 's1', 's2', 'source'].filter((k) => map[k]! < 0);
    if (miss.length) throw new AppError(`Missing columns: ${miss.join(', ')}. Use the template.`);
    const rows: (string | number | null)[][] = [], errors: { row: number; detail: string }[] = [];
    for (const [i, r] of t.rows.entries()) {
      const get = (k: string) => (map[k]! >= 0 ? cellText(r[map[k]!]) : '');
      if (!get('code') && !get('library')) continue;
      const e: string[] = [];
      const std = (get('std') || 'NACE').toUpperCase(), basis = get('basis').toLowerCase(), region = (get('region') || 'GLOBAL').toUpperCase(), ccy = (get('currency') || 'USD').toUpperCase();
      const year = num(get('year')), s1 = num(get('s1')), s2 = num(get('s2')), s3 = num(get('s3'));
      if (get('library').length < 2) e.push('library');
      if (!(STD as readonly string[]).includes(std)) e.push(`sector standard "${std}"`);
      if (!['revenue', 'assets'].includes(basis)) e.push(`basis "${basis}" (revenue or assets)`);
      if (region !== 'GLOBAL' && !/^[A-Z]{2}$/.test(region)) e.push(`region "${region}"`);
      if (!/^[A-Z]{3}$/.test(ccy)) e.push(`currency "${ccy}"`);
      if (year == null || Number.isNaN(year) || year < 1990 || year > 2100) e.push('year');
      for (const [k, v] of [['Scope 1', s1], ['Scope 2', s2]] as const) if (v == null || Number.isNaN(v) || v < 0) e.push(k);
      if (s3 != null && (Number.isNaN(s3) || s3 < 0)) e.push('Scope 3');
      if (!get('source')) e.push('source');
      if (e.length) { errors.push({ row: i + 1, detail: `Check: ${e.join(', ')}` }); continue; }
      rows.push([get('library'), std, get('code').toUpperCase().replace(/\s+/g, ''), get('name') || null, region, year, basis, ccy, s1, s2, s3, get('source'), get('note') || null]);
    }
    if (commit && errors.length) throw new AppError(`${errors.length} rows have problems; nothing was loaded`, 400, 'ROWS_INVALID');
    let saved = 0;
    const libraries = [...new Set(rows.map((r) => String(r[0])))];
    if (commit) await platformTx(async (c) => {
      for (const r of rows) {
        await c.query(`INSERT INTO fin_factor (library, sector_standard, sector_code, sector_name, region, year, basis, currency, s1, s2, s3, source, note, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                       ON CONFLICT (library, sector_standard, sector_code, region, year, basis) DO UPDATE SET sector_name = EXCLUDED.sector_name, currency = EXCLUDED.currency, s1 = EXCLUDED.s1, s2 = EXCLUDED.s2,
                         s3 = EXCLUDED.s3, source = EXCLUDED.source, note = EXCLUDED.note, created_name = EXCLUDED.created_name, created_at = now()`, [...r, req.user.name]);
        saved++;
      }
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES (NULL,$1,$2,'fin.factors.import','fin_factor',NULL,$3,$4)`,
        [req.user.id, req.user.name, JSON.stringify({ filename, rows: saved, libraries }), req.ip]);
    });
    return { committed: !!commit, rows: rows.length, saved, errors: errors.slice(0, 300), libraries };
  });

  app.delete('/api/fin/factors/library', async (req) => {
    requirePlatformAdmin(req);
    const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.query);
    return platformTx(async (c) => {
      const used = (await c.query(`SELECT count(*)::int AS n FROM fin_portfolio WHERE factor_library = $1`, [name])).rows[0].n as number;
      if (used) throw new AppError(`${used} portfolio${used === 1 ? ' uses' : 's use'} this library; choose another library for ${used === 1 ? 'it' : 'them'} first`, 409, 'IN_USE');
      const r = await c.query(`DELETE FROM fin_factor WHERE library = $1`, [name]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES (NULL,$1,$2,'fin.factors.delete','fin_factor',NULL,$3,$4)`,
        [req.user.id, req.user.name, JSON.stringify({ library: name, rows: r.rowCount }), req.ip]);
      return { deleted: r.rowCount };
    });
  });
}
