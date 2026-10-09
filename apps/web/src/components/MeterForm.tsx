/**
 * Add or edit a meter.
 *
 * What it measures: either picked here (a fuel, electricity, heat, cooling — the simple
 * cases), or carried over from Add data ("Set up a meter with these inputs"), which keeps
 * every detail of the entry (supplier factor, grid region, cooling plant, waste process…).
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type Category, type Facility, type Meter, type SupplierFactor, type Unit } from '../lib/api';

/** Inputs carried over from an Add data form (session storage, one-time). */
export interface MeterDraft { facilityId?: string; itemId: number; unit: string; template: Record<string, unknown>; label?: string; name?: string; accountNo?: string; readingType?: 'cumulative' | 'interval'; frequency?: string }
export const DRAFT_KEY = 'eko.meterDraft';
export function saveDraft(d: MeterDraft) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }
export function takeDraft(): MeterDraft | null {
  try { const s = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** Categories a meter can feed (landfill methane is yearly; refrigerants are not metered). */
const METERABLE = ['stationary_combustion', 'purchased_electricity', 'mobile_combustion', 'waste_treatment'];
const FREQ: [string, string][] = [['hour', 'Hourly'], ['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['irregular', 'Irregular (bills, deliveries)']];
const DIMS: Record<string, string[]> = { stationary_combustion: ['volume', 'mass', 'energy_net', 'energy_gross'], purchased_electricity: ['electricity', 'heat', 'cooling'], waste_treatment: ['mass', 'volume'], mobile_combustion: ['volume', 'mass', 'electricity'] };

export function MeterForm({ meter, draft, facilities, onDone }: { meter?: Meter; draft?: MeterDraft | null; facilities: Facility[]; onDone: (m?: Meter) => void }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierFactor[]>([]);
  const [f, setF] = useState({
    facilityId: meter?.facility_id ?? draft?.facilityId ?? facilities[0]?.id ?? '',
    name: meter?.name ?? draft?.name ?? '', serial: meter?.serial ?? '', externalId: meter?.external_id ?? '', accountNo: meter?.account_no ?? draft?.accountNo ?? '',
    readingType: meter?.reading_type ?? draft?.readingType ?? 'interval', frequency: meter?.frequency ?? draft?.frequency ?? 'day',
    unit: meter?.unit ?? draft?.unit ?? '', multiplier: String(meter?.multiplier ?? 1), rollover: meter?.rollover ? String(meter.rollover) : '',
    itemId: meter?.item_id ?? draft?.itemId ?? 0, gapFill: meter?.gap_fill ?? 'prorate', autoEntries: meter?.auto_entries ?? true, note: meter?.note ?? '',
  });
  const [template, setTemplate] = useState<Record<string, unknown>>(meter?.template ?? draft?.template ?? {});
  const carried = !!draft || (!!meter && Object.keys(meter.template ?? {}).length > 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.catalogue().then((c) => setCats(c.categories.filter((x) => METERABLE.includes(x.code)))); api.units().then((u) => setUnits(u.units)); }, []);

  const items = useMemo(() => cats.flatMap((c) => c.subcategories.flatMap((s) => s.items.filter((i) => i.code !== 'waste:landfill').map((i) => ({ ...i, cat: c, sub: s })))), [cats]);
  const item = items.find((i) => i.id === f.itemId);
  const energy = item?.code === 'grid:electricity' ? 'electricity' : item?.code === 'heat:district' ? 'heat' : item?.code === 'cooling:district' ? 'cooling' : null;
  useEffect(() => { if (energy) api.supplierFactors(energy).then((r) => setSuppliers(r.suppliers)).catch(() => setSuppliers([])); }, [energy]);
  const unitOptions = units.filter((u) => item && (DIMS[item.cat.code] ?? []).includes(u.dimension) && (!item.sub.units.length || item.cat.code === 'waste_treatment' || item.sub.units.includes(u.code) || item.cat.code === 'mobile_combustion'));
  useEffect(() => { if (item && !unitOptions.some((u) => u.code === f.unit)) setF((x) => ({ ...x, unit: item.default_unit ?? unitOptions[0]?.code ?? '' })); }, [f.itemId, units.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const en = (template.energy ?? {}) as { supplierFactorId?: string; cooling?: { method: string } };

  const save = async () => {
    setErr(null); setBusy(true);
    const body = { name: f.name.trim(), serial: f.serial || null, ...(f.externalId.trim() ? { externalId: f.externalId.trim() } : {}), accountNo: f.accountNo.trim() || null,
      readingType: f.readingType, frequency: f.frequency, unit: f.unit, multiplier: Number(f.multiplier) || 1, rollover: f.rollover ? Number(f.rollover) : null,
      itemId: f.itemId, template, gapFill: f.gapFill, autoEntries: f.autoEntries, note: f.note || null };
    try { onDone(meter ? await api.updateMeter(meter.id, body) : await api.addMeter({ ...body, facilityId: f.facilityId })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <h2>{meter ? `Edit ${meter.name}` : 'Add a meter'}</h2>
      {draft?.label && <div className="note info">What it measures comes from Add data: <b>{draft.label}</b> — with the same supplier, region and other inputs.</div>}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {!meter && <label className="field" style={{ minWidth: 240 }}><span>Facility</span>
          <select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}>{facilities.map((x) => <option key={x.id} value={x.id}>{x.parent_name ? `${x.parent_name} › ` : ''}{x.name}</option>)}</select></label>}
        <label className="field grow" style={{ minWidth: 220 }}><span>Name</span><input className="input" value={f.name} maxLength={120} placeholder="e.g. Main incomer, DEWA account 2001…" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ width: 150 }}><span>Serial no. (optional)</span><input className="input" value={f.serial} maxLength={80} onChange={(e) => setF({ ...f, serial: e.target.value })} /></label>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 230 }}><span>Id in the sending system</span><input className="input mono" value={f.externalId} maxLength={120} placeholder="set automatically" onChange={(e) => setF({ ...f, externalId: e.target.value })} /></label>
        <label className="field" style={{ width: 230 }}><span>Utility account no. (bills)</span><input className="input mono" value={f.accountNo} maxLength={60} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></label>
        <span className="sub grow" style={{ paddingBottom: 8 }}>Readings sent by another system (BMS, utility portal, IoT platform) use the id; bills are matched by the account number.</span>
      </div>

      <fieldset className="box"><legend>What it measures</legend>
        {carried && !energy ? <div className="sub">{item?.name ?? '…'} — inputs from Add data are kept (re-create the meter from Add data to change them).</div> : (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field grow" style={{ minWidth: 280 }}><span>Fuel, energy or waste process</span>
              <select className="input" value={f.itemId || ''} disabled={carried} onChange={(e) => { setF({ ...f, itemId: Number(e.target.value) }); setTemplate({}); }}>
                <option value="">Choose…</option>
                {cats.map((c) => <optgroup key={c.id} label={c.name}>{items.filter((i) => i.cat.id === c.id && (c.code !== 'mobile_combustion')).map((i) => <option key={i.id} value={i.id}>{i.sub.name} · {i.name}</option>)}</optgroup>)}
              </select></label>
          </div>
        )}
        {energy && energy !== 'cooling' && !carried && (
          <label className="field"><span>Supplier factor (market-based; optional)</span>
            <select className="input" value={en.supplierFactorId ?? ''} onChange={(e) => setTemplate(e.target.value ? { energy: { ...en, supplierFactorId: e.target.value } } : {})}>
              <option value="">None — residual mix / grid average</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier} · {s.co2e} kg/{s.unit.replace(/_.*/, '')} · {s.valid_from.slice(0, 7)}–{s.valid_to.slice(0, 7)}</option>)}
            </select></label>
        )}
        {energy === 'cooling' && !carried && (
          <label className="field"><span>Supplier factor (needed for cooling)</span>
            <select className="input" value={en.supplierFactorId ?? ''} onChange={(e) => setTemplate({ energy: { supplierFactorId: e.target.value || undefined, cooling: { method: 'supplier' } } })}>
              <option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier} · {s.co2e} kg/{s.unit} · {s.valid_from.slice(0, 7)}–{s.valid_to.slice(0, 7)}</option>)}
            </select></label>
        )}
        {item?.cat.code === 'waste_treatment' && !carried && <div className="note info">For waste, set up the meter from Add data → Waste (Month by month → “Set up a meter with these inputs”), so the process details come with it.</div>}
      </fieldset>

      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 260 }}><span>Readings are</span>
          <select className="input" value={f.readingType} onChange={(e) => setF({ ...f, readingType: e.target.value as 'interval' })}>
            <option value="interval">Consumption per period (interval)</option><option value="cumulative">Register / index (counts up)</option></select></label>
        <label className="field" style={{ width: 200 }}><span>How often</span>
          <select className="input" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value as 'day' })}>{FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field" style={{ width: 170 }}><span>Unit</span>
          <select className="input" value={f.unit} disabled={!item} onChange={(e) => setF({ ...f, unit: e.target.value })}>{unitOptions.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>
        <label className="field" style={{ width: 120 }}><span>Multiplier</span><input className="input num" value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        {f.readingType === 'cumulative' && <label className="field" style={{ width: 160 }}><span>Register maximum</span><input className="input num" value={f.rollover} placeholder="e.g. 999999" onChange={(e) => setF({ ...f, rollover: e.target.value.replace(/[^0-9.]/g, '') })} /></label>}
      </div>
      <div className="sub">{f.readingType === 'cumulative'
        ? 'Consumption = difference between readings, spread over the time between them (a reading across a month end is split by time). A drop is a rollover (with the register maximum) or a reset, flagged.'
        : 'Each value is the consumption since the previous one (or since its start time). Bills are booked this way, one value per billing period.'} Multiplier: CT ratio or pulse value, applied to every reading.</div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={f.autoEntries} onChange={(e) => setF({ ...f, autoEntries: e.target.checked })} />Create the monthly entries automatically when a month has ended</label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={f.gapFill === 'prorate'} onChange={(e) => setF({ ...f, gapFill: e.target.checked ? 'prorate' : 'none' })} />Scale a partly covered month up to the whole month (marked estimated)</label>
      </div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={() => onDone()}>Cancel</button>
        <button className="btn p" disabled={busy || !f.name.trim() || !f.itemId || !f.unit || (!meter && !f.facilityId)} onClick={save}>{meter ? 'Save meter' : 'Add meter'}</button>
      </div>
    </div>
  );
}
