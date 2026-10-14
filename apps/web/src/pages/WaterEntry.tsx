/**
 * Add data — Water.
 *
 * In (withdrawn, by source), recycled on site, and out (discharged, by destination), in m³ or the
 * unit on the bill (litres, kL, megalitres, imperial gallons). Water bought from a utility or tanker
 * counts in Scope 3.1 and water sent to a public sewer or tanker for treatment in Scope 3.5 (DESNZ
 * factors, or the utility's own factor per m³); water from own wells, the sea or rain has no Scope 3
 * emissions. The dashboards take consumption = withdrawn − discharged.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, tco2e, type Category } from '../lib/api';
import { Icon } from '../components/Icon';
import { MonthGrid } from '../components/MonthGrid';

type Flow = 'in' | 'reuse' | 'out';
const FLOWS: [Flow, string, string][] = [['in', 'Water in (withdrawn)', 'water_in'], ['reuse', 'Recycled on site', 'water_reuse'], ['out', 'Water out (discharged)', 'water_out']];
const UNITS: [string, string][] = [['m3', 'm³'], ['kL', 'kL'], ['L', 'litres'], ['ML', 'megalitres'], ['gal_uk', 'imperial gallons'], ['kgal_uk', '000 imperial gallons']];
interface Row { itemId: string; qty: string; own: string; source: string; note: string }
const emptyRow = (): Row => ({ itemId: '', qty: '', own: '', source: '', note: '' });
const clean = (s: string) => s.replace(/[^0-9.]/g, '');

export function WaterEntry({ cats, facilityId, period, onSaved, monthly }: {
  cats: Category[]; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void; monthly?: number;
}) {
  const { toast } = useApp();
  const [flow, setFlow] = useState<Flow>('in');
  const [unit, setUnit] = useState('m3');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [res, setRes] = useState<Record<number, { co2e?: number; error?: string; warnings?: string[] }>>({});
  const [busy, setBusy] = useState(false);
  const subCode = FLOWS.find((f) => f[0] === flow)![2];
  const sub = cats.flatMap((c) => c.subcategories).find((s) => s.code === subCode);
  const items = sub?.items ?? [];
  const attrs = (id: string) => ((items.find((i) => String(i.id) === id)?.attrs ?? {}) as { factor?: string; desal?: boolean });
  useEffect(() => { setRows([emptyRow(), emptyRow()]); setRes({}); setMm({ itemId: '', own: '', source: '' }); }, [flow]);

  const entries = rows.map((r, i) => ({ r, i })).filter((x) => x.r.itemId && x.r.qty !== '');
  const payload = entries.map(({ r }) => ({
    itemId: Number(r.itemId), unit, quantity: Number(r.qty), facilityId, ...period, dataType: 'actual', note: r.note || undefined,
    ...(r.own !== '' && attrs(r.itemId).factor !== 'none' ? { water: { ownFactor: Number(r.own), source: r.source || undefined } } : {}),
  }));
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (!payload.length || !facilityId) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.batch(payload, true).then((b) => {
        const m: typeof res = {};
        b.results.forEach((x, k) => { m[entries[k]!.i] = x.ok ? { co2e: x.totals?.scope3, warnings: x.warnings } : { error: x.error }; });
        setRes(m);
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const up = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const okCount = entries.filter((e) => res[e.i]?.co2e !== undefined).length;
  const total = Object.values(res).reduce((s, x) => s + (x.co2e ?? 0), 0);
  const volume = entries.reduce((s, e) => s + Number(e.r.qty || 0), 0);

  const save = async () => {
    setBusy(true);
    try {
      const b = await api.batch(payload, false);
      toast(`${b.saved} saved${b.failed ? `, ${b.failed} with problems` : ''}`);
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.i));
      setRows((rs) => { const left = rs.filter((_, i) => failed.has(i)); return left.length ? left : [emptyRow(), emptyRow()]; });
      onSaved();
    } finally { setBusy(false); }
  };

  // month by month: one source or destination, a reading per month
  const [mm, setMm] = useState({ itemId: '', own: '', source: '' });
  const mmItem = items.find((i) => String(i.id) === mm.itemId);
  const buildMonth = useMemo(() => (q: number, p: { periodStart: string; periodEnd: string }) => (mm.itemId ? {
    itemId: Number(mm.itemId), unit, quantity: q, ...p, ...(mm.own !== '' && attrs(mm.itemId).factor !== 'none' ? { water: { ownFactor: Number(mm.own), source: mm.source || undefined } } : {}),
  } : null), [mm, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <div className="seg" role="group" aria-label="Water">{FLOWS.map(([k, l]) => <button key={k} className={flow === k ? 'on' : ''} onClick={() => setFlow(k)}>{l}</button>)}</div>
      <span className="grow" />
      <label className="row small" style={{ gap: 6 }}>Unit <select className="input" style={{ height: 32, width: 'auto' }} value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    </div>);
  const help = flow === 'in'
    ? 'Every source of water the facility takes in. Utility, tanker and TSE water count in Scope 3.1; own wells, sea intake and rain have no Scope 3 emissions (their energy is in your own electricity and fuel).'
    : flow === 'reuse' ? 'Water treated or reused at the facility (greywater, own TSE for irrigation, cooling-tower blowdown reused). Reported as recycled water; not a withdrawal and no emissions.'
      : 'Where the water goes. To a public sewer or a tanker for treatment counts in Scope 3.5; irrigation, soak-away, sea and surface water have no Scope 3 emissions. Water lost by evaporation or in products is not discharged: it shows as consumption.';

  if (monthly) return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {head}
      <p className="sub" style={{ margin: 0 }}>{help} Choose the source once, then the volume for each month.</p>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field grow"><span>{flow === 'out' ? 'Destination' : 'Source'}</span>
          <select className="input" value={mm.itemId} onChange={(e) => setMm({ ...mm, itemId: e.target.value })}><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        {mm.itemId && attrs(mm.itemId).factor !== 'none' && <>
          <label className="field" style={{ width: 170 }}><span>Utility's factor (kg CO₂e/m³)</span><input className="input num" placeholder="default: DESNZ" value={mm.own} onChange={(e) => setMm({ ...mm, own: clean(e.target.value) })} /></label>
          <label className="field" style={{ width: 220 }}><span>Factor source</span><input className="input" value={mm.source} disabled={mm.own === ''} onChange={(e) => setMm({ ...mm, source: e.target.value })} /></label></>}
      </div>
      <MonthGrid year={monthly} facilityId={facilityId} build={buildMonth} onSaved={onSaved} bases={['scope3']} label={mmItem?.name ?? 'Water'} unitName={UNITS.find((u) => u[0] === unit)![1]}
        dup={{ category: flow === 'out' ? 'water_discharge' : 'water_supply', same: (a) => a.item === mmItem?.name }} />
    </div>
  );
  return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {head}
      <p className="sub" style={{ margin: 0 }}>{help}</p>
      <table className="t" style={{ border: '1px solid var(--line)', borderRadius: 12, tableLayout: 'fixed', width: '100%' }}>
        <colgroup><col style={{ width: '30%' }} /><col style={{ width: 120 }} /><col style={{ width: 130 }} /><col style={{ width: 150 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 44 }} /></colgroup>
        <thead><tr><th>{flow === 'out' ? 'Destination' : 'Source'}</th><th className="num">Volume</th><th className="num">Own factor kg/m³</th><th>Factor source</th><th>Note</th><th className="num">tCO₂e</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const x = res[i], f = attrs(r.itemId).factor;
          return (
            <tr key={i}>
              <td><select className="input" style={{ height: 32, width: '100%' }} value={r.itemId} onChange={(e) => up(i, { itemId: e.target.value })}><option value="">—</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</select></td>
              <td className="num"><input className="input num" style={{ width: '100%', height: 32 }} value={r.qty} onChange={(e) => up(i, { qty: clean(e.target.value) })} /></td>
              <td className="num">{f && f !== 'none' ? <input className="input num" style={{ width: '100%', height: 32 }} placeholder="DESNZ" value={r.own} onChange={(e) => up(i, { own: clean(e.target.value) })} /> : <span className="muted small">no Scope 3</span>}</td>
              <td>{f && f !== 'none' ? <input className="input" style={{ width: '100%', height: 32 }} disabled={r.own === ''} placeholder="e.g. utility 2025 report" value={r.source} onChange={(e) => up(i, { source: e.target.value })} /> : null}</td>
              <td><input className="input" style={{ width: '100%', height: 32 }} maxLength={200} placeholder="Meter, account, bill no." value={r.note} onChange={(e) => up(i, { note: e.target.value })} /></td>
              <td className="num">{x?.co2e !== undefined ? tco2e(x.co2e) : x?.error ? <span className="chip bad" title={x.error}>problem</span> : ''}</td>
              <td><button className="btn ghost sm" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [emptyRow()])} aria-label="Remove"><Icon name="x" /></button></td>
            </tr>);
        })}</tbody>
      </table>
      {Object.entries(res).filter(([, x]) => x.error).map(([i, x]) => <div key={i} className="note bad">Row {Number(i) + 1}: {x.error}</div>)}
      {[...new Set(Object.values(res).flatMap((x) => x.warnings ?? []))].map((w) => <div key={w} className="note warn">{w}</div>)}
      <div className="row">
        <button className="btn sm" onClick={() => setRows([...rows, emptyRow()])}><Icon name="plus" />Add row</button>
        <div className="grow" />
        {okCount > 0 && <span className="sub">{okCount} row{okCount === 1 ? '' : 's'} · {volume.toLocaleString('en')} {UNITS.find((u) => u[0] === unit)![1]} · <b>{tco2e(total)} tCO₂e</b> ({flow === 'out' ? 'Scope 3.5' : 'Scope 3.1'})</span>}
        <button className="btn p" disabled={!okCount || busy || !facilityId} onClick={save}>{busy ? 'Saving…' : `Save ${okCount || ''} entr${okCount === 1 ? 'y' : 'ies'}`}</button>
      </div>
    </div>
  );
}
