/**
 * CBAM — EU Carbon Border Adjustment Mechanism (definitive period from 2026).
 *  Producers (non-EU installations, e.g. UAE plants selling to the EU): installations and production processes,
 *    a yearly report per installation (activity, attributed emissions, electricity, precursors, goods by CN code,
 *    verification) giving the specific embedded emissions of each good; export of the summary emissions report,
 *    the sheet for EU importers and the values to enter in the CBAM Registry (O3CI portal).
 *  Importers (EU authorised declarants): imported goods by CN code and origin, actual or default emissions,
 *    free allocation adjustment, certificates and cost; export of the annual declaration workbook.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, download, type CbamData, type CbamImport, type CbamInstallation, type CbamLine, type CbamReport } from '../lib/api';
import { Icon } from '../components/Icon';
import { CountrySelect, CityInput } from '../components/CountrySelect';
import { countryLabel } from '../lib/countries';
import { CbamComms } from './CbamComm';

type Tab = 'overview' | 'comms' | 'installations' | 'reports' | 'imports' | 'reference';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['comms', 'Exporter portal'], ['installations', 'Installations'], ['reports', 'Emissions reports'], ['imports', 'Imports & declaration'], ['reference', 'Default values & benchmarks']];
const f = (x: number | null | undefined, d = 3) => (x == null ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
const f0 = (x: number | null | undefined) => (x == null ? '—' : Math.round(x).toLocaleString('en-GB'));
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'grey'], verified: ['Verified', ''], shared: ['Verified · shared', 'info'] };
const cnFmt = (c: string) => c.replace(/^(\d{4})(\d{2})?(\d{2})?$/, (_, a, b, cc) => [a, b, cc].filter(Boolean).join(' '));
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
type Act = (fn: () => Promise<unknown>, msg: string) => Promise<void>;

/** In the CBAM Exporter package, each part is a page of its own (`only`), without the tab bar. */
const ONLY: Partial<Record<Tab, [string, string]>> = {
  comms: ['Communications to importers', 'Each quarter, the embedded emissions of the goods you sell to the EU, in the Commission\'s communication template — filled in step by step and downloaded as Excel.'],
  installations: ['Installations', 'Your plants as registered in the CBAM Registry, with their production processes.'],
  reports: ['Annual emissions report', 'The installation\'s report for the year: activity, attributed emissions, precursors, goods and verification — with the summary for the CBAM Registry.'],
  reference: ['Default values & benchmarks', 'The Commission\'s default values and CBAM benchmarks, to compare with your own embedded emissions.'],
};
export function Cbam({ only }: { only?: Tab } = {}) {
  const { toast } = useApp();
  const navTo = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = only ?? ((TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'overview') as Tab);
  const year = Number(sp.get('year') ?? new Date().getFullYear());
  const set = (x: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
  const [d, setD] = useState<CbamData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.cbam(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const act: Act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  return (
    <div className="page">
      {only ? <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">CBAM</span><h1>{ONLY[only]?.[0]}</h1><div className="muted">{ONLY[only]?.[1]}</div></div>
        {(only === 'reports' || only === 'reference') && <label className="field" style={{ minWidth: 110 }}><span>Year</span>
          <select className="input" value={year} onChange={(e) => set({ year: e.target.value })}>{[2025, 2026, 2027, 2028].map((y) => <option key={y}>{y}</option>)}</select></label>}
      </div> : <>
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose</span><h1>CBAM</h1>
          <div className="muted">EU Carbon Border Adjustment Mechanism. <b>Producers</b> outside the EU work out the embedded emissions of the cement, fertilisers, iron and steel, aluminium or hydrogen they sell to the EU and share them through the CBAM Registry. <b>Importers</b> in the EU declare the goods they import each year and surrender CBAM certificates.</div></div>
        <label className="field" style={{ minWidth: 110 }}><span>Year</span>
          <select className="input" value={year} onChange={(e) => set({ year: e.target.value })}>{[2025, 2026, 2027, 2028].map((y) => <option key={y}>{y}</option>)}</select></label>
      </div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>{l}</button>)}</div>
      </>}
      {tab === 'overview' && <Overview d={d} go={(t) => set({ tab: t })} />}
      {tab === 'comms' && <CbamComms commId={sp.get('comm')} open={(id) => set({ comm: id })} compact={!!only} />}
      {tab === 'installations' && <Installations d={d} act={act} openReport={(id) => (only ? navTo(`/cbam/annual?report=${id}`) : set({ tab: 'reports', report: id }))} />}
      {tab === 'reports' && <Reports d={d} reportId={sp.get('report')} pick={(id) => set({ report: id })} reloadAll={reload} />}
      {tab === 'imports' && <Imports year={year} d={d} />}
      {tab === 'reference' && <References d={d} act={act} />}
    </div>
  );
}

// --------------------------------------------------------------- overview --
function Overview({ d, go }: { d: CbamData; go: (t: Tab) => void }) {
  const goods = new Set(d.reports.flatMap((r) => r.lines.flatMap((l) => l.goods)));
  return <>
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Installations</span><b>{d.installations.length}</b><span className="muted small">{d.installations.reduce((a, i) => a + i.processes.length, 0)} production processes</span></div>
      <div className="card kpi"><span className="muted small">{d.year} emissions reports</span><b>{d.reports.length}</b><span className="muted small">{d.reports.filter((r) => r.status !== 'draft').length} verified · {goods.size} CN codes</span></div>
      <div className="card kpi"><span className="muted small">{d.year} imports declared</span><b>{f0(d.imports.mass)} <small className="muted">t</small></b><span className="muted small">{d.imports.lines} lines · {f0(d.imports.embedded)} tCO₂e embedded</span></div>
      <div className="card kpi"><span className="muted small">Certificates to surrender</span><b>{f0(d.imports.certificates)}</b><span className="muted small">≈ EUR {f0(d.imports.cost)} · CBAM factor {Math.round(d.cbamFactor * 1000) / 10}%</span></div>
    </div>
    <div className="cbamgrid">
      <section className="card">
        <span className="lbl">If you produce and export to the EU</span><h3 style={{ margin: '4px 0 8px' }}>Producer: share verified embedded emissions</h3>
        <ol className="cbsteps">
          <li><b>Register the installation</b> in the CBAM Registry (O3CI portal) and record it under <a href="#" onClick={(e) => { e.preventDefault(); go('installations'); }}>Installations</a> with its production processes.</li>
          <li><b>Report the year:</b> activity level, attributed direct emissions, electricity, precursors and the goods (CN codes) of each process. The tool works out the specific embedded emissions per tonne.</li>
          <li><b>Verify:</b> an accredited verifier checks the report (site visit required for 2026). Record the verifier and the opinion.</li>
          <li><b>Share:</b> download the summary emissions report and the O3CI entry sheet, enter the values in the Registry and disclose them to your EU buyers by their EORI numbers. The “For EU importers” sheet goes to buyers by e-mail.</li>
        </ol>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="btn p" onClick={() => go('comms')}>Exporter portal →</button><span className="muted small" style={{ alignSelf: 'center' }}>Fill the Commission's communication template for your importers each quarter and download it as Excel.</span></div>
      </section>
      <section className="card">
        <span className="lbl">If you import into the EU</span><h3 style={{ margin: '4px 0 8px' }}>Importer: declare and surrender certificates</h3>
        <ol className="cbsteps">
          <li><b>Record the imports</b> of CBAM goods by CN code and origin — typed, or uploaded from your customs broker's file.</li>
          <li><b>Emissions per line:</b> the installation's verified data, or the default value with the year's mark-up ({Math.round(d.markup.other * 100)}% in {d.year}; {Math.round(d.markup.fertilisers * 100)}% fertilisers).</li>
          <li><b>Certificates:</b> embedded emissions minus the free allocation adjustment (CBAM benchmark × {Math.round(d.cbamFactor * 1000) / 10}%) and any carbon price paid, priced at the quarter's certificate price.</li>
          <li><b>Declare:</b> {d.year === 2026 ? 'the 2026 declaration is due by 30 September 2027; certificates are sold from 1 February 2027.' : 'the declaration is due by 30 September of the following year.'} Download the declaration workbook and enter it in the CBAM Registry (declarant portal).</li>
        </ol>
        <button className="btn" onClick={() => go('imports')}>Imports & declaration →</button>
      </section>
    </div>
    <div className="note info small">Default values and benchmarks must be the official ones (Implementing Regulations (EU) 2025/2621 and 2025/2620). Values marked <span className="chip warn">illustrative</span> are only for the demo: replace them under Default values & benchmarks. The CBAM Registry is filled in on screen; the tool prepares every value in the order the Registry asks for it.</div>
  </>;
}

// ------------------------------------------------------------ installations --
function Installations({ d, act, openReport }: { d: CbamData; act: Act; openReport: (id: string) => void }) {
  const [edit, setEdit] = useState<CbamInstallation | 'new' | null>(null);
  const [proc, setProc] = useState<{ inst: CbamInstallation; p: CbamInstallation['processes'][number] | null } | null>(null);
  return <>
    {d.can.edit && <div className="row"><span className="grow" /><button className="btn p" onClick={() => setEdit('new')}>+ Installation</button></div>}
    {!d.installations.length && <div className="card empty">No installation yet. Add the plant that produces CBAM goods, with the identifier the CBAM Registry gave it.</div>}
    {d.installations.map((i) => {
      const rep = i.reports.find((r) => r.year === d.year);
      return <section key={i.id} className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="grow"><h3 style={{ margin: 0 }}>{i.name}</h3>
            <div className="muted small">{[i.registry_id && `Registry ID ${i.registry_id}`, i.unlocode, [i.city, countryLabel(i.country)].filter(Boolean).join(', '), i.facility && `facility: ${i.facility}`, i.operator_name && `operator: ${i.operator_name}`].filter(Boolean).join(' · ')}</div></div>
          {d.can.edit && <button className="btn sm" onClick={() => setEdit(i)}><Icon name="edit" size={15} /> Details</button>}
          {rep ? <button className="btn sm p" onClick={() => openReport(rep.id)}>{d.year} report · {STATUS[rep.status]![0]}</button>
            : d.can.edit && <button className="btn sm p" disabled={!i.processes.length} title={i.processes.length ? '' : 'Add a production process first'} onClick={() => act(async () => { const r = await api.cbamReportCreate(i.id, d.year); openReport(r.id); }, `${d.year} report started`)}>Start {d.year} report</button>}
        </div>
        <div className="scroll"><table className="t">
          <thead><tr><th>Production process</th><th>Aggregated goods category</th><th>Route</th><th>Sector</th>{d.can.edit && <th />}</tr></thead>
          <tbody>{i.processes.map((p) => <tr key={p.id}><td><b>{p.name}</b></td><td>{d.categories[p.category]?.name}</td><td>{p.route || '—'}</td><td>{d.sectors[d.categories[p.category]?.sector ?? '']}</td>
            {d.can.edit && <td className="num"><button className="btn sm ghost" aria-label="Edit" onClick={() => setProc({ inst: i, p })}><Icon name="edit" size={15} /></button>
              <button className="btn sm ghost" aria-label="Remove" onClick={() => act(() => api.cbamProcessDelete(p.id), 'Process removed')}><Icon name="x" size={15} /></button></td>}</tr>)}
            {!i.processes.length && <tr><td colSpan={5} className="muted small">No production process yet.</td></tr>}</tbody></table></div>
        {d.can.edit && <div><button className="btn sm" onClick={() => setProc({ inst: i, p: null })}>+ Production process</button></div>}
        {i.reports.length > 0 && <div className="muted small">Reports: {i.reports.map((r) => <a key={r.id} href="#" style={{ marginRight: 10 }} onClick={(e) => { e.preventDefault(); openReport(r.id); }}>{r.year} ({STATUS[r.status]![0]})</a>)}</div>}
      </section>;
    })}
    {edit && <InstallationDrawer d={d} i={edit === 'new' ? null : edit} onClose={() => setEdit(null)} act={act} />}
    {proc && <ProcessDrawer d={d} inst={proc.inst} p={proc.p} onClose={() => setProc(null)} act={act} />}
  </>;
}

function Drawer({ title, eyebrow, onClose, children, foot }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  return <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
    <div className="row"><div className="grow"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
    {children}
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>{foot}<button className="btn ghost" onClick={() => dlg.current?.close()}>Cancel</button></div>
  </div></dialog>;
}

function InstallationDrawer({ d, i, onClose, act }: { d: CbamData; i: CbamInstallation | null; onClose: () => void; act: Act }) {
  const s = (v: unknown) => (v == null ? '' : String(v));
  const [v, setV] = useState(() => ({ name: s(i?.name), facilityId: s(i?.facility_id), registryId: s(i?.registry_id), unlocode: s(i?.unlocode), address: s(i?.address), city: s(i?.city), postcode: s(i?.postcode), country: i?.country ?? 'AE',
    lat: s(i?.lat), lon: s(i?.lon), operatorName: s(i?.operator_name), operatorReg: s(i?.operator_reg), operatorAddress: s(i?.operator_address), operatorCountry: i?.operator_country ?? i?.country ?? 'AE',
    contactName: s(i?.contact_name), contactEmail: s(i?.contact_email), contactPhone: s(i?.contact_phone), notes: s(i?.notes) }));
  const up = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const t = (k: keyof typeof v, l: string, p = '', cls = 'field') => <label className={cls}><span>{l}</span><input className="input" value={v[k]} placeholder={p} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  const o = (x: string) => (x.trim() === '' ? null : x.trim());
  const save = () => act(async () => {
    await api.cbamInstallationSave({ name: v.name.trim(), facilityId: o(v.facilityId), registryId: o(v.registryId), unlocode: o(v.unlocode), address: o(v.address), city: o(v.city), postcode: o(v.postcode), country: v.country,
      lat: numOrNull(v.lat), lon: numOrNull(v.lon), operatorName: o(v.operatorName), operatorReg: o(v.operatorReg), operatorAddress: o(v.operatorAddress), operatorCountry: o(v.operatorCountry),
      contactName: o(v.contactName), contactEmail: o(v.contactEmail), contactPhone: o(v.contactPhone), notes: v.notes.trim() }, i?.id);
    onClose();
  }, i ? 'Saved' : 'Installation added');
  return <Drawer eyebrow="CBAM · installation" title={i ? i.name : 'New installation'} onClose={onClose}
    foot={<>{i && <button className="btn ghost" onClick={() => act(async () => { await api.cbamInstallationDelete(i.id); onClose(); }, 'Removed')}>Remove</button>}<button className="btn p" disabled={v.name.trim().length < 2} onClick={() => void save()}>Save</button></>}>
    <div className="note info small">As registered in the CBAM Registry (O3CI portal). Everything is reported in English.</div>
    <div className="vform">
      {t('name', 'Installation name', 'e.g. Aluminium remelt, Sharjah', 'field span2')}
      <label className="field"><span>Facility in {''}this tool (optional)</span><select className="input" value={v.facilityId} onChange={(e) => up({ facilityId: e.target.value })}><option value="">—</option>{d.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {t('registryId', 'CBAM Registry identifier', 'given by the O3CI portal')}
      {t('address', 'Street address', '', 'field span2')}
      <label className="field"><span>Country</span><CountrySelect value={v.country} onChange={(c) => up({ country: c })} /></label>
      <label className="field"><span>City</span><CityInput country={v.country} value={v.city} onChange={(x) => up({ city: x })} /></label>
      {t('postcode', 'Post code / PO box')}{t('unlocode', 'UN/LOCODE', 'e.g. AE SHJ')}
      {t('lat', 'Latitude of the main emission source', '25.329000')}{t('lon', 'Longitude', '55.645000')}
      {t('operatorName', 'Operator (legal name)', '', 'field span2')}{t('operatorReg', 'Operator registration number', 'trade licence / company register no.')}
      <label className="field"><span>Operator country</span><CountrySelect value={v.operatorCountry} onChange={(c) => up({ operatorCountry: c })} /></label>
      {t('operatorAddress', 'Operator address', '', 'field span2')}
      {t('contactName', 'Contact person')}{t('contactEmail', 'Contact e-mail')}{t('contactPhone', 'Contact phone')}
      {t('notes', 'Notes', '', 'field span2')}
    </div>
  </Drawer>;
}

function ProcessDrawer({ d, inst, p, onClose, act }: { d: CbamData; inst: CbamInstallation; p: CbamInstallation['processes'][number] | null; onClose: () => void; act: Act }) {
  const [v, setV] = useState({ category: p?.category ?? 'unwrought_aluminium', route: p?.route ?? '', name: p?.name ?? '' });
  const cat = d.categories[v.category]!;
  const bySector = Object.entries(d.sectors).map(([s, n]) => [n, Object.entries(d.categories).filter(([, c]) => c.sector === s)] as const);
  return <Drawer eyebrow={`CBAM · ${inst.name}`} title={p ? 'Edit production process' : 'Add a production process'} onClose={onClose}
    foot={<button className="btn p" disabled={v.name.trim().length < 2 || (cat.routes.length > 0 && !v.route)} onClick={() => void act(async () => { await api.cbamProcessSave({ category: v.category, route: v.route, name: v.name.trim() }, inst.id, p?.id); onClose(); }, 'Saved')}>Save</button>}>
    <div className="vform">
      <label className="field span2"><span>Aggregated goods category</span><select className="input" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value, route: d.categories[e.target.value]!.routes[0] ?? '' })}>
        {bySector.map(([n, cs]) => <optgroup key={n} label={n}>{cs.map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}</optgroup>)}</select></label>
      {cat.routes.length > 0 && <label className="field span2"><span>Production route</span><select className="input" value={v.route} onChange={(e) => setV({ ...v, route: e.target.value })}><option value="">Choose…</option>{cat.routes.map((r) => <option key={r}>{r}</option>)}</select></label>}
      <label className="field span2"><span>Name of the process</span><input className="input" value={v.name} placeholder="e.g. Remelt furnace 2" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
    </div>
    <div className="muted small">Indirect emissions (electricity) {['cement', 'fertilisers'].includes(cat.sector) ? <b>count</b> : <b>do not count</b>} in the embedded emissions of {d.sectors[cat.sector]!.toLowerCase()} goods; they are still reported.</div>
  </Drawer>;
}

// ----------------------------------------------------------------- reports --
function Reports({ d, reportId, pick, reloadAll }: { d: CbamData; reportId: string | null; pick: (id: string) => void; reloadAll: () => void }) {
  const { toast } = useApp();
  const all = d.installations.flatMap((i) => i.reports.map((r) => ({ ...r, installation: i.name })));
  const id = reportId ?? all.find((r) => r.year === d.year)?.id ?? all[0]?.id ?? null;
  const [r, setR] = useState<CbamReport | null>(null);
  const [tick, setTick] = useState(0);
  const [head, setHead] = useState(false);
  useEffect(() => { if (id) api.cbamReport(id).then(setR).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { setTick((t) => t + 1); reloadAll(); };
  const act: Act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  if (!all.length) return <div className="card empty">No report yet: under Installations, start the year's report for an installation.</div>;
  if (!r || r.report.id !== id) return <div className="card empty">Loading…</div>;
  const R = r.report, ed = r.can.edit;
  const body = (status: string) => ({ periodStart: R.period_start.slice(0, 10), periodEnd: R.period_end.slice(0, 10), elecEf: R.elec_ef, elecEfSource: R.elec_ef_source, monitoringPlan: R.monitoring_plan,
    verifierName: R.verifier_name, verifierAccreditation: R.verifier_accreditation, verifierCountry: R.verifier_country, verificationDate: R.verification_date?.slice(0, 10) ?? null, siteVisitDate: R.site_visit_date?.slice(0, 10) ?? null,
    opinion: R.opinion, carbonPrice: R.carbon_price, notes: R.notes, sharedWith: R.shared_with, status });
  const attributed = r.lines.reduce((a, l) => a + Number(l.direct_t ?? 0), 0);
  return <>
    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <label className="field" style={{ minWidth: 320 }}><span>Report</span><select className="input" value={id ?? ''} onChange={(e) => pick(e.target.value)}>{all.map((x) => <option key={x.id} value={x.id}>{x.installation} · {x.year} · {STATUS[x.status]![0]}</option>)}</select></label>
      <span className="grow" />
      <span className={`chip ${STATUS[R.status]![1]}`}>{STATUS[R.status]![0]}</span>
      <button className="btn" onClick={() => download(`/api/cbam/reports/${R.id}/export`, `CBAM ${R.installation} ${R.year}.xlsx`).catch((e) => toast((e as Error).message))}><Icon name="download" size={15} /> Summary report & O3CI sheet</button>
      {ed && <button className="btn p" onClick={() => setHead(true)}>Period, electricity & verification</button>}
      {r.can.reopen && <button className="btn" onClick={() => act(() => api.cbamReportSave(R.id, body('draft')), 'Reopened as draft')}>Reopen</button>}
      {R.status === 'verified' && <button className="btn p" onClick={() => act(() => api.cbamReportSave(R.id, body('shared')), 'Marked as shared with importers')}>Mark shared</button>}
    </div>
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Reporting period</span><b style={{ fontSize: 18 }}>{d8(R.period_start)} – {d8(R.period_end)}</b><span className="muted small">{R.monitoring_plan ?? 'monitoring plan not given'}</span></div>
      <div className="card kpi"><span className="muted small">Attributed direct emissions</span><b>{f0(attributed)} <small className="muted">tCO₂e</small></b>
        <span className="muted small">{r.inventory ? <>facility Scope 1 in the inventory: {f0(r.inventory.s1)} t{attributed > r.inventory.s1 * 1.0001 && r.inventory.s1 > 0 ? ' — more than the facility total' : ''}</> : 'link the installation to a facility to compare'}</span></div>
      <div className="card kpi"><span className="muted small">Electricity factor</span><b>{R.elec_ef == null ? '—' : f(R.elec_ef, 4)} <small className="muted">tCO₂/MWh</small></b><span className="muted small">{R.elec_ef_source ?? 'not given'}</span></div>
      <div className="card kpi"><span className="muted small">Verification</span><b style={{ fontSize: 18 }}>{R.verifier_name ?? 'Not verified'}</b><span className="muted small">{R.verification_date ? d8(R.verification_date) : 'accredited verifier, site visit for 2026'}</span></div>
    </div>
    {r.lines.map((l) => <LineCard key={l.id} d={d} l={l} edit={ed} act={act} />)}
    {R.shared_with && <div className="muted small">Shared with: {R.shared_with}</div>}
    {head && <ReportDrawer d={d} r={r} onClose={() => setHead(false)} done={() => { setHead(false); reload(); }} />}
  </>;
}

function LineCard({ d, l, edit, act }: { d: CbamData; l: CbamLine; edit: boolean; act: Act }) {
  const cat = d.categories[l.category]!;
  const [v, setV] = useState(() => ({ activity: l.activity_t == null ? '' : String(l.activity_t), direct: l.direct_t == null ? '' : String(l.direct_t), elec: l.elec_mwh == null ? '' : String(l.elec_mwh), def: String(Math.round(l.default_share * 1000) / 10), params: { ...(l.params ?? {}) } }));
  const dirty = v.activity !== (l.activity_t == null ? '' : String(l.activity_t)) || v.direct !== (l.direct_t == null ? '' : String(l.direct_t)) || v.elec !== (l.elec_mwh == null ? '' : String(l.elec_mwh))
    || Number(v.def) !== Math.round(l.default_share * 1000) / 10 || JSON.stringify(v.params) !== JSON.stringify(l.params ?? {});
  const [g, setG] = useState({ cn: '', q: '' });
  const [p, setP] = useState<null | { category: string; cn: string; origin: string; qty: string; dir: string; ind: string; source: string; supplier: string; ref: string }>(null);
  const sectorCn = d.cn.filter(([, c]) => d.categories[c]?.sector === cat.sector);
  const num = (s: string) => s.replace(/[^0-9.]/g, '');
  return <section className="card" style={{ display: 'grid', gap: 12 }}>
    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      <div className="grow"><span className="lbl">{l.categoryName}{l.route ? ` · ${l.route}` : ''}</span><h3 style={{ margin: 0 }}>{l.process}</h3></div>
      <div className="cbsee"><div><span>Direct</span><b>{f(l.see.seeDirect, 4)}</b></div><div><span>Indirect</span><b>{f(l.see.seeIndirect, 4)}</b></div>
        <div className="on"><span>SEE for CBAM</span><b>{f(l.see.seeTotal, 4)}</b><small>tCO₂e per t{l.see.counted ? ' · indirect counted' : ' · direct only'}</small></div>
        <div><span>Default values</span><b>{Math.round(l.see.defaultShare * 100)}%</b></div></div>
    </div>
    <div className="vform four">
      <label className="field"><span>Activity level (t produced{cat.sector === 'electricity' ? ', MWh' : ''})</span><input className="input num" disabled={!edit} value={v.activity} onChange={(e) => setV({ ...v, activity: num(e.target.value) })} /></label>
      <label className="field"><span>Attributed direct emissions (tCO₂e)</span><input className="input num" disabled={!edit} value={v.direct} onChange={(e) => setV({ ...v, direct: num(e.target.value) })} /></label>
      <label className="field"><span>Electricity consumed (MWh)</span><input className="input num" disabled={!edit} value={v.elec} onChange={(e) => setV({ ...v, elec: num(e.target.value) })} /></label>
      <label className="field"><span>Share of direct emissions on default values (%)</span><input className="input num" disabled={!edit} value={v.def} onChange={(e) => setV({ ...v, def: num(e.target.value) })} /></label>
      {cat.params.map((x) => <label key={x.key} className="field"><span>{x.label}{x.unit ? ` (${x.unit})` : ''}</span><input className="input" disabled={!edit} value={v.params[x.key] ?? ''} onChange={(e) => setV({ ...v, params: { ...v.params, [x.key]: e.target.value } })} /></label>)}
    </div>
    {edit && dirty && <div className="row"><span className="grow muted small">Not saved yet</span><button className="btn p sm" onClick={() => void act(() => api.cbamLineSave(l.id, { activityT: numOrNull(v.activity), directT: numOrNull(v.direct), elecMwh: numOrNull(v.elec), defaultShare: Math.min(1, Number(v.def || 0) / 100), params: v.params }), 'Saved')}>Save figures</button></div>}
    <div className="cols2">
      <div>
        <h4 className="cbh">Goods produced (CN codes)</h4>
        <table className="t"><thead><tr><th>CN code</th><th>Good</th><th className="num">Quantity (t)</th>{edit && <th />}</tr></thead>
          <tbody>{l.goods.map((x) => <tr key={x.id}><td className="mono">{cnFmt(x.cn)}</td><td>{x.description}</td><td className="num">{f(x.quantity_t, 1)}</td>
            {edit && <td className="num"><button className="btn sm ghost" aria-label="Remove" onClick={() => void act(() => api.cbamGoodDelete(x.id), 'Removed')}><Icon name="x" size={15} /></button></td>}</tr>)}
            {!l.goods.length && <tr><td colSpan={4} className="muted small">Add the CN codes this process produces: the embedded emissions are reported per good.</td></tr>}</tbody></table>
        {edit && <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input className="input mono" style={{ width: 150 }} list={`cn-${l.id}`} placeholder="CN code (8 digits)" value={g.cn} onChange={(e) => setG({ ...g, cn: e.target.value })} />
          <datalist id={`cn-${l.id}`}>{sectorCn.map(([c, , n]) => <option key={c} value={c}>{n}</option>)}</datalist>
          <input className="input num" style={{ width: 120 }} placeholder="tonnes" value={g.q} onChange={(e) => setG({ ...g, q: num(e.target.value) })} />
          <button className="btn sm" disabled={g.cn.replace(/\D/g, '').length < 4} onClick={() => void act(async () => { await api.cbamGoodAdd(l.id, { cn: g.cn, description: '', quantityT: numOrNull(g.q) }); setG({ cn: '', q: '' }); }, 'Good added')}>+ Add good</button></div>}
      </div>
      <div>
        <h4 className="cbh">Precursors consumed</h4>
        <table className="t"><thead><tr><th>Precursor</th><th>Origin</th><th className="num">t used</th><th className="num">SEE dir.</th><th className="num">SEE ind.</th><th className="ctr">Values</th>{edit && <th />}</tr></thead>
          <tbody>{l.precursors.map((x) => <tr key={x.id}><td>{d.categories[x.category]?.name}{x.cn ? <div className="muted small mono">{cnFmt(x.cn)}</div> : null}</td><td>{x.origin ? countryLabel(x.origin) : '—'}</td><td className="num">{f(x.quantity_t, 1)}</td><td className="num">{f(x.see_direct, 4)}</td><td className="num">{f(x.see_indirect, 4)}</td>
            <td className="ctr"><span className={`chip ${x.source === 'default' ? 'warn' : ''}`}>{x.source}</span></td>
            {edit && <td className="num"><button className="btn sm ghost" aria-label="Remove" onClick={() => void act(() => api.cbamPrecursorDelete(x.id), 'Removed')}><Icon name="x" size={15} /></button></td>}</tr>)}
            {!l.precursors.length && <tr><td colSpan={7} className="muted small">None. Add CBAM goods used as inputs (clinker, pig iron, unwrought aluminium, ammonia…): their embedded emissions are added.</td></tr>}</tbody></table>
        {edit && !p && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setP({ category: Object.keys(d.categories).find((k) => d.categories[k]!.sector === cat.sector) ?? 'unwrought_aluminium', cn: '', origin: 'AE', qty: '', dir: '', ind: '', source: 'actual', supplier: '', ref: '' })}>+ Precursor</button>}
        {edit && p && <div className="cbprec">
          <select className="input" value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })}>{Object.entries(d.categories).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}</select>
          <input className="input mono" placeholder="CN (optional)" value={p.cn} onChange={(e) => setP({ ...p, cn: e.target.value })} />
          <CountrySelect value={p.origin} onChange={(c) => setP({ ...p, origin: c })} />
          <input className="input num" placeholder="t used" value={p.qty} onChange={(e) => setP({ ...p, qty: num(e.target.value) })} />
          <input className="input num" placeholder="SEE direct" value={p.dir} onChange={(e) => setP({ ...p, dir: num(e.target.value) })} />
          <input className="input num" placeholder="SEE indirect" value={p.ind} onChange={(e) => setP({ ...p, ind: num(e.target.value) })} />
          <select className="input" value={p.source} onChange={(e) => setP({ ...p, source: e.target.value })}><option value="actual">actual (supplier data)</option><option value="default">default value</option></select>
          <input className="input" placeholder="Supplier / installation" value={p.supplier} onChange={(e) => setP({ ...p, supplier: e.target.value })} />
          <div className="row" style={{ gap: 6 }}><button className="btn sm p" disabled={!p.qty || p.dir === ''} onClick={() => void act(async () => { await api.cbamPrecursorAdd(l.id, { category: p.category, cn: p.cn.trim() || null, origin: p.origin || null, quantityT: Number(p.qty), seeDirect: Number(p.dir), seeIndirect: Number(p.ind || 0), source: p.source, supplier: p.supplier.trim() || null }); setP(null); }, 'Precursor added')}>Add</button>
            <button className="btn sm ghost" onClick={() => setP(null)}>Cancel</button></div>
        </div>}
      </div>
    </div>
  </section>;
}

function ReportDrawer({ d, r, onClose, done }: { d: CbamData; r: CbamReport; onClose: () => void; done: () => void }) {
  const { toast } = useApp();
  const R = r.report, s = (x: unknown) => (x == null ? '' : String(x).slice(0, String(x).match(/^\d{4}-\d{2}-\d{2}T/) ? 10 : undefined));
  const [v, setV] = useState(() => ({ periodStart: s(R.period_start), periodEnd: s(R.period_end), elecEf: s(R.elec_ef), elecEfSource: s(R.elec_ef_source), monitoringPlan: s(R.monitoring_plan),
    verifierName: s(R.verifier_name), verifierAccreditation: s(R.verifier_accreditation), verifierCountry: s(R.verifier_country), verificationDate: s(R.verification_date), siteVisitDate: s(R.site_visit_date), opinion: s(R.opinion),
    cpInstrument: R.carbon_price?.instrument ?? '', cpCountry: R.carbon_price?.country ?? '', cpEur: s(R.carbon_price?.eurPerT), cpAmount: s(R.carbon_price?.amount), cpCurrency: R.carbon_price?.currency ?? '', cpRebate: R.carbon_price?.rebate ?? '', cpEvidence: R.carbon_price?.evidence ?? '',
    notes: R.notes, sharedWith: R.shared_with }));
  const up = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const t = (k: keyof typeof v, l: string, p = '', cls = 'field', type = 'text') => <label className={cls}><span>{l}</span><input className="input" type={type} value={v[k]} placeholder={p} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  const o = (x: string) => (x.trim() === '' ? null : x.trim());
  const save = async (status: string) => {
    try {
      await api.cbamReportSave(R.id, { periodStart: v.periodStart, periodEnd: v.periodEnd, elecEf: numOrNull(v.elecEf), elecEfSource: o(v.elecEfSource), monitoringPlan: o(v.monitoringPlan), verifierName: o(v.verifierName),
        verifierAccreditation: o(v.verifierAccreditation), verifierCountry: o(v.verifierCountry), verificationDate: o(v.verificationDate), siteVisitDate: o(v.siteVisitDate), opinion: o(v.opinion),
        carbonPrice: v.cpInstrument.trim() || v.cpEur.trim() ? { instrument: v.cpInstrument.trim(), country: v.cpCountry, eurPerT: numOrNull(v.cpEur), amount: numOrNull(v.cpAmount), currency: v.cpCurrency.trim().toUpperCase(), rebate: v.cpRebate.trim(), evidence: v.cpEvidence.trim() } : null,
        notes: v.notes.trim(), sharedWith: v.sharedWith.trim(), status });
      toast(status === 'draft' ? 'Saved' : 'Marked verified'); done();
    } catch (e) { toast((e as Error).message); }
  };
  void d;
  return <Drawer eyebrow={`CBAM · ${R.installation} · ${R.year}`} title="Period, electricity and verification" onClose={onClose}
    foot={<><button className="btn" onClick={() => void save('draft')}>Save draft</button><button className="btn p" onClick={() => void save('verified')}>Save and mark verified</button></>}>
    <div className="vform">
      {t('periodStart', 'Reporting period from', '', 'field', 'date')}{t('periodEnd', 'to', '', 'field', 'date')}
      {t('elecEf', 'Electricity emission factor (tCO₂/MWh)', 'e.g. 0.4041')}{t('elecEfSource', 'Source of the factor', 'grid factor used under IR 2025/2547, or the PPA / own generation')}
      {t('monitoringPlan', 'Monitoring plan (reference, version)', '', 'field span2')}
      {t('verifierName', 'Accredited verifier')}{t('verifierAccreditation', 'Accreditation number / body')}
      <label className="field"><span>Verifier country</span><CountrySelect value={v.verifierCountry} empty="—" onChange={(c) => up({ verifierCountry: c })} /></label>
      {t('siteVisitDate', 'Site visit', '', 'field', 'date')}{t('verificationDate', 'Verification report date', '', 'field', 'date')}
      <label className="field span2"><span>Verification opinion</span><textarea className="input" rows={2} value={v.opinion} placeholder="e.g. Verified as satisfactory with reasonable assurance" onChange={(e) => up({ opinion: e.target.value })} /></label>
      <div className="field span2"><span>Carbon price effectively paid in the country of production (Article 9) — only if one was paid</span></div>
      {t('cpInstrument', 'Instrument (tax, ETS)')}<label className="field"><span>Country</span><CountrySelect value={v.cpCountry} empty="—" onChange={(c) => up({ cpCountry: c })} /></label>
      {t('cpEur', 'EUR per tonne CO₂e')}{t('cpAmount', 'Amount paid')}{t('cpCurrency', 'Currency', 'AED')}{t('cpRebate', 'Rebates or compensation')}{t('cpEvidence', 'Evidence (document reference)', '', 'field span2')}
      <label className="field span2"><span>Notes: heat flows, zero-rated fuels, waste gases, CO₂ capture, on-site electricity</span><textarea className="input" rows={3} value={v.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
      {t('sharedWith', 'Shared with (EORI numbers of EU importers)', 'e.g. DE123456789012345, NL…', 'field span2')}
    </div>
    <div className="muted small">To mark it verified: verifier, verification date and opinion, the activity level and goods of every process, and the electricity factor where electricity counts.</div>
  </Drawer>;
}

// ----------------------------------------------------------------- imports --
function Imports({ year, d }: { year: number; d: CbamData }) {
  const { toast } = useApp();
  const [x, setX] = useState<Awaited<ReturnType<typeof api.cbamImports>> | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<CbamImport | 'new' | null>(null);
  const [upload, setUpload] = useState(false);
  useEffect(() => { if (year >= 2026) api.cbamImports(year).then(setX).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  if (year < 2026) return <div className="card empty">The definitive period (declarations and certificates) starts with 2026 imports. Choose 2026 or later.</div>;
  if (!x) return <div className="card empty">Loading…</div>;
  const L = x.lines, sum = (fn: (l: CbamImport) => number | null | undefined) => L.reduce((a, l) => a + (fn(l) ?? 0), 0);
  return <>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <div className="grow muted small">Certificate prices {year}: {x.prices.map((p) => `Q${p.quarter} ${p.price == null ? '—' : `EUR ${p.price.toFixed(2)}`}`).join(' · ')} · CBAM factor {Math.round(x.cbamFactor * 1000) / 10}%</div>
      <button className="btn ghost" onClick={() => download('/api/cbam/imports/template', 'CBAM imports template.xlsx').catch((e) => toast((e as Error).message))}>Template</button>
      {x.can.edit && <button className="btn" onClick={() => setUpload(true)}><Icon name="upload" size={15} /> Upload customs file</button>}
      {x.can.edit && <button className="btn" onClick={() => setEdit('new')}>+ Import line</button>}
      <button className="btn p" onClick={() => download(`/api/cbam/declaration?year=${year}`, `CBAM declaration ${year}.xlsx`).catch((e) => toast((e as Error).message))}><Icon name="download" size={15} /> Declaration workbook</button>
    </div>
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Net mass imported</span><b>{f0(sum((l) => l.mass))} <small className="muted">t</small></b><span className="muted small">{L.length} lines · {new Set(L.map((l) => `${l.cn}${l.origin}`)).size} CN × origin</span></div>
      <div className="card kpi"><span className="muted small">Embedded emissions</span><b>{f0(sum((l) => l.calc.embedded))} <small className="muted">tCO₂e</small></b><span className="muted small">{f0(L.filter((l) => l.source === 'default').reduce((a, l) => a + l.mass, 0))} t on default values</span></div>
      <div className="card kpi"><span className="muted small">Certificates to surrender</span><b>{f0(sum((l) => l.calc.certificates))}</b><span className="muted small">after free allocation adjustment {f0(sum((l) => l.calc.faa))} t</span></div>
      <div className="card kpi"><span className="muted small">Estimated cost</span><b>EUR {f0(sum((l) => l.calc.cost))}</b><span className="muted small">{L.filter((l) => l.calc.problems.length).length} lines need attention</span></div>
    </div>
    <div className="card">
      <div className="scroll"><table className="t">
        <thead><tr><th>Imported</th><th>CN code · good</th><th>Origin · installation</th><th className="num">Net mass (t)</th><th className="ctr">Emissions</th><th className="num">SEE used</th><th className="num">SEFA</th><th className="num">Certificates</th><th className="num">Cost (EUR)</th>{x.can.edit && <th />}</tr></thead>
        <tbody>{L.map((l) => <tr key={l.id}>
          <td style={{ whiteSpace: 'nowrap' }}>{l.import_date ? d8(l.import_date) : `Q${l.quarter}`}<div className="muted small">Q{l.quarter}{l.procedure ? ` · proc. ${l.procedure}` : ''}</div></td>
          <td><span className="mono">{cnFmt(l.cn)}</span> <span className="muted small">{l.categoryName}</span><div className="small">{l.description}</div></td>
          <td>{countryLabel(l.origin)}<div className="muted small">{[l.installation ?? l.supplier, l.installation_id_reg].filter(Boolean).join(' · ')}</div></td>
          <td className="num">{f(l.mass, 1)}</td>
          <td className="ctr"><span className={`chip ${l.source === 'default' ? 'warn' : ''}`}>{l.source}</span>{l.source === 'default' && l.calc.markup ? <div className="muted small">+{Math.round(l.calc.markup * 100)}% mark-up</div> : null}</td>
          <td className="num">{f(l.calc.see, 4)}{l.source === 'default' && l.defaultFromLibrary && <div className="muted small">library</div>}</td>
          <td className="num">{f(l.calc.sefa, 4)}{l.benchmarkUsed != null && <div className="muted small">bm {f(l.benchmarkUsed, 3)}</div>}</td>
          <td className="num"><b>{f(l.calc.certificates, 1)}</b></td>
          <td className="num">{f0(l.calc.cost)}{l.calc.problems.length > 0 && <div className="small bad" title={l.calc.problems.join('\n')}>! {l.calc.problems[0]}</div>}</td>
          {x.can.edit && <td className="num" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" aria-label="Edit" onClick={() => setEdit(l)}><Icon name="edit" size={15} /></button>
            <button className="btn sm ghost" aria-label="Remove" onClick={() => api.cbamImportDelete(l.id).then(() => { toast('Removed'); reload(); }).catch((e) => toast((e as Error).message))}><Icon name="x" size={15} /></button></td>}
        </tr>)}
        {!L.length && <tr><td colSpan={10} className="muted small">No import of CBAM goods recorded for {year}.</td></tr>}</tbody></table></div>
    </div>
    {edit && <ImportDrawer year={year} d={d} own={x.ownReports} l={edit === 'new' ? null : edit} onClose={() => setEdit(null)} done={() => { setEdit(null); reload(); }} />}
    {upload && <UploadDrawer year={year} onClose={() => setUpload(false)} done={() => { setUpload(false); reload(); }} />}
  </>;
}

function ImportDrawer({ year, d, own, l, onClose, done }: { year: number; d: CbamData; own: { id: string; year: number; status: string; installation: string }[]; l: CbamImport | null; onClose: () => void; done: () => void }) {
  const { toast } = useApp();
  const s = (x: unknown) => (x == null ? '' : String(x));
  const [v, setV] = useState(() => ({ importDate: l?.import_date?.slice(0, 10) ?? '', cn: s(l?.cn), description: s(l?.description), origin: l?.origin ?? '', mass: s(l?.mass), procedure: s(l?.procedure), customsRef: s(l?.customs_ref),
    supplier: s(l?.supplier), installation: s(l?.installation), installationIdReg: s(l?.installation_id_reg), route: s(l?.route), reportId: s(l?.report_id), source: l?.source ?? 'default',
    seeDirect: s(l?.see_direct), seeIndirect: s(l?.see_indirect), defaultValue: s(l?.default_value), benchmark: s(l?.benchmark), carbonPriceEur: s(l?.carbon_price_eur), verifierRef: s(l?.verifier_ref), notes: s(l?.notes) }));
  const up = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const t = (k: keyof typeof v, lb: string, p = '', cls = 'field', type = 'text') => <label className={cls}><span>{lb}</span><input className="input" type={type} value={v[k]} placeholder={p} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  const info = useMemo(() => { const c = v.cn.replace(/\D/g, ''); let b: [string, string, string] | null = null; for (const e of d.cn) if (c.startsWith(e[0]) && (!b || e[0].length > b[0].length)) b = e; return c.length >= 4 ? b : null; }, [v.cn, d.cn]);
  const o = (x: string) => (x.trim() === '' ? null : x.trim());
  const save = async () => {
    try {
      await api.cbamImportSave({ year, importDate: o(v.importDate), cn: v.cn, description: v.description.trim(), origin: v.origin, mass: Number(v.mass), procedure: o(v.procedure), customsRef: o(v.customsRef), supplier: o(v.supplier),
        installation: o(v.installation), installationIdReg: o(v.installationIdReg), route: o(v.route), reportId: o(v.reportId), source: v.source, seeDirect: numOrNull(v.seeDirect), seeIndirect: numOrNull(v.seeIndirect),
        defaultValue: numOrNull(v.defaultValue), benchmark: numOrNull(v.benchmark), carbonPriceEur: numOrNull(v.carbonPriceEur), verifierRef: o(v.verifierRef), notes: v.notes.trim() }, l?.id);
      toast(l ? 'Saved' : 'Import line added'); done();
    } catch (e) { toast((e as Error).message); }
  };
  return <Drawer eyebrow={`CBAM · imports ${year}`} title={l ? 'Edit import line' : 'Add an import line'} onClose={onClose}
    foot={<button className="btn p" disabled={!v.importDate || !v.cn || !v.origin || !(Number(v.mass) > 0)} onClick={() => void save()}>Save</button>}>
    <div className="vform">
      {t('importDate', 'Import date (release for free circulation)', '', 'field', 'date')}
      <label className="field"><span>CN code</span><input className="input mono" list="cbam-cn" value={v.cn} placeholder="e.g. 7207 11 14" onChange={(e) => up({ cn: e.target.value })} />
        <datalist id="cbam-cn">{d.cn.map(([c, , n]) => <option key={c} value={c}>{n}</option>)}</datalist></label>
      <div className="field span2 small">{v.cn.replace(/\D/g, '').length >= 4 ? (info ? <span className="ok">✓ CBAM good — {d.categories[info[1]]?.name}: {info[2]}</span> : <span className="bad">Not a CBAM good (Annex I)</span>) : <span className="muted">Annex I goods: cement, fertilisers, iron and steel, aluminium, hydrogen, electricity</span>}</div>
      {t('description', 'Description', '', 'field span2')}
      <label className="field"><span>Country of origin</span><CountrySelect value={v.origin} onChange={(c) => up({ origin: c })} /></label>
      {t('mass', 'Net mass (t; MWh for electricity)')}
      {t('procedure', 'Customs procedure', 'e.g. 40')}{t('customsRef', 'Customs declaration number')}
      {t('supplier', 'Supplier / exporter')}{t('installation', 'Installation')}{t('installationIdReg', 'Installation CBAM Registry ID')}{t('route', 'Production route')}
      <div className="field span2"><span>Embedded emissions</span><div className="seg">
        <button className={v.source === 'actual' ? 'on' : ''} onClick={() => up({ source: 'actual' })}>Actual (installation's verified data)</button>
        <button className={v.source === 'default' ? 'on' : ''} onClick={() => up({ source: 'default' })}>Default value</button></div></div>
      {v.source === 'actual' && <>
        {own.length > 0 && <label className="field span2"><span>From one of your own installations (fills the values)</span><select className="input" value={v.reportId} onChange={(e) => up({ reportId: e.target.value })}><option value="">— supplier's data, typed below —</option>{own.map((r) => <option key={r.id} value={r.id}>{r.installation} · {r.year} · {r.status}</option>)}</select></label>}
        {!v.reportId && <>{t('seeDirect', 'Direct SEE (tCO₂e/t)')}{t('seeIndirect', 'Indirect SEE (tCO₂e/t) — cement and fertilisers')}{t('verifierRef', 'Verification report (verifier, date)', '', 'field span2')}</>}
      </>}
      {v.source === 'default' && t('defaultValue', 'Default value (tCO₂e/t) — empty: from the library', 'official value for the CN code and country', 'field span2')}
      {t('benchmark', 'CBAM benchmark (tCO₂e/t) — empty: from the library')}{t('carbonPriceEur', 'Carbon price paid in the origin country (EUR per t of good)')}
      {t('notes', 'Notes', '', 'field span2')}
    </div>
  </Drawer>;
}

function UploadDrawer({ year, onClose, done }: { year: number; onClose: () => void; done: () => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<Awaited<ReturnType<typeof api.cbamImportUpload>> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (commit: boolean) => {
    if (!file) return;
    setBusy(true);
    try { const r = await api.cbamImportUpload(file, year, commit); if (commit) { toast(`${r.imported} lines imported${r.skipped ? `, ${r.skipped} skipped` : ''}`); done(); } else setPrev(r); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <Drawer eyebrow={`CBAM · imports ${year}`} title="Upload the customs broker's file" onClose={onClose}
    foot={<><button className="btn" disabled={!file || busy} onClick={() => void run(false)}>Check</button><button className="btn p" disabled={!prev?.ok || busy} onClick={() => void run(true)}>Import {prev?.ok ?? ''} lines</button></>}>
    <div className="note info small">Excel or CSV, one row per customs declaration line. Needed: CN code, country of origin, net mass (and the import date). Optional: supplier, installation and its Registry ID, route, "actual" with the SEE, carbon price paid. Download the template for the column names.</div>
    <label className="field"><span>File</span><input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPrev(null); }} /></label>
    {prev?.lines && <div className="scroll"><table className="t"><thead><tr><th>Row</th><th>CN</th><th>Origin</th><th className="num">Mass</th><th>Check</th></tr></thead>
      <tbody>{prev.lines.map((x) => <tr key={x.row}><td>{x.row}</td><td className="mono">{x.cn}</td><td>{x.origin}</td><td className="num">{f(x.mass, 1)}</td><td>{x.ok ? <span className="chip">ok</span> : <span className="chip bad">skipped</span>} <span className="small muted">{x.problems.join('; ')}</span></td></tr>)}</tbody></table></div>}
  </Drawer>;
}

// --------------------------------------------------------------- references --
function References({ d, act }: { d: CbamData; act: Act }) {
  const [v, setV] = useState({ kind: 'default', cn: '', country: '', year: String(d.year), quarter: '', value: '', source: '' });
  const can = d.can.edit;
  const rows = d.references;
  return <>
    <div className="note warn small">Use the official values: default values from the Annex of Implementing Regulation (EU) 2025/2621 (per CN code and country of origin) and CBAM benchmarks from Implementing Regulation (EU) 2025/2620. Values marked <b>illustrative</b> are for the demo only. When a line has its own value, that one is used; otherwise the most specific value here (longest CN code, same country first).</div>
    {can && <div className="card"><h3 style={{ marginTop: 0 }}>Add a value for your company</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field"><span>Kind</span><select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="default">Default value (tCO₂e/t)</option><option value="benchmark">CBAM benchmark (tCO₂e/t)</option><option value="price">Certificate price (EUR)</option></select></label>
        {v.kind !== 'price' && <label className="field"><span>CN code (4–8 digits)</span><input className="input mono" style={{ width: 130 }} value={v.cn} onChange={(e) => setV({ ...v, cn: e.target.value })} /></label>}
        {v.kind === 'default' && <label className="field" style={{ minWidth: 200 }}><span>Country of origin</span><CountrySelect value={v.country} empty="All countries" onChange={(c) => setV({ ...v, country: c })} /></label>}
        <label className="field"><span>Year</span><input className="input num" style={{ width: 80 }} value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} /></label>
        {v.kind === 'price' && <label className="field"><span>Quarter</span><select className="input" value={v.quarter} onChange={(e) => setV({ ...v, quarter: e.target.value })}><option value="">—</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select></label>}
        <label className="field"><span>Value</span><input className="input num" style={{ width: 100 }} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></label>
        <label className="field grow"><span>Source</span><input className="input" value={v.source} placeholder="e.g. IR (EU) 2025/2621 Annex, row …" onChange={(e) => setV({ ...v, source: e.target.value })} /></label>
        <button className="btn p" disabled={!v.value || v.source.trim().length < 2} onClick={() => void act(async () => { await api.cbamReferenceAdd({ kind: v.kind, cn: v.cn.trim() || null, country: v.country || null, year: Number(v.year), quarter: v.quarter ? Number(v.quarter) : null, value: Number(v.value), source: v.source.trim() }); setV({ ...v, cn: '', value: '' }); }, 'Added')}>Add</button>
      </div></div>}
    <div className="card"><div className="scroll"><table className="t">
      <thead><tr><th>Kind</th><th>CN code</th><th>Country</th><th>Year</th><th className="num">Value</th><th>Source</th>{can && <th />}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td>{r.kind === 'default' ? 'Default value' : r.kind === 'benchmark' ? 'CBAM benchmark' : 'Certificate price'}</td><td className="mono">{r.cn ? cnFmt(r.cn) : '—'}</td><td>{r.country ? countryLabel(r.country) : r.kind === 'price' ? '—' : 'All'}</td>
        <td>{r.year}{r.quarter ? ` Q${r.quarter}` : ''}</td><td className="num">{r.kind === 'price' ? `EUR ${r.value.toFixed(2)}` : f(r.value, 4)}</td>
        <td className="small">{r.indicative && <span className="chip warn" style={{ marginRight: 4 }}>illustrative</span>}{r.source}</td>
        {can && <td className="num">{r.own && <button className="btn sm ghost" aria-label="Remove" onClick={() => void act(() => api.cbamReferenceDelete(r.id), 'Removed')}><Icon name="x" size={15} /></button>}</td>}</tr>)}</tbody></table></div></div>
  </>;
}
