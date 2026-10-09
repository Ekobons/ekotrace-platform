/**
 * Add data — Waste.
 *
 * Which scope depends on who runs the treatment site:
 *   Treated at our own site (Scope 1)    landfill, incineration / waste-to-energy, composting,
 *                                        anaerobic digestion, wastewater — IPCC 2006 Vol. 5 + 2019 Refinement
 *   Sent to another company (Scope 3.5)  tonnes by material and route × DESNZ waste disposal factor
 *
 * Every IPCC default is shown next to its field and can be replaced with a site value.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, ApiError, num, tco2e, type CalcResponse, type Category, type WasteDefaults, type WasteSite } from '../lib/api';
import { Result } from '../components/Result';
import { WasteSites } from '../components/WasteSites';
import { Icon } from '../components/Icon';
import { MonthGrid } from '../components/MonthGrid';

type Process = 'landfill' | 'incineration' | 'composting' | 'ad' | 'wastewater';
const PROCESSES: [Process, string][] = [['landfill', 'Landfill'], ['incineration', 'Incineration / WtE'], ['composting', 'Composting'], ['ad', 'Anaerobic digestion'], ['wastewater', 'Wastewater']];
const ITEM: Record<Process, string> = { landfill: 'waste:landfill', incineration: 'waste:incineration', composting: 'waste:composting', ad: 'waste:ad', wastewater: 'waste:wastewater' };

interface RecRow { device: string; mode: 'kg' | 'gas'; ch4Kg: string; gasM3: string; ch4Pct: string; de: string }
const newRec = (device = 'flare_enclosed'): RecRow => ({ device, mode: 'gas', ch4Kg: '', gasM3: '', ch4Pct: '50', de: '' });
const n = (s: string) => (s === '' ? undefined : Number(s));
const clean = (s: string) => s.replace(/[^0-9.]/g, '');
function recPayload(rows: RecRow[]) {
  const out = [];
  for (const r of rows) {
    if (r.mode === 'kg' ? r.ch4Kg === '' : r.gasM3 === '' || r.ch4Pct === '') continue;
    out.push({ device: r.device, ...(r.mode === 'kg' ? { ch4Kg: Number(r.ch4Kg) } : { gasM3: Number(r.gasM3), ch4Pct: Number(r.ch4Pct) }), ...(r.de !== '' ? { de: Number(r.de) / 100 } : {}) });
  }
  return out;
}

/** Gas recovered and burned in flares / engines, or sent out. */
function Recovery({ d, rows, set, title }: { d: WasteDefaults; rows: RecRow[]; set: (r: RecRow[]) => void; title: string }) {
  const up = (i: number, p: Partial<RecRow>) => set(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <fieldset className="box"><legend>{title}</legend>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field" style={{ width: 250 }}><span>Device</span>
            <select className="input" value={r.device} onChange={(e) => up(i, { device: e.target.value })}>{Object.entries(d.devices).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></label>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={r.mode === 'gas' ? 'on' : ''} onClick={() => up(i, { mode: 'gas' })}>m³ gas × CH₄ %</button>
            <button className={r.mode === 'kg' ? 'on' : ''} onClick={() => up(i, { mode: 'kg' })}>kg CH₄</button>
          </div>
          {r.mode === 'gas' ? <>
            <label className="field" style={{ width: 150 }}><span>Gas (normal m³)</span><input className="input num" value={r.gasM3} onChange={(e) => up(i, { gasM3: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 90 }}><span>CH₄ %</span><input className="input num" value={r.ch4Pct} onChange={(e) => up(i, { ch4Pct: clean(e.target.value) })} /></label>
          </> : <label className="field" style={{ width: 150 }}><span>kg CH₄</span><input className="input num" value={r.ch4Kg} onChange={(e) => up(i, { ch4Kg: clean(e.target.value) })} /></label>}
          {r.device !== 'exported' && <label className="field" style={{ width: 130 }} title={d.devices[r.device]?.source}><span>Destruction %</span>
            <input className="input num" value={r.de} placeholder={String(Math.round((d.devices[r.device]?.de ?? 0) * 100))} onChange={(e) => up(i, { de: clean(e.target.value) })} /></label>}
          <button className="btn ghost sm" onClick={() => set(rows.filter((_, k) => k !== i))} aria-label="Remove"><Icon name="x" /></button>
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="sub">Default destruction: open flare 50%, enclosed flare 90% (CDM Tool 06); engines and boilers the manufacturer's value, at most 99%. Methane not destroyed counts as emitted; the CO₂ from burning it is biogenic.</span>
        <button className="btn sm" onClick={() => set([...rows, newRec()])}><Icon name="plus" />Add device</button>
      </div>
    </fieldset>
  );
}

export function WasteEntry({ cat, cats, facilityId, period, onSaved, monthly }: {
  cat: Category; cats: Category[]; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void;
  /** month by month for this year */
  monthly?: number;
}) {
  const navigate = useNavigate();
  const own = cat.calc_method === 'waste';
  const other = cats.find((c) => c.code === (own ? 'waste_generated' : 'waste_treatment'));
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card row" style={{ gap: 12 }}>
        <div className="seg">
          <button className={own ? 'on' : ''} onClick={() => !own && other && navigate(`/data/${other.code}`)}>Treated at our own site · Scope 1</button>
          <button className={!own ? 'on' : ''} onClick={() => own && other && navigate(`/data/${other.code}`)}>Sent to another company · Scope 3.5</button>
        </div>
        <span className="sub grow">{own
          ? 'Landfills, incinerators, composting and digestion plants, and wastewater plants the company operates: their emissions are Scope 1.'
          : 'Waste handed to another company for treatment: Scope 3 category 5. (That company reports the same tonnes in its own Scope 1.)'}</span>
      </div>
      {own ? <OwnSite cat={cat} facilityId={facilityId} period={period} onSaved={onSaved} monthly={monthly} /> : <SentOut cat={cat} facilityId={facilityId} period={period} onSaved={onSaved} monthly={monthly} />}
    </div>
  );
}

// ------------------------------------------------------------- own sites (Scope 1) --
function OwnSite({ cat, facilityId, period, onSaved, monthly }: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void; monthly?: number }) {
  const { toast, role } = useApp();
  const [d, setD] = useState<WasteDefaults | null>(null);
  const [proc, setProc] = useState<Process>('landfill');
  const [sites, setSites] = useState<WasteSite[]>([]);
  const [showSites, setShowSites] = useState(false);
  // landfill
  const [siteId, setSiteId] = useState('');
  const [lfMethod, setLfMethod] = useState<'fod' | 'collection'>('fod');
  const [ce, setCe] = useState('75');
  const [rec, setRec] = useState<RecRow[]>([]);
  // incineration
  const [streams, setStreams] = useState<{ type: string; tonnes: string }[]>([{ type: 'msw', tonnes: '' }]);
  const [tech, setTech] = useState('continuous_stoker');
  const [measured, setMeasured] = useState(false);
  const [meas, setMeas] = useState({ co2Tonnes: '', biogenicPct: '', source: '' });
  const [inc, setInc] = useState({ of: '', ch4PerT: '', n2oPerT: '', exportedMWh: '' });
  const [incAdv, setIncAdv] = useState(false);
  const [plant, setPlant] = useState<Record<string, { dm?: string; cf?: string; fcf?: string }>>({});
  // biological
  const [bio, setBio] = useState({ tonnes: '', basis: 'wet' as 'wet' | 'dry', ch4PerT: '', n2oPerT: '' });
  const [adMeasured, setAdMeasured] = useState(false);
  const [ad, setAd] = useState({ mode: 'gas' as 'gas' | 'kg', ch4Kg: '', gasM3: '', ch4Pct: '60', leakPct: '' });
  const [adRec, setAdRec] = useState<RecRow[]>([newRec('engine')]);
  // wastewater
  const [ww, setWw] = useState({ kind: 'domestic' as 'domestic' | 'industrial', system: 'centralised_aerobic', measure: 'BOD' as 'BOD' | 'COD', mode: 'flow' as 'flow' | 'kg',
    organicsKg: '', flowM3: '', mgPerL: '', sludgeKg: '', nInfluentKg: '', nEffluentKg: '', effluentOrganicsKg: '', mcf: '', bo: '', efPlant: '', efEffluent: '' });
  const [wwRec, setWwRec] = useState<RecRow[]>([]);
  const [wwAdv, setWwAdv] = useState(false);

  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role);

  useEffect(() => { api.wasteDefaults().then(setD); }, []);
  useEffect(() => {
    if (!facilityId) return;
    api.wasteSites(facilityId).then((r) => { setSites(r.sites); setSiteId((id) => (r.sites.some((s) => s.id === id) ? id : r.sites.find((s) => s.active)?.id ?? '')); });
  }, [facilityId]);
  const itemId = cat.subcategories.flatMap((s) => s.items).find((i) => i.code === ITEM[proc])?.id;
  const site = sites.find((s) => s.id === siteId);
  const yearOnly = period.periodStart.slice(5) === '01-01' && period.periodEnd.slice(5) === '12-31';

  /** The entry's waste details; `reading` replaces the monthly reading (tonnes, flow or organics) for month by month. */
  const wasteFor = useMemo(() => (reading?: number): Record<string, unknown> | null => {
    if (!d) return null;
    const r = (field: string) => (reading !== undefined ? String(reading) : field);
    if (proc === 'landfill') {
      if (!siteId) return null;
      const recovery = recPayload(rec);
      if (lfMethod === 'collection' && !recovery.length) return null;
      return { process: 'landfill', siteId, method: lfMethod, ...(lfMethod === 'collection' ? { collectionEfficiency: Number(ce) / 100 } : {}), recovery };
    }
    if (proc === 'incineration') {
      if (reading !== undefined && streams.length !== 1) return null;
      const st = streams.map((s, i) => ({ type: s.type, tonnes: i === 0 ? r(s.tonnes) : s.tonnes })).filter((s) => s.tonnes !== '').map((s) => ({ type: s.type, tonnes: Number(s.tonnes) }));
      if (!st.length) return null;
      if (reading !== undefined && measured) return null;
      if (measured && (meas.co2Tonnes === '' || meas.biogenicPct === '' || meas.source.trim().length < 2)) return null;
      const overrides = Object.fromEntries(Object.entries(plant).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined).map(([f, x]) => [f, Number(x) / 100]))]).filter(([, v]) => Object.keys(v as object).length));
      return { process: 'incineration', streams: st, technology: tech, ...(measured ? { measured: { co2Tonnes: Number(meas.co2Tonnes), biogenicPct: Number(meas.biogenicPct), source: meas.source.trim() } } : {}),
        ...(inc.of !== '' ? { of: Number(inc.of) / 100 } : {}), ...(inc.ch4PerT !== '' ? { ch4PerT: Number(inc.ch4PerT) } : {}), ...(inc.n2oPerT !== '' ? { n2oPerT: Number(inc.n2oPerT) } : {}),
        ...(inc.exportedMWh !== '' && reading === undefined ? { exportedMWh: Number(inc.exportedMWh) } : {}), ...(Object.keys(overrides).length ? { overrides } : {}) };
    }
    if (proc === 'composting' || proc === 'ad') {
      if (r(bio.tonnes) === '') return null;
      const m = proc === 'ad' && adMeasured && reading === undefined
        ? (ad.mode === 'kg' ? (ad.ch4Kg === '' ? null : { ch4ProducedKg: Number(ad.ch4Kg) }) : (ad.gasM3 === '' || ad.ch4Pct === '' ? null : { gasM3: Number(ad.gasM3), ch4Pct: Number(ad.ch4Pct) }))
        : undefined;
      if (m === null) return null;
      return { process: proc, tonnes: Number(r(bio.tonnes)), basis: bio.basis, ...(bio.ch4PerT !== '' && !m ? { ch4PerT: Number(bio.ch4PerT) } : {}), ...(bio.n2oPerT !== '' ? { n2oPerT: Number(bio.n2oPerT) } : {}),
        ...(m ? { measured: { ...m, ...(ad.leakPct !== '' ? { leakPct: Number(ad.leakPct) } : {}), recovery: recPayload(adRec) } } : {}) };
    }
    const flow = ww.mode === 'flow';
    const org = !flow ? (r(ww.organicsKg) === '' ? null : { organicsKg: Number(r(ww.organicsKg)) }) : (r(ww.flowM3) === '' || ww.mgPerL === '' ? null : { flowM3: Number(r(ww.flowM3)), mgPerL: Number(ww.mgPerL) });
    if (!org) return null;
    const opt = (k: keyof typeof ww, as: string = k) => (ww[k] !== '' ? { [as]: Number(ww[k]) } : {});
    // With flow, nitrogen and effluent are concentrations (mg/L); with kg, totals for the period (not repeated month by month).
    const n = flow ? { ...opt('nInfluentKg', 'nInfluentMgPerL'), ...opt('nEffluentKg', 'nEffluentMgPerL'), ...opt('effluentOrganicsKg', 'effluentMgPerL') }
      : reading === undefined ? { ...opt('nInfluentKg'), ...opt('nEffluentKg'), ...opt('effluentOrganicsKg') } : {};
    return { process: 'wastewater', kind: ww.kind, system: ww.system, measure: ww.measure, ...org, ...(reading === undefined ? opt('sludgeKg') : {}), ...n,
      ...opt('mcf'), ...opt('bo'), ...opt('efPlant'), ...opt('efEffluent'), recovery: reading === undefined ? recPayload(wwRec) : [] };
  }, [d, proc, siteId, lfMethod, ce, rec, streams, tech, measured, meas, inc, plant, bio, adMeasured, ad, adRec, ww, wwRec]);
  const waste = useMemo(() => wasteFor(), [wasteFor]);
  const buildMonth = useMemo(() => (q: number, p: { periodStart: string; periodEnd: string }) => {
    const w = itemId ? wasteFor(q) : null;
    return w ? { itemId, unit: proc === 'wastewater' ? 'kg' : 't', ...p, waste: w } : null;
  }, [wasteFor, itemId, proc]);
  const monthOk = !!monthly && proc !== 'landfill' && !(proc === 'incineration' && (streams.length !== 1 || measured)) && !(proc === 'ad' && adMeasured);

  const payload = useMemo(() => (itemId && waste ? { itemId, unit: proc === 'wastewater' ? 'kg' : 't', facilityId: facilityId || undefined, ...period, waste } : null), [itemId, waste, proc, facilityId, period]);

  useEffect(() => {
    setError(null);
    if (!payload) { setResult(null); return; }
    const t = window.setTimeout(() => { api.calculate(payload).then(setResult).catch((e: ApiError) => { setResult(null); setError(e.message); }); }, 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  async function save() {
    if (!payload || !facilityId) return;
    setSaving(true);
    try {
      const r = await api.saveActivity({ ...payload, facilityId, dataType, note: note || undefined });
      toast(`Saved: ${PROCESSES.find((p) => p[0] === proc)![1]} · ${tco2e(r.totals.direct)} tCO₂e`);
      setNote(''); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  if (!d) return <div className="card empty">Loading…</div>;
  const incTypes = [{ code: 'msw', name: 'Mixed municipal waste (by composition)' }, ...d.types];
  const usedTypes = [...new Set(streams.flatMap((s) => (s.type === 'msw' ? Object.keys(d.msw.composition) : [s.type])))].map((c) => d.types.find((t) => t.code === c)!).filter((t) => t && (t.cf ?? 0) > 0);

  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <div className="seg">{PROCESSES.map(([k, l]) => <button key={k} className={proc === k ? 'on' : ''} onClick={() => setProc(k)}>{l}</button>)}</div>

      {proc === 'landfill' && <>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 300 }}><span>Landfill</span>
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {!sites.length && <option value="">No landfill sites for this facility yet</option>}
              {sites.map((s) => <option key={s.id} value={s.id} disabled={!s.active}>{s.name}{s.history?.rows ? ` · history ${s.history.first}–${s.history.last}` : ' · no history'}</option>)}</select></label>
          <button className="btn sm" onClick={() => setShowSites(!showSites)}>{showSites ? 'Hide' : 'Manage'} landfill sites & history</button>
          <div className="grow" />
          <div className="seg">
            <button className={lfMethod === 'fod' ? 'on' : ''} onClick={() => setLfMethod('fod')}>Modelled from tonnage history (IPCC FOD)</button>
            <button className={lfMethod === 'collection' ? 'on' : ''} onClick={() => { setLfMethod('collection'); if (!rec.length) setRec([newRec()]); }}>From gas collected</button>
          </div>
        </div>
        {showSites && <WasteSites facilityId={facilityId} canEdit={canManage} onChange={(s) => { setSites(s); if (!siteId && s[0]) setSiteId(s[0].id); }} />}
        {site && !site.history?.rows && lfMethod === 'fod' && <div className="note warn">{site.name} has no tonnage history: add it under “Manage landfill sites & history”.</div>}
        <div className="sub">
          {lfMethod === 'fod'
            ? <>Methane generated this year from the waste placed in all earlier years (first order decay, IPCC 2006 Vol. 5 ch. 3), less the gas recovered, less {Math.round((site?.params.ox ?? 0) * 100)}% oxidised in the cover. {!yearOnly && 'The model gives a yearly figure: for a month, the share of days is used.'}</>
            : <>Methane generated = gas collected ÷ collection efficiency. Use when the gas is metered but the tonnage history is not known.</>}
        </div>
        {monthly && <div className="note info">Landfill methane is modelled per year, so this entry covers the whole of {monthly} (month by month does not apply).</div>}
        {lfMethod === 'collection' && <label className="field" style={{ width: 220 }}><span>Collection efficiency %</span><input className="input num" value={ce} onChange={(e) => setCe(clean(e.target.value))} />
          <small className="muted">US EPA AP-42 §2.4: typically 60–85% (75% average) with an active gas system</small></label>}
        <Recovery d={d} rows={rec} set={setRec} title="Landfill gas recovered in the period (leave empty if none)" />
      </>}

      {proc === 'incineration' && <>
        <fieldset className="box"><legend>Waste incinerated (wet weight)</legend>
          {streams.map((s, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="field grow"><span>Waste type</span><select className="input" value={s.type} onChange={(e) => setStreams(streams.map((x, k) => (k === i ? { ...x, type: e.target.value } : x)))}>
                {['msw', 'industrial', 'sludge', 'other'].map((g) => <optgroup key={g} label={{ msw: 'Municipal & commercial', industrial: 'Industrial (IPCC Table 2.5)', sludge: 'Sludge', other: 'Other' }[g]}>
                  {incTypes.filter((t) => (t.code === 'msw' ? g === 'msw' : d.types.find((x) => x.code === t.code)?.group === g)).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</optgroup>)}
              </select></label>
              {!monthOk && <label className="field" style={{ width: 160 }}><span>Tonnes</span><input className="input num" value={s.tonnes} onChange={(e) => setStreams(streams.map((x, k) => (k === i ? { ...x, tonnes: clean(e.target.value) } : x)))} /></label>}
              {streams.length > 1 && <button className="btn ghost sm" onClick={() => setStreams(streams.filter((_, k) => k !== i))} aria-label="Remove"><Icon name="x" /></button>}
            </div>))}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setStreams([...streams, { type: 'ind_other', tonnes: '' }])}><Icon name="plus" />Add waste type</button></div>
        </fieldset>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 400 }}><span>Technology (sets CH₄ and N₂O, IPCC Tables 5.3, 5.6)</span>
            <select className="input" value={tech} onChange={(e) => setTech(e.target.value)}>{Object.entries(d.incinerators).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></label>
          <label className="row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}><input type="checkbox" checked={measured} onChange={(e) => setMeasured(e.target.checked)} />Use measured stack CO₂ (CEMS) and its biogenic share</label>
        </div>
        {measured && <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 170 }}><span>Stack CO₂, tonnes</span><input className="input num" value={meas.co2Tonnes} onChange={(e) => setMeas({ ...meas, co2Tonnes: clean(e.target.value) })} /></label>
          <label className="field" style={{ width: 170 }}><span>Biogenic share %</span><input className="input num" value={meas.biogenicPct} onChange={(e) => setMeas({ ...meas, biogenicPct: clean(e.target.value) })} /></label>
          <label className="field grow"><span>Source (CEMS report, carbon-14 analysis…)</span><input className="input" value={meas.source} maxLength={200} onChange={(e) => setMeas({ ...meas, source: e.target.value })} /></label>
        </div>}
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={incAdv} onChange={(e) => setIncAdv(e.target.checked)} />Plant values (replace IPCC defaults) and energy exported</label>
        {incAdv && <div style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ width: 150 }}><span>Oxidation %</span><input className="input num" placeholder="100" value={inc.of} onChange={(e) => setInc({ ...inc, of: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 150 }}><span>CH₄ kg per tonne</span><input className="input num" placeholder={String(d.incinerators[tech]?.ch4)} value={inc.ch4PerT} onChange={(e) => setInc({ ...inc, ch4PerT: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 150 }}><span>N₂O kg per tonne</span><input className="input num" placeholder={`${d.incinerators[tech]?.n2oMsw} (MSW)`} value={inc.n2oPerT} onChange={(e) => setInc({ ...inc, n2oPerT: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 190 }}><span>Electricity / heat exported, MWh</span><input className="input num" value={inc.exportedMWh} onChange={(e) => setInc({ ...inc, exportedMWh: clean(e.target.value) })} /></label>
          </div>
          {!measured && <table className="t" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
            <thead><tr><th>Waste type</th><th className="num">Dry matter %</th><th className="num">Carbon % of dry</th><th className="num">Fossil % of carbon</th></tr></thead>
            <tbody>{usedTypes.map((t) => (
              <tr key={t.code}><td>{t.name}</td>{(['dm', 'cf', 'fcf'] as const).map((f) => (
                <td key={f} className="num"><input className="input num" style={{ width: 90, height: 30 }} value={plant[t.code]?.[f] ?? ''} placeholder={num((t[f] ?? 0) * 100, 4)}
                  onChange={(e) => setPlant({ ...plant, [t.code]: { ...plant[t.code], [f]: clean(e.target.value) } })} /></td>))}</tr>))}</tbody>
          </table>}
          <div className="sub">Energy exported is shown in the steps, never subtracted (GHG Protocol). Defaults: IPCC 2006 Vol. 5 Table 2.4 / 2.5; oxidation Table 5.2.</div>
        </div>}
      </>}

      {(proc === 'composting' || proc === 'ad') && <>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          {!monthOk && <label className="field" style={{ width: 170 }}><span>Waste treated, tonnes</span><input className="input num" value={bio.tonnes} onChange={(e) => setBio({ ...bio, tonnes: clean(e.target.value) })} /></label>}
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={bio.basis === 'wet' ? 'on' : ''} onClick={() => setBio({ ...bio, basis: 'wet' })}>Wet weight</button>
            <button className={bio.basis === 'dry' ? 'on' : ''} onClick={() => setBio({ ...bio, basis: 'dry' })}>Dry weight</button>
          </div>
          {!(proc === 'ad' && adMeasured) && <label className="field" style={{ width: 150 }}><span>CH₄ kg per tonne</span><input className="input num" placeholder={String(d.bio[proc][bio.basis].ch4)} value={bio.ch4PerT} onChange={(e) => setBio({ ...bio, ch4PerT: clean(e.target.value) })} /></label>}
          <label className="field" style={{ width: 150 }}><span>N₂O kg per tonne</span><input className="input num" placeholder={String(d.bio[proc][bio.basis].n2o)} value={bio.n2oPerT} onChange={(e) => setBio({ ...bio, n2oPerT: clean(e.target.value) })} /></label>
          {proc === 'ad' && <label className="row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}><input type="checkbox" checked={adMeasured} onChange={(e) => setAdMeasured(e.target.checked)} />Use measured biogas</label>}
        </div>
        <div className="sub">Defaults: IPCC 2006 Vol. 5 Table 4.1 ({proc === 'composting' ? 'composting: 4 g CH₄ and 0.24 g N₂O per kg wet waste' : 'anaerobic digestion: 0.8 g CH₄ per kg wet waste, already net of gas recovered; N₂O negligible'}).</div>
        {proc === 'ad' && adMeasured && <>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="seg" style={{ marginBottom: 4 }}>
              <button className={ad.mode === 'gas' ? 'on' : ''} onClick={() => setAd({ ...ad, mode: 'gas' })}>Biogas m³ × CH₄ %</button>
              <button className={ad.mode === 'kg' ? 'on' : ''} onClick={() => setAd({ ...ad, mode: 'kg' })}>kg CH₄</button>
            </div>
            {ad.mode === 'gas' ? <>
              <label className="field" style={{ width: 160 }}><span>Biogas produced (m³)</span><input className="input num" value={ad.gasM3} onChange={(e) => setAd({ ...ad, gasM3: clean(e.target.value) })} /></label>
              <label className="field" style={{ width: 90 }}><span>CH₄ %</span><input className="input num" value={ad.ch4Pct} onChange={(e) => setAd({ ...ad, ch4Pct: clean(e.target.value) })} /></label>
            </> : <label className="field" style={{ width: 160 }}><span>CH₄ produced (kg)</span><input className="input num" value={ad.ch4Kg} onChange={(e) => setAd({ ...ad, ch4Kg: clean(e.target.value) })} /></label>}
            <label className="field" style={{ width: 130 }}><span>Leaks %</span><input className="input num" placeholder={String(d.adLeak * 100)} value={ad.leakPct} onChange={(e) => setAd({ ...ad, leakPct: clean(e.target.value) })} /></label>
          </div>
          <Recovery d={d} rows={adRec} set={setAdRec} title="Biogas burned or sent out (the rest, after leaks, counts as vented)" />
        </>}
      </>}

      {proc === 'wastewater' && <>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={ww.kind === 'domestic' ? 'on' : ''} onClick={() => setWw({ ...ww, kind: 'domestic' })}>Domestic / municipal</button>
            <button className={ww.kind === 'industrial' ? 'on' : ''} onClick={() => setWw({ ...ww, kind: 'industrial' })}>Industrial</button>
          </div>
          <label className="field grow"><span>Treatment system (sets MCF, IPCC 2019 Table {ww.kind === 'domestic' ? '6.3' : '6.8'})</span>
            <select className="input" value={ww.system} onChange={(e) => setWw({ ...ww, system: e.target.value })}>{Object.entries(d.wastewater).map(([k, v]) => <option key={k} value={k}>{v.name} · MCF {v[ww.kind]}</option>)}</select></label>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={ww.measure === 'BOD' ? 'on' : ''} onClick={() => setWw({ ...ww, measure: 'BOD' })}>BOD</button>
            <button className={ww.measure === 'COD' ? 'on' : ''} onClick={() => setWw({ ...ww, measure: 'COD' })}>COD</button>
          </div>
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className={ww.mode === 'flow' ? 'on' : ''} onClick={() => setWw({ ...ww, mode: 'flow' })}>Flow × concentration</button>
            <button className={ww.mode === 'kg' ? 'on' : ''} onClick={() => setWw({ ...ww, mode: 'kg' })}>kg {ww.measure}</button>
          </div>
          {ww.mode === 'flow' ? <>
            {!monthOk && <label className="field" style={{ width: 160 }}><span>Inflow (m³)</span><input className="input num" value={ww.flowM3} onChange={(e) => setWw({ ...ww, flowM3: clean(e.target.value) })} /></label>}
            <label className="field" style={{ width: 160 }}><span>Influent {ww.measure} (mg/L)</span><input className="input num" value={ww.mgPerL} onChange={(e) => setWw({ ...ww, mgPerL: clean(e.target.value) })} /></label>
          </> : !monthOk && <label className="field" style={{ width: 160 }}><span>{ww.measure} treated (kg)</span><input className="input num" value={ww.organicsKg} onChange={(e) => setWw({ ...ww, organicsKg: clean(e.target.value) })} /></label>}
          {!monthOk && <label className="field" style={{ width: 190 }}><span>Removed as sludge (kg {ww.measure})</span><input className="input num" placeholder="0" value={ww.sludgeKg} onChange={(e) => setWw({ ...ww, sludgeKg: clean(e.target.value) })} /></label>}
        </div>
        {ww.mode === 'kg' && monthOk ? <div className="sub">Month by month with kg {ww.measure}: nitrogen and sludge are not repeated each month. Use “Flow × concentration” to include nitrogen as mg/L, or enter them month by month.</div> : (
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 230 }}><span>Nitrogen in influent ({ww.mode === 'flow' ? 'mg/L N' : 'kg N'})</span><input className="input num" value={ww.nInfluentKg} onChange={(e) => setWw({ ...ww, nInfluentKg: clean(e.target.value) })} /></label>
          <label className="field" style={{ width: 230 }}><span>Nitrogen in effluent ({ww.mode === 'flow' ? 'mg/L N' : 'kg N'})</span><input className="input num" value={ww.nEffluentKg} onChange={(e) => setWw({ ...ww, nEffluentKg: clean(e.target.value) })} /></label>
          <label className="field" style={{ width: 220 }}><span>{ww.measure} left in effluent ({ww.mode === 'flow' ? 'mg/L' : 'kg'})</span><input className="input num" value={ww.effluentOrganicsKg} onChange={(e) => setWw({ ...ww, effluentOrganicsKg: clean(e.target.value) })} /></label>
        </div>)}
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={wwAdv} onChange={(e) => setWwAdv(e.target.checked)} />Plant values (replace IPCC defaults) and gas recovered</label>
        {wwAdv && <>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ width: 120 }}><span>MCF</span><input className="input num" placeholder={String(d.wastewater[ww.system]?.[ww.kind])} value={ww.mcf} onChange={(e) => setWw({ ...ww, mcf: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 170 }}><span>Bo kg CH₄/kg {ww.measure}</span><input className="input num" placeholder={String(d.bo[ww.measure])} value={ww.bo} onChange={(e) => setWw({ ...ww, bo: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 200 }}><span>N₂O plant (kg N₂O-N/kg N)</span><input className="input num" placeholder={String(d.n2oPlant)} value={ww.efPlant} onChange={(e) => setWw({ ...ww, efPlant: clean(e.target.value) })} /></label>
            <label className="field" style={{ width: 210 }}><span>N₂O effluent (kg N₂O-N/kg N)</span><input className="input num" placeholder={String(d.n2oEffluent)} value={ww.efEffluent} onChange={(e) => setWw({ ...ww, efEffluent: clean(e.target.value) })} /></label>
          </div>
          <Recovery d={d} rows={wwRec} set={setWwRec} title="Biogas recovered from the plant (digesters)" />
        </>}
        <div className="sub">CH₄ = ({ww.measure} treated − removed as sludge) × Bo {d.bo[ww.measure]} × MCF; N₂O = nitrogen × emission factor × 44/28 (IPCC 2006 Vol. 5 ch. 6, 2019 Refinement factors).</div>
      </>}

      {monthly && proc !== 'landfill' && !monthOk && <div className="note info">Month by month needs one reading per month: {proc === 'incineration' ? 'one waste type and no measured stack CO₂' : 'no measured biogas'}. Otherwise choose a month or the whole year.</div>}
      {monthOk ? <MonthGrid year={monthly!} facilityId={facilityId} build={buildMonth} onSaved={onSaved}
        label={proc === 'wastewater' ? (ww.mode === 'flow' ? 'Inflow' : `${ww.measure} treated`) : proc === 'incineration' ? 'Waste incinerated' : 'Waste treated'}
        unitName={proc === 'wastewater' ? (ww.mode === 'flow' ? 'm³' : `kg ${ww.measure}`) : 'tonnes'}
        hint={`Paste 12 values from Excel (a row or a column) into January to fill all months.${proc === 'incineration' && inc.exportedMWh ? ' Energy exported is not repeated month by month.' : ''}${proc === 'wastewater' && wwRec.length ? ' Gas recovered is not repeated month by month.' : ''}`}
        dup={{ category: 'waste_treatment', same: (a) => a.item === cat.subcategories.flatMap((x) => x.items).find((i) => i.code === ITEM[proc])?.name }} /> : <>
      <div className="row">
        <label className="field" style={{ width: 160 }}><span>Data type</span>
          <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></label>
        <label className="field grow"><span>Note / reference</span><input className="input" value={note} maxLength={1000} placeholder="Weighbridge report, gas meter log, lab analysis…" onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      {error && <div className="note bad">{error}</div>}
      {result ? <Result r={result} /> : !error && <div className="note info">Enter the {proc === 'landfill' ? 'landfill and any gas recovered' : proc === 'wastewater' ? 'organics load' : 'tonnes'} to see the emissions and how they were calculated.</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn p" disabled={!result || !facilityId || saving} onClick={save}>{saving ? 'Saving…' : 'Save entry'}</button></div>
      </>}
    </div>
  );
}

// -------------------------------------------------------- sent out (Scope 3.5) --
interface Row3 { material: string; route: string; tonnes: string; note: string }
const emptyRow = (): Row3 => ({ material: '', route: 'landfill', tonnes: '', note: '' });
const ROUTE: Record<string, string> = { landfill: 'Landfill', combustion: 'Combustion (energy recovery)', open_loop: 'Open-loop recycling', closed_loop: 'Closed-loop recycling', composting: 'Composting', ad: 'Anaerobic digestion', reuse: 'Re-use' };

function SentOut({ cat, facilityId, period, onSaved, monthly }: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void; monthly?: number }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<Row3[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [unit, setUnit] = useState<'t' | 'kg'>('t');
  const [res, setRes] = useState<Record<number, { co2e?: number; error?: string; warnings?: string[] }>>({});
  const [busy, setBusy] = useState(false);
  // Materials (grouped) and the routes each has a factor for.
  const materials = useMemo(() => {
    const m = new Map<string, { group: string; name: string; routes: Map<string, number> }>();
    for (const s of cat.subcategories) for (const i of s.items) {
      const a = (i.attrs ?? {}) as { material?: string; route?: string };
      if (!a.material || !a.route) continue;
      const key = `${s.code}|${a.material}`;
      const e = m.get(key) ?? { group: s.name, name: a.material, routes: new Map() };
      e.routes.set(a.route, i.id);
      m.set(key, e);
    }
    return m;
  }, [cat]);
  const groups = [...new Set([...materials.values()].map((m) => m.group))];
  const entries = rows.map((r, i) => ({ r, i, id: materials.get(r.material)?.routes.get(r.route) })).filter((x) => x.r.material && x.r.tonnes !== '');
  const payload = entries.map(({ r, id }) => ({ itemId: id ?? 0, unit, quantity: Number(r.tonnes), facilityId, ...period, dataType: 'actual', note: r.note || undefined }));
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

  const up = (i: number, p: Partial<Row3>) => setRows(rows.map((r, k) => {
    if (k !== i) return r;
    const nr = { ...r, ...p };
    const routes = materials.get(nr.material)?.routes;
    if (routes && !routes.has(nr.route)) nr.route = routes.has('landfill') ? 'landfill' : [...routes.keys()][0]!;
    return nr;
  }));
  const total = Object.values(res).reduce((s, x) => s + (x.co2e ?? 0), 0);
  // Month by month: one material and route, a reading per month.
  const [mm, setMm] = useState({ material: '', route: 'landfill' });
  const mmRoutes = materials.get(mm.material)?.routes;
  const mmItem = mmRoutes?.get(mm.route);
  const buildMonth = useMemo(() => (q: number, p: { periodStart: string; periodEnd: string }) => (mmItem ? { itemId: mmItem, unit, quantity: q, ...p } : null), [mmItem, unit]);
  const okCount = entries.filter((e) => res[e.i]?.co2e !== undefined).length;

  const save = async () => {
    setBusy(true);
    try {
      const b = await api.batch(payload, false);
      toast(`${b.saved} saved${b.failed ? `, ${b.failed} with problems` : ''}`);
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.i));
      setRows((rs) => { const left = rs.filter((_, i) => failed.has(i)); return left.length ? left : [emptyRow(), emptyRow(), emptyRow()]; });
      onSaved();
    } finally { setBusy(false); }
  };

  if (monthly) return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div className="row"><div className="grow" style={{ minWidth: 0 }}><h2>Waste sent for treatment · month by month</h2>
        <p className="sub">Choose the material and route once, then the {unit === 't' ? 'tonnes' : 'kg'} for each month. For several materials, save one, then choose the next.</p></div>
        <div className="seg"><button className={unit === 't' ? 'on' : ''} onClick={() => setUnit('t')}>tonnes</button><button className={unit === 'kg' ? 'on' : ''} onClick={() => setUnit('kg')}>kg</button></div></div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field grow"><span>Material</span><select className="input" value={mm.material} onChange={(e) => {
          const r = materials.get(e.target.value)?.routes;
          setMm({ material: e.target.value, route: r && !r.has(mm.route) ? (r.has('landfill') ? 'landfill' : [...r.keys()][0]!) : mm.route });
        }}>
          <option value="">Choose…</option>
          {groups.map((g) => <optgroup key={g} label={g}>{[...materials.entries()].filter(([, m]) => m.group === g).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}</optgroup>)}
        </select></label>
        <label className="field" style={{ width: 260 }}><span>Route</span><select className="input" value={mm.route} disabled={!mmRoutes} onChange={(e) => setMm({ ...mm, route: e.target.value })}>
          {Object.entries(ROUTE).filter(([k]) => !mmRoutes || mmRoutes.has(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <MonthGrid year={monthly} facilityId={facilityId} build={buildMonth} onSaved={onSaved} bases={['scope3']}
        label={mm.material ? `${materials.get(mm.material)?.name} · ${ROUTE[mm.route]}` : 'Waste sent'} unitName={unit === 't' ? 'tonnes' : 'kg'}
        dup={{ category: 'waste_generated', same: (a) => a.item === `${materials.get(mm.material)?.name} · ${ROUTE[mm.route]}` }} />
    </div>
  );
  return (
    <div className="card" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <div className="row"><div className="grow" style={{ minWidth: 0 }}><h2>Waste sent for treatment</h2>
        <p className="sub">One row per material and route. Factor: DESNZ waste disposal, kg CO₂e per tonne — the end-of-life treatment (for recycling, only up to the recycler), not the material's production.</p></div>
        <div className="seg"><button className={unit === 't' ? 'on' : ''} onClick={() => setUnit('t')}>tonnes</button><button className={unit === 'kg' ? 'on' : ''} onClick={() => setUnit('kg')}>kg</button></div></div>
      <table className="t" style={{ border: '1px solid var(--line)', borderRadius: 12, tableLayout: 'fixed', width: '100%' }}>
        <colgroup><col style={{ width: '34%' }} /><col style={{ width: '22%' }} /><col style={{ width: 130 }} /><col /><col style={{ width: 100 }} /><col style={{ width: 48 }} /></colgroup>
        <thead><tr><th>Material</th><th>Route</th><th className="num">{unit === 't' ? 'Tonnes' : 'kg'}</th><th>Note</th><th className="num">tCO₂e</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const routes = materials.get(r.material)?.routes;
          const x = res[i];
          return (
            <tr key={i}>
              <td><select className="input" style={{ height: 32, width: '100%' }} value={r.material} onChange={(e) => up(i, { material: e.target.value })}>
                <option value="">—</option>
                {groups.map((g) => <optgroup key={g} label={g}>{[...materials.entries()].filter(([, m]) => m.group === g).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}</optgroup>)}
              </select></td>
              <td><select className="input" style={{ height: 32, width: '100%' }} value={r.route} disabled={!routes} onChange={(e) => up(i, { route: e.target.value })}>
                {Object.entries(ROUTE).filter(([k]) => !routes || routes.has(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="num"><input className="input num" style={{ width: '100%', height: 32 }} value={r.tonnes} onChange={(e) => up(i, { tonnes: clean(e.target.value) })} /></td>
              <td><input className="input" style={{ height: 32, width: '100%' }} value={r.note} maxLength={200} placeholder="Contractor, manifest no." onChange={(e) => up(i, { note: e.target.value })} /></td>
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
        {okCount > 0 && <span className="sub">{okCount} row{okCount === 1 ? '' : 's'} · <b>{tco2e(total)} tCO₂e</b> (Scope 3.5)</span>}
        <button className="btn p" disabled={!okCount || busy || !facilityId} onClick={save}>{busy ? 'Saving…' : `Save ${okCount || ''} entr${okCount === 1 ? 'y' : 'ies'}`}</button>
      </div>
      <div className="note info">DESNZ factors are UK averages (UK landfills capture much of their gas). For waste going to a landfill without gas capture, the real figure is likely higher. Operator-specific factors per tonne are not supported yet: keep any figure the operator gives you in the row's note.</div>
    </div>
  );
}
