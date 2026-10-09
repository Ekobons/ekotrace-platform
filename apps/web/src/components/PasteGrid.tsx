/**
 * Vehicle rows typed or pasted from Excel (or any spreadsheet / table).
 *
 *  - Paste: click a cell and press Ctrl+V. Cells fill from there, like Excel.
 *    If the pasted block starts with a header row ("Vehicle", "Qty", "Unit"…),
 *    columns are matched by their names instead.
 *  - Every row is read on the server as you go: which vehicle it is ("car petrol"
 *    → Average car · Petrol), what was assumed, the result, or what is wrong.
 *  - The type can be changed per row. Save stores the good rows only; rows with
 *    problems stay on screen to be fixed.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, tco2e, num, type PastedRow, type RowResult, type VehicleType } from '../lib/api';
import { Icon } from './Icon';

const COLS = [
  { key: 'month', label: 'Month', width: 80, hint: 'yyyy-mm' },
  { key: 'what', label: 'Vehicle or type', width: 170, hint: 'car petrol' },
  { key: 'count', label: 'No.', width: 46, hint: '1' },
  { key: 'quantity', label: 'Qty / vehicle', width: 86, hint: '0' },
  { key: 'unit', label: 'Unit', width: 58, hint: 'km' },
  { key: 'note', label: 'Note', width: 90, hint: '' },
] as const;
type Key = (typeof COLS)[number]['key'];
type Row = Record<Key, string> & { typeId?: number };

const empty = (): Row => ({ month: '', what: '', count: '', quantity: '', unit: '', note: '' });
const isEmpty = (r: Row) => !r.what.trim() && !r.quantity.trim();

/** Header words → column. */
function headerKey(h: string): Key | null {
  const s = h.toLowerCase();
  if (/month|period|date/.test(s)) return 'month';
  if (/^no\.?$|^no\.? of|number of|count|fleet size|^vehicles$/.test(s)) return 'count';
  if (/^units?$|uom|unit of/.test(s)) return 'unit';
  if (/qty|quantity|distance|\bkm\b|mileage|litres?|liters?|amount|consumption|spend|kwh|per vehicle/.test(s)) return 'quantity';
  if (/vehicle|type|reg|plate|description|asset|car|truck|fuel/.test(s)) return 'what';
  if (/note|comment|remark|ref/.test(s)) return 'note';
  return null;
}

export function PasteGrid({ facilityId, month, types, onSaved }: { facilityId: string; month?: string; types: VehicleType[]; onSaved: (n: number) => void }) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 8 }, empty));
  const [res, setRes] = useState<Record<number, RowResult>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const filled = rows.map((r, i) => ({ r, i })).filter(({ r }) => !isEmpty(r));
  const payload: PastedRow[] = filled.map(({ r }) => ({ month: r.month || undefined, what: r.what, typeId: r.typeId, count: r.count || undefined, quantity: r.quantity, unit: r.unit || undefined, note: r.note || undefined }));
  const key = JSON.stringify([facilityId, month, payload]);

  useEffect(() => {
    if (!filled.length || !facilityId) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.vehicleRows({ facilityId, month, rows: payload, commit: false })
        .then((r) => { const m: Record<number, RowResult> = {}; r.rows.forEach((x, k) => { m[filled[k]!.i] = x; }); setRes(m); setErr(null); })
        .catch((e) => setErr(e.message));
    }, 450);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, k: Key, v: string) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v, ...(k === 'what' ? { typeId: undefined } : {}) } : r)));

  /** Excel-style paste: tab-separated cells, one line per row. */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const r0 = Number(target.dataset.row), c0 = Number(target.dataset.col);
    const text = e.clipboardData.getData('text/plain');
    if (!text || Number.isNaN(r0) || (!text.includes('\t') && !text.includes('\n'))) return; // single value: normal paste
    e.preventDefault();
    let lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
    const cells = lines.map((l) => l.split('\t').map((c) => c.trim()));
    // Header row? Map columns by name.
    const keys = cells[0]!.map(headerKey);
    const header = keys.filter(Boolean).length >= 2 && cells[0]!.every((c) => !/^\d/.test(c));
    const map: (Key | null)[] = header ? keys : cells[0]!.map((_, j) => COLS[c0 + j]?.key ?? null);
    const body = header ? cells.slice(1) : cells;
    setRows((x) => {
      const next = [...x];
      body.forEach((line, k) => {
        const i = r0 + k;
        while (next.length <= i) next.push(empty());
        const row = { ...next[i]! };
        line.forEach((v, j) => { const kk = map[j]; if (kk) { row[kk] = v; if (kk === 'what') delete row.typeId; } });
        next[i] = row;
      });
      while (next.length < r0 + body.length + 3) next.push(empty());
      return next;
    });
    setInfo(`${body.length} row${body.length === 1 ? '' : 's'} pasted${header ? ' (columns matched by their headings)' : ''}.`);
  };

  const ok = filled.filter(({ i }) => res[i] && !res[i]!.errors.length);
  const bad = filled.filter(({ i }) => res[i]?.errors.length);
  const sum = (b: 'direct' | 'scope2') => ok.reduce((s, { i }) => s + (res[i]!.totals?.[b] ?? 0), 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.vehicleRows({ facilityId, month, rows: payload, commit: true });
      const savedIdx = new Set(r.rows.map((x, k) => (!x.errors.length ? filled[k]!.i : -1)));
      setRows((x) => { const left = x.filter((_, i) => !savedIdx.has(i)); while (left.length < 8) left.push(empty()); return left; });
      setRes({});
      setInfo(`${r.saved} row${r.saved === 1 ? '' : 's'} saved${bad.length ? `; ${bad.length} with problems left below to fix` : ''}.`);
      onSaved(r.saved);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const grouped = useMemo(() => [...new Set(types.map((t) => t.sub))].map((sub) => ({ sub, items: types.filter((t) => t.sub === sub) })), [types]);

  return (
    <div className="card flush">
      <div style={{ padding: '14px 16px 6px' }}>
        <h2>Paste or type rows</h2>
        <p className="sub">Copy rows from Excel (or any table) and paste them here: click the first cell, Ctrl+V. Write vehicles your way — <span className="mono">car petrol</span>, <span className="mono">pickup diesel</span>, <span className="mono">tipper 18t</span>, <span className="mono">forklift LPG</span>, or a fleet registration. <b>No.</b> is the number of identical vehicles; the quantity is per vehicle. The unit tells the method: km/mile = distance, litre/kg = fuel, kWh = electricity, AED = spend. Month empty = {month ?? 'the month chosen above'}.</p>
      </div>
      <div className="scroll" onPaste={onPaste}>
        <table className="t paste">
          <thead><tr><th>#</th>{COLS.map((c) => <th key={c.key} className={c.key === 'count' || c.key === 'quantity' ? 'num' : ''}>{c.label}</th>)}<th>Read as</th><th className="num">Total</th><th className="num">Scope 1 t</th><th className="num">Scope 2 t</th><th>Check</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const x = res[i];
            const blank = isEmpty(r);
            return (
              <tr key={i} className={x?.errors.length ? 'row-bad' : undefined}>
                <td className="mono sub">{i + 1}</td>
                {COLS.map((c, j) => (
                  <td key={c.key}>
                    <input className={`input sm${c.key === 'count' || c.key === 'quantity' ? ' num' : ''}`} style={{ width: c.width }} value={r[c.key]} placeholder={i === 0 ? c.hint : ''}
                      data-row={i} data-col={j} onChange={(e) => set(i, c.key, e.target.value)} aria-label={`${c.label}, row ${i + 1}`} />
                  </td>
                ))}
                <td style={{ minWidth: 190 }}>
                  {!blank && x?.read.vehicleKind === 'fleet' && <span><span className="chip">fleet</span> {x.read.vehicle}</span>}
                  {!blank && x?.read.vehicleKind !== 'fleet' && (
                    <>
                      <select className="input sm" style={{ width: 190 }} value={r.typeId ?? x?.read.typeId ?? ''} onChange={(e) => setRows((xs) => xs.map((q, k) => (k === i ? { ...q, typeId: Number(e.target.value) || undefined } : q)))}>
                        <option value="">{x?.read.typeId ? '' : 'Choose the type…'}</option>
                        {grouped.map((g) => <optgroup key={g.sub} label={g.sub}>{g.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
                      </select>
                      {x?.read.assumed.length && !r.typeId ? <div className="sub">assumed: {x.read.assumed.join(', ')}</div> : null}
                    </>
                  )}
                </td>
                <td className="num mono">{x?.read.total != null && !blank ? `${num(x.read.total)} ${x.read.unit === 'kWh_e' ? 'kWh' : x.read.unit ?? ''}` : ''}{x?.read.method && !blank ? <div className="sub">{x.read.method}</div> : null}</td>
                <td className="num">{x?.totals ? tco2e(x.totals.direct) : ''}</td>
                <td className="num">{x?.totals?.scope2 ? tco2e(x.totals.scope2) : ''}</td>
                <td style={{ minWidth: 150, maxWidth: 240, fontSize: 12 }}>{blank ? '' : x?.errors.length ? <span className="bad-text">{x.errors.join('; ')}</span> : x?.warnings.length ? <span className="sub">{x.warnings.join(' ')}</span> : x?.totals ? <span className="chip">OK</span> : <span className="sub">…</span>}</td>
              </tr>);
          })}</tbody>
          {ok.length > 0 && <tfoot><tr><td colSpan={COLS.length + 3}><b>{ok.length} row{ok.length === 1 ? '' : 's'} ready</b>{bad.length ? ` · ${bad.length} with problems (not saved)` : ''}</td><td className="num"><b>{tco2e(sum('direct'))}</b></td><td className="num"><b>{tco2e(sum('scope2'))}</b></td><td /></tr></tfoot>}
        </table>
      </div>
      {(err || info) && <div className={`note ${err ? 'bad' : 'info'}`} style={{ margin: '8px 12px 0' }}>{err ?? info}</div>}
      <div className="row" style={{ padding: 12 }}>
        <button className="btn ghost sm" onClick={() => setRows((x) => [...x, ...Array.from({ length: 5 }, empty)])}><Icon name="plus" />5 more rows</button>
        <button className="btn ghost sm" onClick={() => { setRows(Array.from({ length: 8 }, empty)); setRes({}); setInfo(null); }}>Clear</button>
        <div className="grow" />
        <button className="btn p" disabled={!ok.length || busy || !facilityId} onClick={save}>{busy ? 'Saving…' : `Save ${ok.length || ''} row${ok.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>
  );
}
