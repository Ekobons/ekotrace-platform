/**
 * Month by month: the same entry for every month of a year — only the reading
 * (quantity, distance, kWh, tonnes…) changes. Everything else is set once in the
 * form above.
 *
 *  - Type the 12 values, or paste a row or a column from Excel into any month
 *    (it fills from that month onwards).
 *  - Each month is calculated as you type; months that already have the same
 *    entry are flagged, so nothing is entered twice by mistake.
 *  - Save stores one entry per filled month; a month with a problem stays on
 *    screen and the others are saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, BASIS_SHORT, tco2e, type Activity, type Basis } from '../lib/api';
import { useApp } from '../App';
import { useNavigate } from 'react-router-dom';
import { saveDraft } from './MeterForm';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const monthPeriod = (year: number, m: number) => ({
  periodStart: `${year}-${pad(m + 1)}-01`,
  periodEnd: `${year}-${pad(m + 1)}-${pad(new Date(Date.UTC(year, m + 1, 0)).getUTCDate())}`,
});
/** "12,345.6" → "12345.6"; empty or not a number → '' */
const cleanNum = (s: string) => { const x = s.replace(/[\s,]/g, ''); return x === '' || !Number.isFinite(Number(x)) ? '' : x; };

export function MonthGrid({ year, facilityId, label, unitName, build, bases = ['direct'], dup, onSaved, hint, meterUnit }: {
  year: number;
  facilityId: string;
  /** what is entered each month, e.g. "Diesel used" */
  label: string;
  unitName: string;
  /** the entry for one month, from the reading and the month's period; null while the form above is incomplete */
  build: (value: number, period: { periodStart: string; periodEnd: string }) => Record<string, unknown> | null;
  /** totals shown per month */
  bases?: Basis[];
  /** flag months that already have this entry: category code and how to recognise the same entry */
  dup?: { category: string; same: (a: Activity) => boolean };
  onSaved: () => void;
  hint?: string;
  /** unit of a meter set up from these inputs (default: the entry's unit) */
  meterUnit?: string;
}) {
  const { toast, role } = useApp();
  const navigate = useNavigate();
  /** "Set up a meter with these inputs": the readings will then come from the meter. */
  const toMeter = () => {
    const p = build(1, monthPeriod(year, 0));
    if (!p) return;
    const { itemId, unit, quantity: _q, periodStart: _s, periodEnd: _e, facilityId: _f, ...template } = p as Record<string, unknown>;
    void _q; void _s; void _e; void _f;
    saveDraft({ facilityId, itemId: Number(itemId), unit: meterUnit ?? String(unit), template, label, readingType: 'interval', frequency: 'day' });
    navigate('/meters?new=1');
  };
  const [vals, setVals] = useState<string[]>(() => Array(12).fill(''));
  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [res, setRes] = useState<Record<number, { totals?: Record<Basis, number>; error?: string; warnings?: string[] }>>({});
  const [existing, setExisting] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => vals.map((v, m) => ({ m, v })).filter((x) => x.v !== '').map(({ m, v }) => {
    const body = build(Number(v), monthPeriod(year, m));
    return { m, body: body ? { ...body, facilityId, dataType, note: note || undefined } : null };
  }), [vals, build, year, facilityId, dataType, note]);
  const ready = entries.length > 0 && entries.every((e) => e.body);
  const key = JSON.stringify(entries);

  useEffect(() => {
    if (!ready) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.batch(entries.map((e) => e.body), true).then((b) => {
        const r: typeof res = {};
        b.results.forEach((x, k) => { r[entries[k]!.m] = x.ok ? { totals: x.totals, warnings: x.warnings } : { error: x.error }; });
        setRes(r);
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadExisting = () => { if (dup && facilityId) api.activities({ facilityId, year, category: dup.category, limit: 1000 }).then((r) => setExisting(r.activities)).catch(() => {}); };
  useEffect(loadExisting, [facilityId, year, dup?.category]); // eslint-disable-line react-hooks/exhaustive-deps
  const taken = useMemo(() => {
    const s = new Set<number>();
    if (!dup) return s;
    for (const a of existing) {
      if (!dup.same(a) || a.period_start.slice(0, 7) !== a.period_end.slice(0, 7)) continue;
      if (Number(a.period_start.slice(0, 4)) === year) s.add(Number(a.period_start.slice(5, 7)) - 1);
    }
    return s;
  }, [existing, dup, year]);

  // Paste a row or a column of numbers: fills from the month pasted into.
  const paste = (m: number, text: string) => {
    const cells = text.split(/[\t\r\n]+/).map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 2) return false;
    setVals((v) => { const n = [...v]; cells.forEach((c, i) => { if (m + i < 12) n[m + i] = cleanNum(c); }); return n; });
    return true;
  };

  const total = (b: Basis) => Object.values(res).reduce((s, x) => s + (x.totals?.[b] ?? 0), 0);
  const okMonths = entries.filter((e) => res[e.m]?.totals).length;
  const shown = bases.filter((b, i) => i === 0 || total(b) !== 0);

  const save = async () => {
    setBusy(true);
    try {
      const b = await api.batch(entries.map((e) => e.body), false);
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.m));
      toast(`${b.saved} month${b.saved === 1 ? '' : 's'} saved${b.failed ? `, ${b.failed} with problems (still on screen)` : ''}`);
      setVals((v) => v.map((x, m) => (failed.has(m) ? x : '')));
      loadExisting(); onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row"><b className="grow">{label} · {year}, month by month</b>
        {['platform_admin', 'super_admin', 'admin', 'manager'].includes(role) && <button className="btn ghost sm" title="Readings arrive from a system or from bills: set up a meter with the inputs above" disabled={!build(1, monthPeriod(year, 0))} onClick={toMeter}>Set up a meter with these inputs →</button>}
        <button className="btn ghost sm" onClick={() => setVals(Array(12).fill(''))}>Clear</button></div>
      <div className="sub">{hint ?? 'Paste 12 values from Excel (a row or a column) into January to fill all months.'}</div>
      <div className="monthgrid">
        {MONTHS.map((name, m) => {
          const r = res[m];
          return (
            <label key={m} className={`mcell ${taken.has(m) ? 'taken' : ''} ${r?.error ? 'bad' : ''}`}>
              <span>{name}{taken.has(m) && <i title="This month already has the same entry"> · entered</i>}</span>
              <input className="input num" inputMode="decimal" value={vals[m]} placeholder="—"
                onPaste={(e) => { if (paste(m, e.clipboardData.getData('text'))) e.preventDefault(); }}
                onChange={(e) => { const x = e.target.value.replace(/[^0-9.]/g, ''); setVals((v) => v.map((y, k) => (k === m ? x : y))); }} />
              <small>{r?.totals ? `${tco2e(r.totals[bases[0]!] ?? 0)} t` : r?.error ? 'problem' : unitName}</small>
            </label>
          );
        })}
      </div>
      {entries.length > 0 && !ready && <div className="note warn">Complete the inputs above first: they apply to every month.</div>}
      {[...taken].some((m) => vals[m] !== '') && <div className="note warn">Months marked “entered” already have this entry: saving adds a second one. Leave them empty unless that is intended.</div>}
      {Object.entries(res).filter(([, x]) => x.error).map(([m, x]) => <div key={m} className="note bad">{MONTHS[Number(m)]}: {x.error}</div>)}
      {[...new Set(Object.values(res).flatMap((x) => x.warnings ?? []).map((w) => w.replace(/\d{4}-\d{2}-\d{2}/g, '…')))].slice(0, 3).map((w) => <div key={w} className="note warn">{w}</div>)}
      <div className="row">
        <label className="field" style={{ width: 160 }}><span>Data type</span>
          <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></label>
        <label className="field grow"><span>Note / reference (all months)</span><input className="input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="row">
        <span className="sub grow">{okMonths > 0 && <>{okMonths} month{okMonths === 1 ? '' : 's'} · {shown.map((b) => <span key={b}><b>{tco2e(total(b))} tCO₂e</b> {BASIS_SHORT[b]} </span>)}</>}</span>
        <button className="btn p" disabled={!ready || busy || !okMonths || !facilityId} onClick={save}>{busy ? 'Saving…' : `Save ${entries.length || ''} month${entries.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>
  );
}
