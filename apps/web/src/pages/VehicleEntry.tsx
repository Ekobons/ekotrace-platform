/**
 * Add data — Vehicles. Three ways:
 *   One entry      a fleet vehicle or a vehicle type; by distance, fuel used, electricity charged or spend
 *   Fleet (month)  every vehicle of the facility in service in the period, one line each, saved together
 *   Upload         Excel template (pre-filled with the fleet per month) → preview → save
 * Electric driving goes to Scope 2 (grid factor of the facility's country), unless charged on site.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, ApiError, download, num, tco2e, type Basis, type CalcResponse, type Category, type Item, type Vehicle, type VehicleMethod } from '../lib/api';
import { Result } from '../components/Result';
import { UploadPreview, useFuels, useVehicleTypes } from '../components/Fleet';
import { PasteGrid } from '../components/PasteGrid';
import { Icon } from '../components/Icon';

const METHOD_LABEL: Record<VehicleMethod, string> = { distance: 'Distance', fuel: 'Fuel used', electricity: 'Electricity charged', spend: 'Spend' };
const FUEL_UNITS = [['L', 'litre'], ['kL', 'kilolitre'], ['gal_us', 'US gallon'], ['gal_uk', 'imperial gallon'], ['kg', 'kg'], ['t', 'tonne'], ['m3', 'm³']] as const;
const unitsFor = (m: VehicleMethod): readonly (readonly [string, string])[] =>
  m === 'distance' ? [['km', 'km'], ['mi', 'mile']] : m === 'electricity' ? [['kWh_e', 'kWh'], ['MWh_e', 'MWh']] : FUEL_UNITS;
const methodsFor = (it?: { attrs?: Item['attrs'] } | null): VehicleMethod[] =>
  it?.attrs?.electric ? (it.attrs.distance === false ? ['electricity', 'spend'] : ['distance', 'electricity', 'spend'])
    : it?.attrs?.distance === false ? ['fuel', 'spend'] : ['distance', 'fuel', 'spend'];

type Mode = 'one' | 'fleet' | 'paste' | 'upload';

export function VehicleEntry({ cat, facilityId, period, onSaved }: {
  cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void;
}) {
  const [mode, setMode] = useState<Mode>('one');
  const types = useVehicleTypes();
  const [fleet, setFleet] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (!facilityId) { setFleet([]); return; }
    api.vehicles(facilityId, { from: period.periodStart, to: period.periodEnd }).then((r) => setFleet(r.vehicles.filter((v) => !v.retired_on || v.retired_on >= period.periodStart))).catch(() => setFleet([]));
  }, [facilityId, period.periodStart, period.periodEnd]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="seg" style={{ justifySelf: 'start' }}>
        <button className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>One entry</button>
        <button className={mode === 'fleet' ? 'on' : ''} onClick={() => setMode('fleet')}>Fleet this period ({fleet.length})</button>
        <button className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>Paste or type rows</button>
        <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>Upload Excel file</button>
      </div>
      {mode === 'one' && <OneEntry cat={cat} facilityId={facilityId} period={period} fleet={fleet} onSaved={onSaved} />}
      {mode === 'fleet' && <FleetGrid facilityId={facilityId} period={period} fleet={fleet} onSaved={onSaved} />}
      {mode === 'paste' && <PasteGrid facilityId={facilityId} types={types} onSaved={onSaved}
        month={period.periodStart.slice(0, 7) === period.periodEnd.slice(0, 7) ? period.periodStart.slice(0, 7) : undefined} />}
      {mode === 'upload' && <VehicleUpload period={period} facilityId={facilityId} onSaved={onSaved} />}
    </div>
  );
}

// ------------------------------------------------------------------ one entry --
function OneEntry({ cat, facilityId, period, fleet, onSaved }: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; fleet: Vehicle[]; onSaved: () => void }) {
  const { toast } = useApp();
  const fuels = useFuels();
  const [vehicleId, setVehicleId] = useState('');
  const [subId, setSubId] = useState<number | null>(cat.subcategories[0]?.id ?? null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [method, setMethod] = useState<VehicleMethod>('distance');
  const [quantity, setQuantity] = useState('');
  const [count, setCount] = useState('1');
  const [unit, setUnit] = useState('km');
  const [fuelId, setFuelId] = useState<number | null>(null);
  const [charging, setCharging] = useState<'site' | 'elsewhere'>('elsewhere');
  const [currency, setCurrency] = useState('AED');
  const [price, setPrice] = useState('');
  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allItems = cat.subcategories.flatMap((s) => s.items);
  const veh = fleet.find((v) => v.id === vehicleId);
  const sub = cat.subcategories.find((s) => s.id === subId);
  const item = veh ? allItems.find((i) => i.id === veh.item_id) ?? null : sub?.items.find((i) => i.id === itemId) ?? null;
  const methods = methodsFor(item);
  const plug = !!(item?.attrs?.electric || item?.attrs?.phev);
  const fuelUnknown = !!item && !item.attrs?.electric && !item.attrs?.fuel;

  useEffect(() => { if (!veh) setItemId(sub?.items[0]?.id ?? null); }, [subId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (veh) { setMethod(veh.default_method); setFuelId(veh.fuel_item_id); setCharging(veh.charging ?? 'elsewhere'); }
  }, [vehicleId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!methods.includes(method)) setMethod(methods[0]!); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setUnit(method === 'spend' ? (item?.attrs?.electric ? 'kWh_e' : 'L') : unitsFor(method)[0]![0]); }, [method, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = useMemo(() => {
    if (!item || quantity === '' || !facilityId) return null;
    const n = veh ? 1 : Math.max(1, Math.floor(Number(count) || 1));
    const v = { method, count: n > 1 ? n : undefined, vehicleId: veh?.id, fuelItemId: fuelId ?? undefined, charging: plug ? charging : undefined,
      spend: method === 'spend' ? { amount: Number(quantity), currency, price: price ? Number(price) : undefined } : undefined };
    return { itemId: item.id, unit, quantity: method === 'spend' ? undefined : Number(quantity), facilityId, ...period, vehicle: v };
  }, [item, quantity, count, unit, method, veh, fuelId, plug, charging, currency, price, facilityId, period]);

  useEffect(() => {
    setError(null);
    if (!payload) { setResult(null); return; }
    const t = window.setTimeout(() => api.calculate(payload).then(setResult).catch((e: ApiError) => { setResult(null); setError(e.message); }), 250);
    return () => window.clearTimeout(t);
  }, [payload]);

  const save = async () => {
    if (!payload) return;
    try {
      const r = await api.saveActivity({ ...payload, dataType, note: note || undefined });
      toast(`Saved: ${veh?.name ?? item?.name} · ${tco2e(r.totals.direct)} tCO₂e${r.totals.scope2 ? ` + ${tco2e(r.totals.scope2)} tCO₂e Scope 2` : ''}`);
      setQuantity(''); setNote(''); setPrice(''); setCount('1'); onSaved();
    } catch (e) { setError((e as Error).message); }
  };

  const groups = [...new Set(cat.subcategories.map((s) => s.grp ?? ''))];
  return (
    <div className="grid2">
      <div className="card" style={{ padding: 12 }}>
        {fleet.length > 0 && (
          <label className="field" style={{ padding: '4px 8px 12px' }}>
            <span>Fleet vehicle</span>
            <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">— Not from the fleet: choose a type —</option>
              {fleet.map((v) => <option key={v.id} value={v.id}>{v.name}{v.registration ? ` (${v.registration})` : ''} · {v.type}</option>)}
            </select>
          </label>
        )}
        {!veh && groups.map((g) => (
          <div key={g}>
            <div className="eyebrow" style={{ padding: '8px 8px 6px' }}>{g || 'Vehicles'}</div>
            <div className="list">
              {cat.subcategories.filter((s) => (s.grp ?? '') === g).map((s) => (
                <button key={s.id} className={s.id === subId ? 'on' : ''} onClick={() => setSubId(s.id)}><span>{s.name}</span><span className="meta">{s.items.length}</span></button>
              ))}
            </div>
          </div>
        ))}
        {veh && <div className="sub" style={{ padding: '0 8px' }}>{veh.type}<br />{veh.class}{veh.fuel ? ` · runs on ${veh.fuel}` : ''}. Choose “not from the fleet” to pick another type.</div>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        {!veh && (
          <label className="field"><span>Vehicle type</span>
            <select className="input" value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))}>
              {sub?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></label>
        )}
        <div className="seg" style={{ justifySelf: 'start' }}>
          {methods.map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>)}
        </div>
        <div className="sub">{
          method === 'distance' ? (item?.attrs?.electric ? 'km driven × the vehicle\'s electricity use (kWh per km) × the grid factor → Scope 2. No tailpipe emissions.' : item?.attrs?.phev ? 'km × DESNZ factor for the petrol share (Scope 1) + electricity share (Scope 2).' : 'km or miles driven × the DESNZ factor for this vehicle class and powertrain.')
          : method === 'fuel' ? 'Litres (or kg, m³) of fuel bought for the vehicle × the fuel\'s factor — the most accurate method when fuel records exist.'
          : method === 'electricity' ? 'kWh charged (charger or invoice records) × the grid factor of the facility\'s country → Scope 2.'
          : `Amount spent ÷ price per ${item?.attrs?.electric ? 'kWh' : 'litre'} = quantity, then as ${item?.attrs?.electric ? 'electricity' : 'fuel used'}. The price comes from the price list unless you enter it.`}</div>

        {(method === 'fuel' || method === 'spend') && !item?.attrs?.electric && (
          <label className="field"><span>Fuel{fuelUnknown ? '' : ' (usual fuel of the type unless chosen)'}</span>
            <select className="input" value={fuelId ?? ''} onChange={(e) => setFuelId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{fuelUnknown ? 'Choose…' : 'Usual fuel'}</option>
              {[...new Set(fuels.map((x) => x.sub))].map((g) => <optgroup key={g} label={g}>{fuels.filter((x) => x.sub === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
            </select></label>
        )}

        <div className="row" style={{ alignItems: 'flex-end' }}>
          {!veh && (
            <label className="field" style={{ width: 110 }}>
              <span>No. of vehicles</span>
              <input className="input num" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
            </label>
          )}
          <label className="field" style={{ width: 170 }}>
            <span>{method === 'spend' ? 'Amount spent' : method === 'distance' ? 'Distance' : 'Quantity'}{!veh && Number(count) > 1 ? ' per vehicle' : ''}</span>
            <input className="input num" inputMode="decimal" value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          {method === 'spend' ? (
            <>
              <label className="field" style={{ width: 90 }}><span>Currency</span><input className="input mono" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
              <label className="field" style={{ width: 170 }}><span>Price per {item?.attrs?.electric ? 'kWh' : 'litre'} (optional)</span>
                <input className="input num" inputMode="decimal" value={price} placeholder="price list" onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            </>
          ) : (
            <label className="field" style={{ width: 150 }}><span>Unit</span>
              <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{unitsFor(method).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          )}
          {plug && method !== 'fuel' && (
            <label className="field" style={{ width: 250 }}><span>Charged</span>
              <select className="input" value={charging} onChange={(e) => setCharging(e.target.value as 'site')}>
                <option value="elsewhere">Elsewhere (public, home) → Scope 2 here</option>
                <option value="site">At our site — already on its meter</option>
              </select></label>
          )}
        </div>

        <div className="row">
          <label className="field" style={{ width: 160 }}><span>Data type</span>
            <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></label>
          <label className="field grow"><span>Note / reference</span><input className="input" value={note} maxLength={1000} placeholder="Fuel card statement, odometer, invoice…" onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <div className="note bad">{error}</div>}
        {result ? <Result r={result} /> : !error && <div className="note info">Enter the {method === 'spend' ? 'amount' : method === 'distance' ? 'distance' : 'quantity'} to see the emissions and how they were calculated.</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn p" disabled={!result || !facilityId} onClick={save}>Save entry</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- fleet grid --
interface Line { method: VehicleMethod; quantity: string; unit: string; currency: string; charging: 'site' | 'elsewhere' }

function FleetGrid({ facilityId, period, fleet, onSaved }: { facilityId: string; period: { periodStart: string; periodEnd: string }; fleet: Vehicle[]; onSaved: () => void }) {
  const { toast } = useApp();
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [results, setResults] = useState<Record<string, { totals?: Record<Basis, number>; error?: string; warnings?: string[] }>>({});
  const [entered, setEntered] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const init: Record<string, Line> = {};
    for (const v of fleet) {
      const m = v.default_method;
      init[v.id] = { method: m, quantity: '', unit: m === 'spend' ? (v.attrs.electric ? 'kWh_e' : 'L') : unitsFor(m)[0]![0], currency: 'AED', charging: v.charging ?? 'elsewhere' };
    }
    setLines(init); setResults({});
    if (facilityId) {
      api.activities({ facilityId, year: Number(period.periodStart.slice(0, 4)), category: 'mobile_combustion', limit: 1000 }).then((r) => {
        const n: Record<string, number> = {};
        for (const a of r.activities) if (a.vehicle_id && a.period_start.slice(0, 10) <= period.periodEnd && a.period_end.slice(0, 10) >= period.periodStart) n[a.vehicle_id] = (n[a.vehicle_id] ?? 0) + 1;
        setEntered(n);
      }).catch(() => setEntered({}));
    }
  }, [fleet, facilityId, period.periodStart, period.periodEnd]);

  const entries = fleet.filter((v) => lines[v.id]?.quantity).map((v) => {
    const l = lines[v.id]!;
    return {
      id: v.id,
      body: { facilityId, itemId: v.item_id, unit: l.unit, quantity: l.method === 'spend' ? undefined : Number(l.quantity), ...period,
        vehicle: { method: l.method, vehicleId: v.id, charging: v.attrs.electric || v.attrs.phev ? l.charging : undefined, spend: l.method === 'spend' ? { amount: Number(l.quantity), currency: l.currency } : undefined } },
    };
  });
  const key = JSON.stringify(entries.map((e) => e.body));
  useEffect(() => {
    if (!entries.length) { setResults({}); return; }
    const t = window.setTimeout(() => {
      api.batch(entries.map((e) => e.body), true).then((r) => {
        const out: typeof results = {};
        r.results.forEach((x, i) => { out[entries[i]!.id] = x.ok ? { totals: x.totals, warnings: x.warnings } : { error: x.error }; });
        setResults(out);
      }).catch((e) => setErr(e.message));
    }, 400);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, p: Partial<Line>) => setLines((x) => ({ ...x, [id]: { ...x[id]!, ...p } }));
  const ok = entries.filter((e) => results[e.id]?.totals);
  const sum = (b: Basis) => ok.reduce((s, e) => s + (results[e.id]!.totals![b] ?? 0), 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.batch(ok.map((e) => e.body), false);
      toast(`Saved ${r.saved} entr${r.saved === 1 ? 'y' : 'ies'}${r.failed ? `; ${r.failed} not saved` : ''}`);
      setLines((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v, quantity: '' }])));
      onSaved();
      setEntered((n) => { const m = { ...n }; for (const e of ok) m[e.id] = (m[e.id] ?? 0) + 1; return m; });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!facilityId) return <div className="card empty">Choose a facility.</div>;
  if (!fleet.length) return <div className="card empty">No vehicles in service at this facility in this period. Add the fleet in Organisation & groups → the facility → Vehicle fleet, or use “One entry”.</div>;
  return (
    <div className="card flush">
      <div style={{ padding: '14px 16px 6px' }}>
        <h2>Fleet · {period.periodStart.slice(0, 7)}{period.periodEnd.slice(0, 7) !== period.periodStart.slice(0, 7) ? ` to ${period.periodEnd.slice(0, 7)}` : ''}</h2>
        <p className="sub">Vehicles in service in this period. Fill in what you have; empty lines are skipped. Each line is calculated as you type.</p>
      </div>
      <div className="scroll">
        <table className="t">
          <thead><tr><th>Vehicle</th><th>Method</th><th className="num">Quantity</th><th>Unit</th><th className="num">Scope 1 tCO₂e</th><th className="num">Scope 2</th><th>Check</th></tr></thead>
          <tbody>{fleet.map((v) => {
            const l = lines[v.id]; if (!l) return null;
            const r = results[v.id];
            return (
              <tr key={v.id}>
                <td><b>{v.name}</b>{v.registration && <span className="sub mono"> {v.registration}</span>}<div className="sub">{v.type}</div>
                  {entered[v.id] ? <span className="chip grey">{entered[v.id]} already entered</span> : null}</td>
                <td><select className="input sm" value={l.method} onChange={(e) => { const m = e.target.value as VehicleMethod; set(v.id, { method: m, unit: m === 'spend' ? (v.attrs.electric ? 'kWh_e' : 'L') : unitsFor(m)[0]![0] }); }}>
                  {methodsFor(v).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></td>
                <td className="num"><input className="input num sm" style={{ width: 110 }} inputMode="decimal" value={l.quantity} placeholder="0" onChange={(e) => set(v.id, { quantity: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
                <td>{l.method === 'spend'
                  ? <input className="input mono sm" style={{ width: 70 }} maxLength={3} value={l.currency} onChange={(e) => set(v.id, { currency: e.target.value.toUpperCase() })} />
                  : <select className="input sm" value={l.unit} onChange={(e) => set(v.id, { unit: e.target.value })}>{unitsFor(l.method).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>}
                  {(v.attrs.electric || v.attrs.phev) && l.method !== 'fuel' && (
                    <select className="input sm" style={{ marginTop: 4 }} value={l.charging} onChange={(e) => set(v.id, { charging: e.target.value as 'site' })}><option value="elsewhere">charged elsewhere</option><option value="site">charged on site</option></select>)}
                </td>
                <td className="num">{r?.totals ? tco2e(r.totals.direct) : ''}</td>
                <td className="num">{r?.totals?.scope2 ? tco2e(r.totals.scope2) : ''}</td>
                <td>{r?.error ? <span className="bad-text">{r.error}</span> : r?.warnings?.length ? <span className="sub">{r.warnings.join(' ')}</span> : r?.totals ? <span className="chip">OK</span> : ''}</td>
              </tr>);
          })}</tbody>
          {ok.length > 0 && <tfoot><tr><td colSpan={4}><b>{ok.length} line{ok.length === 1 ? '' : 's'} ready</b></td><td className="num"><b>{tco2e(sum('direct'))}</b></td><td className="num"><b>{tco2e(sum('scope2'))}</b></td><td /></tr></tfoot>}
        </table>
      </div>
      {err && <div className="note bad" style={{ margin: 12 }}>{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', padding: 12 }}>
        <button className="btn p" disabled={!ok.length || busy} onClick={save}>Save {ok.length || ''} entr{ok.length === 1 ? 'y' : 'ies'}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ upload --
function VehicleUpload({ period, facilityId, onSaved }: { period: { periodStart: string; periodEnd: string }; facilityId: string; onSaved: () => void }) {
  const { toast } = useApp();
  const [from, setFrom] = useState(period.periodStart.slice(0, 7));
  const [to, setTo] = useState(period.periodEnd.slice(0, 7));
  const [allFacilities, setAll] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setFrom(period.periodStart.slice(0, 7)); setTo(period.periodEnd.slice(0, 7)); }, [period.periodStart, period.periodEnd]);
  const tmpl = () => download(`/api/vehicles/entries-template.xlsx?${new URLSearchParams({ from, to, ...(allFacilities ? {} : { facilityId }) })}`, `vehicle-data-${from}_${to}.xlsx`).catch((e) => setErr(e.message));
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div><h2>Upload vehicle data from Excel</h2>
        <p className="sub">1. Download the template: one line per fleet vehicle in service per month, with its usual method and unit. Vehicles not in the fleet can be added by type. 2. Fill in the quantities (or amounts for spend). 3. Upload: every line is calculated and checked before anything is saved.</p></div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 150 }}><span>From month</span><input className="input" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" style={{ width: 150 }}><span>To month</span><input className="input" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}><input type="checkbox" checked={allFacilities} onChange={(e) => setAll(e.target.checked)} />All my facilities</label>
        <button className="btn" onClick={tmpl}><Icon name="doc" />Download template</button>
        <button className="btn p" onClick={() => setOpen(true)}><Icon name="upload" />Upload filled file</button>
      </div>
      {err && <div className="note bad">{err}</div>}
      {open && (
        <UploadPreview title="Upload vehicle data" onClose={() => setOpen(false)}
          onDone={(n) => { setOpen(false); toast(`Saved ${n} entr${n === 1 ? 'y' : 'ies'}`); onSaved(); }}
          help="Each line is calculated with the factors for its month. Lines with problems are listed and skipped; fix them in the file and upload them again."
          columns={[{ key: 'facility', label: 'Facility' }, { key: 'month', label: 'Month' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'method', label: 'Method' }, { key: 'quantity', label: 'Quantity', num: true }, { key: 's1', label: 'Scope 1 t', num: true }, { key: 's2', label: 'Scope 2 t', num: true }]}
          run={async (file, commit) => {
            const r = await api.uploadVehicleData(file, commit);
            return { rows: r.rows.map((x) => ({ ...x, s1: x.totals ? tco2e(x.totals.direct) : '', s2: x.totals?.scope2 ? tco2e(x.totals.scope2) : '', quantity: num(Number(x.quantity)) })), valid: r.valid, done: r.saved };
          }} />
      )}
    </div>
  );
}
