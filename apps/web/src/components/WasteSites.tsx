/**
 * Landfill site register of a facility.
 *
 * A landfill's methane in a year comes from the waste placed in all earlier years
 * (IPCC first order decay), so each site keeps:
 *   - its parameters: climate, site type (MCF), soil cover (oxidation), and, if known,
 *     the composition of its mixed waste and site values replacing IPCC defaults;
 *   - its tonnage history: tonnes per year and waste type — typed, pasted from Excel,
 *     or filled for a range of years when only an average is known (marked estimated).
 * After the history changes, the site's entries can be recalculated.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, num, type WasteDefaults, type WasteDeposit, type WasteSite, type WasteSiteParams } from '../lib/api';
import { useApp } from '../App';
import { Icon } from './Icon';

const thisYear = new Date().getFullYear();
/** Waste types that decay in a landfill (DOC > 0), plus mixed municipal waste. */
const landfillTypes = (d: WasteDefaults) => [{ code: 'msw', name: 'Mixed municipal waste (split by composition)' }, ...d.types.filter((t) => t.doc > 0)];

/** "Mixed MSW", "food", "Paper and cardboard" → type code. */
function matchType(s: string, d: WasteDefaults): string | null {
  const x = s.trim().toLowerCase();
  if (!x) return null;
  if (/^(msw|mixed|municipal|household|general|residual|commercial)/.test(x)) return 'msw';
  const t = d.types.find((w) => w.code === x || w.name.toLowerCase() === x) ?? d.types.find((w) => w.name.toLowerCase().startsWith(x) || x.startsWith(w.code.replace('_', ' ')));
  return t?.code ?? null;
}

export function WasteSites({ facilityId, canEdit, onChange }: { facilityId: string; canEdit: boolean; onChange?: (sites: WasteSite[]) => void }) {
  const [d, setD] = useState<WasteDefaults | null>(null);
  const [sites, setSites] = useState<WasteSite[]>([]);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const load = () => api.wasteSites(facilityId).then((r) => { setSites(r.sites); onChange?.(r.sites); });
  useEffect(() => { api.wasteDefaults().then(setD); }, []);
  useEffect(() => { if (facilityId) { setOpen(null); load(); } }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px 8px' }}>
          <div className="grow"><h2>Landfill sites</h2>
            <p className="sub">Each landfill keeps its tonnage history: this year's methane comes from the waste placed in earlier years (IPCC first order decay).</p></div>
          {canEdit && <button className="btn sm" onClick={() => setOpen('new')}><Icon name="plus" />Add landfill</button>}
        </div>
        {sites.length ? (
          <table className="t">
            <thead><tr><th>Site</th><th>Type</th><th>Climate</th><th>Tonnage history</th><th className="num">Entries</th></tr></thead>
            <tbody>{sites.map((s) => (
              <tr key={s.id} className="click" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <td><b>{s.name}</b>{!s.active && <span className="chip grey" style={{ marginLeft: 6 }}>inactive</span>}
                  <div className="muted small">{s.opened_year ? `opened ${s.opened_year}` : ''}{s.closed_year ? ` · closed ${s.closed_year}` : ''}</div></td>
                <td>{s.params.siteType ? d.landfillMcf[s.params.siteType]?.name : 'not set'}<div className="muted small">MCF {s.params.mcf ?? (s.params.siteType ? d.landfillMcf[s.params.siteType]?.mcf : '—')} · oxidation {Math.round((s.params.ox ?? 0) * 100)}%</div></td>
                <td>{d.climates[s.params.climate ?? 'tropical_dry']?.split(' (')[0]}</td>
                <td>{s.history?.rows ? <>{s.history.first}–{s.history.last} · {num(Number(s.history.tonnes))} t</> : <span className="chip warn">no history yet</span>}</td>
                <td className="num">{s.entries}</td>
              </tr>))}</tbody>
          </table>
        ) : <div className="empty">No landfill sites for this facility.{canEdit ? ' Add one to calculate landfill methane.' : ''}</div>}
      </div>
      {open === 'new' && <SiteForm d={d} facilityId={facilityId} onDone={(id) => { load(); setOpen(id ?? null); }} />}
      {open && open !== 'new' && <SiteDetail key={open} d={d} id={open} canEdit={canEdit} onChanged={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SiteForm({ d, facilityId, site, onDone }: { d: WasteDefaults; facilityId: string; site?: WasteSite; onDone: (id?: string) => void }) {
  const p0 = site?.params ?? {};
  const [name, setName] = useState(site?.name ?? '');
  const [opened, setOpened] = useState(site?.opened_year ? String(site.opened_year) : '');
  const [closed, setClosed] = useState(site?.closed_year ? String(site.closed_year) : '');
  const [p, setP] = useState<WasteSiteParams>({ climate: 'tropical_dry', siteType: 'managed_anaerobic', ox: 0.1, ...p0 });
  const [adv, setAdv] = useState(!!(p0.composition || p0.overrides || p0.mcf !== undefined || p0.f !== undefined || p0.delayMonths !== undefined));
  const [comp, setComp] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(p0.composition ?? d.msw.composition).map(([k, v]) => [k, String(Number((v * 100).toFixed(2)))])));
  const [ov, setOv] = useState<Record<string, { doc?: string; docf?: string; k?: string }>>(() =>
    Object.fromEntries(Object.entries(p0.overrides ?? {}).map(([k, v]) => [k, { doc: v.doc != null ? String(v.doc) : '', docf: v.docf != null ? String(v.docf) : '', k: v.k != null ? String(v.k) : '' }])));
  const [err, setErr] = useState<string | null>(null);
  const compSum = Object.values(comp).reduce((s, x) => s + (Number(x) || 0), 0);
  const climate = p.climate ?? 'tropical_dry';

  const save = async () => {
    setErr(null);
    const composition = adv && JSON.stringify(Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, Number(v) / 100]))) !== JSON.stringify(d.msw.composition)
      ? Object.fromEntries(Object.entries(comp).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v) / 100])) : undefined;
    const overrides = Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined).map(([f, x]) => [f, Number(x)]))])
      .filter(([, v]) => Object.keys(v as object).length));
    const params: WasteSiteParams = { climate: p.climate, siteType: p.siteType, ox: p.ox, ...(adv && p.mcf !== undefined ? { mcf: p.mcf } : {}), ...(adv && p.f !== undefined ? { f: p.f } : {}),
      ...(adv && p.delayMonths !== undefined ? { delayMonths: p.delayMonths } : {}), ...(composition ? { composition } : {}), ...(adv && Object.keys(overrides).length ? { overrides } : {}), ...(p.source ? { source: p.source } : {}) };
    const body = { name: name.trim(), openedYear: opened ? Number(opened) : null, closedYear: closed ? Number(closed) : null, params };
    try {
      const r = site ? await api.updateWasteSite(site.id, body) : await api.addWasteSite({ ...body, facilityId });
      onDone(r.id);
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <h2>{site ? `Edit ${site.name}` : 'Add a landfill'}</h2>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field grow"><span>Name</span><input className="input" value={name} maxLength={120} placeholder="e.g. Al Saja'a landfill, cell 3" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field" style={{ width: 110 }}><span>Opened (year)</span><input className="input mono" maxLength={4} value={opened} onChange={(e) => setOpened(e.target.value.replace(/\D/g, ''))} /></label>
        <label className="field" style={{ width: 110 }}><span>Closed (year)</span><input className="input mono" maxLength={4} value={closed} placeholder="open" onChange={(e) => setClosed(e.target.value.replace(/\D/g, ''))} /></label>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 330 }}><span>Site type (IPCC 2019 Table 3.1)</span>
          <select className="input" value={p.siteType} onChange={(e) => setP({ ...p, siteType: e.target.value })}>
            {Object.entries(d.landfillMcf).map(([k, v]) => <option key={k} value={k}>{v.name} · MCF {v.mcf}</option>)}</select></label>
        <label className="field" style={{ width: 330 }}><span>Climate (sets the decay rates k)</span>
          <select className="input" value={climate} onChange={(e) => setP({ ...p, climate: e.target.value })}>
            {Object.entries(d.climates).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}>
          <input type="checkbox" checked={(p.ox ?? 0) > 0} onChange={(e) => setP({ ...p, ox: e.target.checked ? 0.1 : 0 })} />
          Covered with soil or compost (10% of methane oxidised)</label>
      </div>
      <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={adv} onChange={(e) => setAdv(e.target.checked)} />Site-specific values (replace IPCC defaults)</label>
      {adv && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ width: 130 }}><span>MCF (typed)</span><input className="input num" placeholder={String(d.landfillMcf[p.siteType ?? '']?.mcf ?? '')} value={p.mcf ?? ''} onChange={(e) => setP({ ...p, mcf: e.target.value === '' ? undefined : Number(e.target.value.replace(/[^0-9.]/g, '')) })} /></label>
            <label className="field" style={{ width: 170 }}><span>Methane share of gas (F)</span><input className="input num" placeholder="0.5" value={p.f ?? ''} onChange={(e) => setP({ ...p, f: e.target.value === '' ? undefined : Number(e.target.value.replace(/[^0-9.]/g, '')) })} /></label>
            <label className="field" style={{ width: 170 }}><span>Delay before decay (months)</span><input className="input num" placeholder="6" value={p.delayMonths ?? ''} onChange={(e) => setP({ ...p, delayMonths: e.target.value === '' ? undefined : Math.min(6, Number(e.target.value.replace(/[^0-9.]/g, ''))) })} /></label>
            <label className="field grow"><span>Source of the site values</span><input className="input" maxLength={300} value={p.source ?? ''} placeholder="e.g. waste characterisation survey 2024" onChange={(e) => setP({ ...p, source: e.target.value })} /></label>
          </div>
          <fieldset className="box"><legend>Composition of mixed municipal waste (% of wet weight)</legend>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {d.types.filter((t) => t.group === 'msw').map((t) => (
                <label key={t.code} className="field" style={{ width: 120 }}><span>{t.name.replace(' and cardboard', '/card')}</span>
                  <input className="input num" value={comp[t.code] ?? ''} placeholder="0" onChange={(e) => setComp({ ...comp, [t.code]: e.target.value.replace(/[^0-9.]/g, '') })} /></label>))}
            </div>
            <div className={`sub ${compSum > 100.01 ? 'bad' : ''}`}>Total {num(compSum, 4)}%{compSum < 99.99 ? ` — the remaining ${num(100 - compSum, 4)}% is treated as inert` : ''}. Default: {d.msw.source}.{' '}
              <button className="btn ghost sm" onClick={() => setComp(Object.fromEntries(Object.entries(d.msw.composition).map(([k, v]) => [k, String(Number((v * 100).toFixed(2)))])))}>Reset to default</button></div>
          </fieldset>
          <fieldset className="box"><legend>Decay values by waste type (leave blank for IPCC defaults)</legend>
            <table className="t"><thead><tr><th>Waste type</th><th className="num">DOC (wet)</th><th className="num">DOCf</th><th className="num">k per year</th></tr></thead>
              <tbody>{d.types.filter((t) => t.doc > 0).map((t) => (
                <tr key={t.code}><td>{t.name}</td>
                  {(['doc', 'docf', 'k'] as const).map((f) => (
                    <td key={f} className="num"><input className="input num" style={{ width: 90, height: 30 }} value={ov[t.code]?.[f] ?? ''}
                      placeholder={String(f === 'k' ? d.k[t.decay]?.[climate] : t[f])}
                      onChange={(e) => setOv({ ...ov, [t.code]: { ...ov[t.code], [f]: e.target.value.replace(/[^0-9.]/g, '') } })} /></td>))}
                </tr>))}</tbody></table>
            <div className="sub">Defaults: DOC IPCC 2006 Table 2.4; DOCf 2019 Refinement Table 3.0; k IPCC 2006 Table 3.3 for the climate chosen.</div>
          </fieldset>
        </div>
      )}
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={() => onDone(site?.id)}>Cancel</button>
        <button className="btn p" disabled={name.trim().length < 1 || compSum > 100.01} onClick={save}>{site ? 'Save site' : 'Add landfill'}</button>
      </div>
    </div>
  );
}

function SiteDetail({ d, id, canEdit, onChanged, onClose }: { d: WasteDefaults; id: string; canEdit: boolean; onChanged: () => void; onClose: () => void }) {
  const { toast } = useApp();
  const [s, setS] = useState<Awaited<ReturnType<typeof api.wasteSite>> | null>(null);
  const [edit, setEdit] = useState(false);
  const [paste, setPaste] = useState('');
  const [fill, setFill] = useState({ from: '', to: String(thisYear - 1), type: 'msw', tonnes: '' });
  const [pending, setPending] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.wasteSite(id).then(setS);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const types = landfillTypes(d);
  const nameOf = (c: string) => types.find((t) => t.code === c)?.name ?? d.types.find((t) => t.code === c)?.name ?? c;

  // History as a year × type table.
  const pivot = useMemo(() => {
    const deps = s?.deposits ?? [];
    const cols = [...new Set(deps.map((x) => x.type))];
    const years = [...new Set(deps.map((x) => x.year))].sort((a, b) => b - a);
    const at = (y: number, t: string) => deps.find((x) => x.year === y && x.type === t);
    return { cols, years, at };
  }, [s]);

  // Pasted rows: "year <tab> type <tab> tonnes" or a header row "Year | Mixed MSW | Food …" with one column per type.
  const parsed = useMemo(() => {
    const lines = paste.split(/\r?\n/).map((l) => l.split(/\t|;|,(?=\s*\d)|\s{2,}/).map((c) => c.trim())).filter((c) => c.some(Boolean));
    if (!lines.length) return { rows: [] as { year: number; type: string; tonnes: number }[], bad: [] as string[] };
    const rows: { year: number; type: string; tonnes: number }[] = [];
    const bad: string[] = [];
    const head = lines[0]!;
    const wide = /year/i.test(head[0] ?? '') && head.length > 2;
    const tonnes = (x: string) => Number(x.replace(/[, ]/g, ''));
    if (wide) {
      const colTypes = head.slice(1).map((h) => matchType(h, d));
      head.slice(1).forEach((h, i) => { if (!colTypes[i]) bad.push(`Column "${h}" is not a waste type`); });
      for (const l of lines.slice(1)) {
        const y = Number(l[0]);
        if (!(y >= 1900 && y <= 2100)) { bad.push(`"${l.join(' ')}": no year`); continue; }
        l.slice(1).forEach((v, i) => { const t = colTypes[i]; if (t && v !== '' && Number.isFinite(tonnes(v))) rows.push({ year: y, type: t, tonnes: tonnes(v) }); });
      }
    } else {
      for (const l of lines) {
        if (/year/i.test(l[0] ?? '')) continue;
        const y = Number(l[0]); const t = l.length >= 3 ? matchType(l[1]!, d) : 'msw'; const q = tonnes(l[l.length - 1]!);
        if (!(y >= 1900 && y <= 2100) || !t || !Number.isFinite(q)) { bad.push(`"${l.join(' ')}"`); continue; }
        rows.push({ year: y, type: t, tonnes: q });
      }
    }
    return { rows, bad };
  }, [paste, d]);

  const saveRows = async (rows: { year: number; type: string; tonnes: number; estimated?: boolean; source?: string }[], msg: string) => {
    setErr(null);
    try {
      const r = await api.saveDeposits(id, { rows });
      toast(`${msg}: ${r.saved} saved${r.removed ? `, ${r.removed} removed` : ''}`);
      setPending(r.entries.length ? r.entries : null);
      setPaste(''); load(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const doFill = () => {
    const a = Number(fill.from), b = Number(fill.to), t = Number(fill.tonnes);
    if (!(a >= 1900 && b >= a && b <= 2100 && t >= 0)) { setErr('Enter the first and last year and the tonnes per year'); return; }
    saveRows(Array.from({ length: b - a + 1 }, (_, i) => ({ year: a + i, type: fill.type, tonnes: t, estimated: true, source: 'average tonnes per year' })), `${b - a + 1} years filled`);
  };

  if (!s) return <div className="card empty">Loading…</div>;
  if (edit) return <SiteForm d={d} facilityId={s.facility_id} site={s} onDone={() => { setEdit(false); load(); onChanged(); }} />;
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <div className="grow"><div className="eyebrow">Landfill</div><h2>{s.name}</h2>
          <div className="sub">{s.params.siteType ? d.landfillMcf[s.params.siteType]?.name : 'site type not set'} · MCF {s.params.mcf ?? d.landfillMcf[s.params.siteType ?? '']?.mcf ?? '—'} · {d.climates[s.params.climate ?? 'tropical_dry']}
            {' '}· oxidation {Math.round((s.params.ox ?? 0) * 100)}%{s.params.composition ? ' · own composition' : ''}{s.params.overrides ? ' · own decay values' : ''}{s.params.source ? ` · source: ${s.params.source}` : ''}</div></div>
        {canEdit && <button className="btn sm" onClick={() => setEdit(true)}>Edit site</button>}
        {canEdit && !s.entries && <button className="btn sm danger" onClick={async () => { try { await api.deleteWasteSite(id); onChanged(); onClose(); } catch (e) { setErr((e as Error).message); } }}>Delete</button>}
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>

      {pending && (
        <div className="note info row" style={{ gap: 8 }}>
          <span className="grow">The history changed: {pending.length} saved entr{pending.length === 1 ? 'y uses' : 'ies use'} this site.</span>
          <button className="btn sm p" onClick={async () => { const r = await api.recalculate({ ids: pending, onlyWithWarnings: false }); toast(`${r.changed} of ${r.checked} entries updated`); setPending(null); }}>Recalculate them</button>
        </div>
      )}

      <h3 style={{ margin: 0 }}>Tonnage history</h3>
      {pivot.years.length ? (
        <div className="scroll" style={{ maxHeight: 320, border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="t">
            <thead><tr><th>Year</th>{pivot.cols.map((c) => <th key={c} className="num">{nameOf(c).replace(' (split by composition)', '')}</th>)}</tr></thead>
            <tbody>{pivot.years.map((y) => (
              <tr key={y}><td className="mono">{y}</td>{pivot.cols.map((c) => { const x: WasteDeposit | undefined = pivot.at(y, c); return (
                <td key={c} className="num">{x ? <>{num(Number(x.tonnes))}{x.estimated && <span className="chip grey" style={{ marginLeft: 4 }} title={x.source ?? ''}>est.</span>}</> : ''}</td>); })}</tr>))}</tbody>
          </table>
        </div>
      ) : <div className="note warn">No tonnage history yet. Paste it from Excel below, or fill a range of years with an average.</div>}

      {canEdit && <>
        <fieldset className="box"><legend>Paste from Excel</legend>
          <textarea className="input" rows={5} style={{ width: '100%', fontFamily: 'var(--mono, monospace)', height: 'auto' }} value={paste}
            placeholder={'Year\tMixed MSW\tFood\tGarden\n2019\t410000\t\t\n2020\t425000\t12000\t3000\n\nor one row per year and type:  2020  Mixed MSW  425000'}
            onChange={(e) => setPaste(e.target.value)} />
          {paste && <div className="sub">{parsed.rows.length} values read{parsed.bad.length ? <span className="bad"> · not read: {parsed.bad.slice(0, 4).join('; ')}</span> : ''}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm p" disabled={!parsed.rows.length} onClick={() => saveRows(parsed.rows, 'History saved')}>Save {parsed.rows.length || ''} values</button></div>
        </fieldset>
        <fieldset className="box"><legend>Fill a range of years (estimated)</legend>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 90 }}><span>From</span><input className="input mono" maxLength={4} value={fill.from} placeholder={String(s.opened_year ?? '')} onChange={(e) => setFill({ ...fill, from: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field" style={{ width: 90 }}><span>To</span><input className="input mono" maxLength={4} value={fill.to} onChange={(e) => setFill({ ...fill, to: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field" style={{ width: 280 }}><span>Waste type</span><select className="input" value={fill.type} onChange={(e) => setFill({ ...fill, type: e.target.value })}>{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
            <label className="field" style={{ width: 150 }}><span>Tonnes per year</span><input className="input num" value={fill.tonnes} onChange={(e) => setFill({ ...fill, tonnes: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
            <button className="btn sm" onClick={doFill}>Fill</button>
          </div>
          <div className="sub">For years without records (e.g. before weighbridges): IPCC guidance is to use about 50 years of history, or since the site opened. Filled values are marked estimated. A value of 0 removes that year and type.</div>
        </fieldset>
      </>}
      {err && <div className="note bad">{err}</div>}
    </div>
  );
}
