/**
 * The months picked in Add data, entered side by side — one row per month, as in the prototype.
 *
 *  - Month · Type (when the form offers several) · Quantity · Note / reference and data type ·
 *    Emissions (calculated as you type; "How?" opens the split per gas, the factors and the steps) ·
 *    Check (against this entry's own history: seasonal band or 6-month average, as set under
 *    Methodology — the same check the approver sees) · + line
 *  - Paste a column of numbers from Excel into the first quantity: it fills the next rows.
 *  - Months that already have the same entry are marked "entered", so nothing goes in twice.
 *  - Save as draft, or Submit for approval (goes to the facility's approver). A row with a
 *    problem stays on screen; the others are saved.
 *
 * The other inputs (fuel, supplier, vehicle, factor…) are set once in the form above.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, BASIS_SHORT, num, tco2e, type Activity, type Basis, type CalcResponse, type RangeCheck } from '../lib/api';
import { Result } from './Result';
import { Icon } from './Icon';
import { useApp } from '../App';
import { useNavigate } from 'react-router-dom';
import { saveDraft } from './MeterForm';
import { useEntry } from './EntryContext';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const monthPeriod = (year: number, m: number) => ({
  periodStart: `${year}-${pad(m + 1)}-01`,
  periodEnd: `${year}-${pad(m + 1)}-${pad(new Date(Date.UTC(year, m + 1, 0)).getUTCDate())}`,
});
/** "12,345.6" → "12345.6"; empty or not a number → '' */
const cleanNum = (s: string) => { const x = s.replace(/[\s,]/g, ''); return x === '' || !Number.isFinite(Number(x)) ? '' : x; };

type Row = { k: number; m: number; v: string; note: string; dt: string; type: string };
let K = 1;
/** the type last chosen on a row, per list of types — kept while the person moves between months (even with none picked) */
const chosen = new Map<string, string>();
const defaultType = (types?: { id: string }[]) => { const c = chosen.get(types?.map((t) => t.id).join(',') ?? ''); return types?.some((t) => t.id === c) ? c! : types?.[0]?.id ?? ''; };
const blank = (m: number, type = ''): Row => ({ k: K++, m, v: '', note: '', dt: 'actual', type });

export function MonthGrid({ year, facilityId, label, unitName, build, bases = ['direct'], dup, onSaved, hint, meterUnit, types, factorText }: {
  year: number;
  facilityId: string;
  /** what is entered each month, e.g. "Diesel used" */
  label: string;
  unitName: string;
  /** the entry for one row; null while the form above is incomplete. `type` is the row's choice from `types`. */
  build: (value: number, period: { periodStart: string; periodEnd: string }, type?: string) => Record<string, unknown> | null;
  /** totals shown per row */
  bases?: Basis[];
  /** flag months that already have this entry: category code and how to recognise the same entry */
  dup?: { category: string; same: (a: Activity, type?: string) => boolean };
  onSaved: () => void;
  hint?: string;
  /** unit of a meter set up from these inputs (default: the entry's unit) */
  meterUnit?: string;
  /** a type per row (e.g. the fuel), when the form offers several */
  types?: { id: string; name: string }[];
  /** the factor line under the rows */
  factorText?: string;
}) {
  const { toast, role } = useApp();
  const { months, approver, changed } = useEntry();
  const navigate = useNavigate();
  const picked = useMemo(() => months ?? MONTHS.map((_, i) => i), [months]);
  const firstType = types?.[0]?.id ?? '';
  const [rows, setRows] = useState<Row[]>(() => picked.map((m) => blank(m, defaultType(types))));
  const typesKey = types?.map((t) => t.id).join(',') ?? '';
  // Rows follow the months picked above: keep what was typed for months still picked.
  useEffect(() => {
    setRows((old) => {
      const keep = old.filter((r) => picked.includes(r.m));
      // months added later take the type last chosen (e.g. petrol picked for January, then all months), not the first type
      const t = defaultType(types);
      const add = picked.filter((m) => !keep.some((r) => r.m === m)).map((m) => blank(m, t));
      return [...keep, ...add].sort((a, b) => a.m - b.m || a.k - b.k);
    });
  }, [picked.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new list of types (another fuel class): rows take its first type.
  useEffect(() => { setRows((old) => old.map((r) => (types?.some((t) => t.id === r.type) ? r : { ...r, type: firstType }))); }, [types?.map((t) => t.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toMeter = () => {
    const p = build(1, monthPeriod(year, 0), firstType || undefined);
    if (!p) return;
    const { itemId, unit, quantity: _q, periodStart: _s, periodEnd: _e, facilityId: _f, ...template } = p as Record<string, unknown>;
    void _q; void _s; void _e; void _f;
    saveDraft({ facilityId, itemId: Number(itemId), unit: meterUnit ?? String(unit), template, label, readingType: 'interval', frequency: 'day' });
    navigate('/meters?new=1');
  };
  const [res, setRes] = useState<Record<number, { totals?: Record<Basis, number>; error?: string; warnings?: string[] }>>({});
  const [existing, setExisting] = useState<Activity[]>([]);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  // "How?" on a row: the full calculation of that row (per gas, factors, steps)
  const [how, setHow] = useState<{ k: number; m: number; v: string; unit: string; r?: CalcResponse; error?: string } | null>(null);
  const openHow = (r: Row) => {
    const e = entries.find((x) => x.k === r.k);
    if (!e?.body) return;
    const { dataType: _d, note: _n, ...body } = e.body as Record<string, unknown>; void _d; void _n;
    setHow({ k: r.k, m: r.m, v: r.v, unit: unitName });
    api.calculate(body).then((x) => setHow((h) => (h && h.k === r.k ? { ...h, r: x } : h))).catch((err: Error) => setHow((h) => (h && h.k === r.k ? { ...h, error: err.message } : h)));
  };

  const entries = useMemo(() => rows.filter((r) => r.v !== '').map((r) => {
    const body = build(Number(r.v), monthPeriod(year, r.m), r.type || undefined);
    return { k: r.k, m: r.m, body: body ? { ...body, facilityId, dataType: r.dt, note: r.note || undefined } : null };
  }), [rows, build, year, facilityId]);
  const ready = entries.length > 0 && entries.every((e) => e.body);
  const key = JSON.stringify(entries);

  useEffect(() => {
    if (!ready) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.batch(entries.map((e) => e.body), true).then((b) => {
        const r: typeof res = {};
        b.results.forEach((x, i) => { r[entries[i]!.k] = x.ok ? { totals: x.totals, warnings: x.warnings } : { error: x.error }; });
        setRes(r);
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // range check of each typed month against the entry's approved history (server: lib/rangeCheck)
  const [rc, setRc] = useState<Record<number, RangeCheck | null>>({});
  useEffect(() => {
    const list = entries.filter((e) => e.body && (e.body as Record<string, unknown>).itemId != null);
    if (!list.length) { setRc({}); return; }
    const t = window.setTimeout(() => {
      api.rangeCheck(list.map((e) => { const b = e.body as Record<string, unknown>; return { facilityId: b.facilityId, itemId: b.itemId, unit: b.unit, sub: (b.vehicle as { vehicleId?: string } | undefined)?.vehicleId ?? (b.meterId as string | undefined) ?? null, periodStart: b.periodStart, periodEnd: b.periodEnd, quantity: b.quantity }; }))
        .then((x) => { const r: Record<number, RangeCheck | null> = {}; x.checks.forEach((c, i) => { r[list[i]!.k] = c; }); setRc(r); }).catch(() => setRc({}));
    }, 400);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadExisting = () => { if (dup && facilityId) api.activities({ facilityId, category: dup.category, limit: 1000 }).then((r) => setExisting(r.activities)).catch(() => {}); };
  useEffect(loadExisting, [facilityId, year, dup?.category]); // eslint-disable-line react-hooks/exhaustive-deps
  /** months of this year that already have the same entry (per type) */
  const taken = (m: number, type: string) => !!dup && existing.some((a) => dup.same(a, type || undefined) && a.period_start.slice(0, 7) === `${year}-${pad(m + 1)}` && a.period_end.slice(0, 7) === a.period_start.slice(0, 7));
  const check = (r: Row) => {
    if (r.v === '') return { cls: 'muted', t: 'Checked when you type' };
    const x = res[r.k];
    if (x?.error) return { cls: 'bad', t: x.error };
    if (taken(r.m, r.type)) return { cls: 'warn', t: `! ${MONTHS[r.m]} already has this entry` };
    const k = rc[r.k];
    if (k && !k.ok) return { cls: 'warn', t: `! ${k.txt.replace(/ — add a note$/, '')} — explain in the note`, tip: k.basis };
    if (k) return { cls: 'ok', t: `✓ ${k.txt}`, tip: k.basis };
    return { cls: 'ok', t: '✓ No history yet to compare' };
  };

  // Paste a column (or row) of numbers: fills this row and the rows below.
  const paste = (k: number, text: string) => {
    const cells = text.split(/[\t\r\n]+/).map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 2) return false;
    setRows((rs) => { const i = rs.findIndex((r) => r.k === k); return rs.map((r, j) => (j >= i && j - i < cells.length ? { ...r, v: cleanNum(cells[j - i]!) } : r)); });
    return true;
  };
  const set = (k: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...p } : r)));

  const main = bases[0]!;
  const total = (b: Basis) => Object.values(res).reduce((s, x) => s + (x.totals?.[b] ?? 0), 0);
  const okRows = entries.filter((e) => res[e.k]?.totals).length;
  const shown = bases.filter((b, i) => i === 0 || total(b) !== 0);

  const save = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'draft');
    try {
      const b = await api.batch(entries.map((e) => e.body), false);
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.k));
      const ids = b.results.filter((x) => x.ok && x.id).map((x) => x.id!);
      if (submit && ids.length) await api.reviewAction(ids, 'submit');
      toast(`${b.saved} row${b.saved === 1 ? '' : 's'} ${submit ? `submitted to ${approver || 'the approver'}` : 'saved as draft'}${b.failed ? `, ${b.failed} with problems (still on screen)` : ''}`);
      setRows((rs) => rs.map((r) => (failed.has(r.k) || r.v === '' ? r : { ...blank(r.m, r.type) })).filter((r, i, all) => failed.has(r.k) || all.findIndex((x) => x.m === r.m) === i));
      loadExisting(); onSaved(); changed();
    } finally { setBusy(null); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row"><b className="grow" style={{ fontSize: 15 }}>{label}</b>
        {['platform_admin', 'super_admin', 'admin', 'manager'].includes(role) && <button className="btn ghost sm" title="Readings arrive from a system or from bills: set up a meter with the inputs above" disabled={!build(1, monthPeriod(year, 0), firstType || undefined)} onClick={toMeter}>Set up a meter with these inputs →</button>}
      </div>
      {hint && <div className="sub">{hint}</div>}
      <div className="scrollx"><table className="t rows">
        <thead><tr><th>Month</th>{types && <th>Type</th>}<th>Quantity</th><th>Note / reference</th><th className="num">Emissions</th><th>Check</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const x = res[r.k], c = check(r), again = i > 0 && rows[i - 1]!.m === r.m;
          return (
            <tr key={r.k} className={x?.error ? 'bad' : ''}>
              <td style={{ width: 90 }}>{again ? <span className="muted small">+ line</span> : <b>{MONTHS[r.m]}<br />{year}</b>}</td>
              {types && <td style={{ minWidth: 170 }}><select className="input" value={r.type} onChange={(e) => { chosen.set(typesKey, e.target.value); set(r.k, { type: e.target.value }); }}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>}
              <td style={{ minWidth: 170 }}><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input className="input num" style={{ width: 120 }} inputMode="decimal" value={r.v} placeholder="0" aria-label={`${MONTHS[r.m]} quantity`}
                  onPaste={(e) => { if (paste(r.k, e.clipboardData.getData('text'))) e.preventDefault(); }}
                  onChange={(e) => set(r.k, { v: e.target.value.replace(/[^0-9.]/g, '') })} />
                <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{unitName}</span></div></td>
              <td style={{ minWidth: 160 }}><div style={{ display: 'grid', gap: 4 }}>
                <input className="input" value={r.note} maxLength={1000} placeholder={c.cls === 'warn' && rc[r.k] && !rc[r.k]!.ok ? 'Why is it different? (e.g. new chiller)' : 'Meter, invoice no.'} onChange={(e) => set(r.k, { note: e.target.value })} />
                <select className="input" value={r.dt} onChange={(e) => set(r.k, { dt: e.target.value })}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></div></td>
              <td className="num" style={{ minWidth: 100 }}><b style={{ fontSize: 14 }}>{x?.totals ? tco2e(x.totals[main] ?? 0) : '—'}</b><div className="muted small">tCO₂e{bases.length > 1 && x?.totals && (x.totals[bases[1]!] ?? 0) !== 0 ? ` · ${BASIS_SHORT[bases[1]!]} ${tco2e(x.totals[bases[1]!] ?? 0)}` : ''}</div>
                {x?.totals && <button className="howlink" onClick={() => openHow(r)} title="Split per gas, factors used and calculation steps">ⓘ How?</button>}</td>
              <td className={`small ${c.cls}`} title={'tip' in c ? c.tip : undefined} style={{ minWidth: 110, maxWidth: 260 }}>{c.t}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn ghost sm" title="Another line for this month" onClick={() => setRows((rs) => { const j = rs.findIndex((y) => y.k === r.k); const n = [...rs]; n.splice(j + 1, 0, blank(r.m, r.type)); return n; })}>+ line</button>
                {again && <button className="btn ghost sm" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((y) => y.k !== r.k))}>×</button>}
              </td>
            </tr>);
        })}</tbody>
      </table></div>
      {entries.length > 0 && !ready && <div className="note warn">Complete the inputs above first: they apply to every row.</div>}
      {[...new Set(Object.values(res).flatMap((x) => x.warnings ?? []).map((w) => w.replace(/\d{4}-\d{2}-\d{2}/g, '…')))].slice(0, 3).map((w) => <div key={w} className="note warn">{w}</div>)}
      <div className="softbar">
        <span className="muted small">{factorText ?? 'Paste a column from Excel into the first quantity to fill the rows below.'}</span><span className="grow" />
        <b>{okRows} row{okRows === 1 ? '' : 's'} · {shown.map((b, i) => <span key={b}>{i ? ' · ' : ''}{tco2e(total(b))} tCO₂e{shown.length > 1 ? ` ${BASIS_SHORT[b]}` : ''}</span>)}</b>
      </div>
      {how && <HowDrawer how={how} label={`${MONTHS[how.m]} ${year} · ${num(Number(how.v))} ${how.unit}`} energy={bases.includes('scope2')} onClose={() => setHow(null)} />}
      <div className="row">
        <span className="muted small">Goes to <b>{approver || 'the approver'}</b> for approval.</span><span className="grow" />
        <button className="btn" disabled={!ready || !!busy || !okRows || !facilityId} onClick={() => void save(false)}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
        <button className="btn p" disabled={!ready || !!busy || !okRows || !facilityId} onClick={() => void save(true)}>{busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button>
      </div>
    </div>
  );
}

/** The full calculation of one row: totals, factors, the split per gas and the steps (as in the entry drawer). */
function HowDrawer({ how, label, energy, onClose }: { how: { v: string; unit: string; r?: CalcResponse; error?: string }; label: string; energy: boolean; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">{label}</div><h2>{how.r ? how.r.item.name : 'How it is calculated'}</h2></div>
          <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {how.error ? <div className="note bad">{how.error}</div> : !how.r ? <div className="muted">Calculating…</div>
          : <Result r={how.r} energy={energy} quantity={Number(how.v)} unitName={how.unit} defaultGas />}
        <div className="muted small">Not saved yet: this is what will be stored with the entry when you save or submit it.</div>
      </div>
    </dialog>
  );
}
