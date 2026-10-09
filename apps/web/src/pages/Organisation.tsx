/**
 * Organisation & groups — the colour-coded hierarchy list from the prototype:
 * main entity → sub-groups → facilities. Click a row to open its profile.
 * Super admin edits everything; an Admin edits inside their own sub-group.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type Facility, type GridRegion, type OrgNode, type Person } from '../lib/api';
import { Icon } from '../components/Icon';
import { Fleet } from '../components/Fleet';
import { WasteSites } from '../components/WasteSites';
import { FacilityEnergy } from '../components/FacilityEnergy';
import { MeterRegister } from './Meters';

const TYPES = ['Office', 'Plant', 'Warehouse', 'Fleet depot', 'Data centre', 'Residential', 'Retail', 'Landfill', 'Laboratory', 'Other'];

const KIND_LABEL: Record<OrgNode['kind'], string> = { group: 'Main entity', subgroup: 'Sub-group', facility: 'Facility' };
const VIEW_KEY = 'eko.orgView';
const readView = (): 'list' | 'chart' => { try { return localStorage.getItem(VIEW_KEY) === 'chart' ? 'chart' : 'list'; } catch { return 'list'; } };

export function Organisation() {
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setViewState] = useState<'list' | 'chart'>(readView);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<{ node: OrgNode; tab?: string } | null>(null);
  const [adding, setAdding] = useState<{ parent: OrgNode; kind: 'subgroup' | 'facility' } | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const setView = (v: 'list' | 'chart') => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };

  const load = async () => { const n = (await api.org()).nodes; setNodes(n); return n; };
  const openNode = (node: OrgNode, tab?: string) => { setSel({ node, tab }); window.setTimeout(() => dlg.current?.showModal(), 0); };
  useEffect(() => {
    load().then((n) => { // /organisation?open=<facility id>&tab=meters opens that facility directly
      const id = params.get('open'); const hit = id ? n.find((x) => x.id === id) : undefined;
      if (hit) { openNode(hit, params.get('tab') ?? undefined); setParams({}, { replace: true }); }
    });
    api.users().then((u) => setPeople(u.users)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const children = (id: string | null) => nodes.filter((n) => n.parent_id === id && (showArchived || n.active)).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'subgroup' ? -1 : 1));
  const facilitiesUnder = (id: string): OrgNode[] => children(id).flatMap((k) => (k.kind === 'facility' ? [k] : facilitiesUnder(k.id)));
  const filtering = !!q || !!type;
  const matches = (n: OrgNode): boolean => {
    const self = (!q || `${n.name} ${n.location ?? ''} ${n.facility_type ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!type || n.facility_type === type);
    return n.kind === 'facility' ? self : !filtering ? true : children(n.id).some(matches);
  };
  const isOpen = (n: OrgNode) => filtering || !closed.has(n.id);
  const toggle = (n: OrgNode) => { const s = new Set(closed); s.has(n.id) ? s.delete(n.id) : s.add(n.id); setClosed(s); };
  const counts = useMemo(() => ({ sub: nodes.filter((n) => n.kind === 'subgroup' && n.active).length, fac: nodes.filter((n) => n.kind === 'facility' && n.active).length }), [nodes]);
  const managers = people.filter((p) => ['manager', 'admin', 'super_admin'].includes(p.role) && !p.disabled);
  const summary = (n: OrgNode) => {
    if (n.kind === 'facility') return n.facility_type ?? '';
    const subs = nodes.filter((x) => x.kind === 'subgroup' && x.active && x.parent_id === n.id).length, f = facilitiesUnder(n.id).length;
    return [n.kind === 'group' && subs ? `${subs} sub-group${subs === 1 ? '' : 's'}` : '', `${f} facilit${f === 1 ? 'y' : 'ies'}`].filter(Boolean).join(' · ');
  };
  const keyOpen = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

  // ---- list ----
  const row = (n: OrgNode, depth: number): ReactElement | null => {
    if (!matches(n)) return null;
    const kids = children(n.id), open = isOpen(n), fac = n.kind === 'facility';
    // A facility row opens the facility; a group row folds / unfolds (its details are behind "Details").
    const act = () => (fac ? openNode(n) : toggle(n));
    return (
      <Fragment key={n.id}>
        <tr className={`oh ${n.kind} ${n.active ? '' : 'off'}`} onClick={act} onKeyDown={keyOpen(act)} tabIndex={0}
          title={fac ? `Open ${n.name}: profile, meters, energy, fleet, landfill sites` : open ? 'Click to fold' : 'Click to unfold'}>
          <td>
            <div className="ohname" style={{ paddingLeft: depth * 22 }}>
              {!fac ? <button className="ohf" aria-label={open ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(n); }}><Icon name={open ? 'down' : 'chevron'} size={14} /></button> : <span className="ohf-sp" />}
              <span className="ohi"><Icon name={fac ? 'building' : 'grid'} size={15} /></span>
              <b>{n.name}</b>
              {!n.active && <span className="chip grey">archived</span>}
            </div>
          </td>
          <td><span className={`ohchip ${n.kind}`}>{KIND_LABEL[n.kind]}</span> <span className="sub">{summary(n)}</span></td>
          <td className="hide-sm">{fac ? [n.location, n.country].filter(Boolean).join(', ') || '—' : '—'}</td>
          <td className="hide-sm">{fac ? n.manager_name ?? <span className="muted">no manager</span> : '—'}</td>
          <td>{fac ? <>{n.ownership_pct !== 100 && <span className="chip info">{n.ownership_pct}%</span>} {n.entries ? <span className="chip">{n.entries} entries</span> : <span className="chip grey">no data</span>}</> : '—'}</td>
          <td className="ohact">{fac
            ? <span className="ohopen">Open <Icon name="chevron" size={13} /></span>
            : <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); openNode(n); }}>Details</button>}</td>
        </tr>
        {!fac && open && kids.map((k) => row(k, depth + 1))}
        {!fac && open && n.canEdit && !filtering && (
          <tr className="ohadd"><td colSpan={6}><div style={{ paddingLeft: depth * 22 + 30 }}>
            <button className="btn sm ghost" onClick={() => setAdding({ parent: n, kind: 'facility' })}><Icon name="plus" size={14} />Facility in {n.name}</button>
            <button className="btn sm ghost" onClick={() => setAdding({ parent: n, kind: 'subgroup' })}><Icon name="plus" size={14} />Sub-group</button>
          </div></td></tr>
        )}
      </Fragment>
    );
  };

  // ---- org chart ----
  const card = (n: OrgNode, kidsCount: number) => (
    <div className={`ocn ${n.kind} ${n.active ? '' : 'off'}`}>
      <button className="ocb" onClick={() => openNode(n)} title={n.kind === 'facility' ? `Open ${n.name}` : `Details of ${n.name}`}>
        <span className="och">{KIND_LABEL[n.kind]}</span>
        <b>{n.name}</b>
        <span className="ocs">{n.kind === 'facility' ? [n.facility_type, n.location].filter(Boolean).join(' · ') : summary(n)}</span>
      </button>
      {kidsCount > 0 && !filtering && <button className="octog" onClick={() => toggle(n)} aria-label={isOpen(n) ? 'Fold' : 'Unfold'}>{isOpen(n) ? '−' : `+${kidsCount}`}</button>}
    </div>
  );
  const branch = (n: OrgNode): ReactElement | null => {
    if (!matches(n)) return null;
    const kids = children(n.id).filter(matches);
    const groups = kids.filter((k) => k.kind !== 'facility'), facs = kids.filter((k) => k.kind === 'facility');
    return (
      <li key={n.id}>
        {card(n, kids.length)}
        {isOpen(n) && kids.length > 0 && (groups.length
          ? <ul>{groups.map(branch)}{facs.length > 0 && <li><div className="occol">{facs.map((f) => <Fragment key={f.id}>{card(f, 0)}</Fragment>)}</div></li>}</ul>
          : <div className="occol">{facs.map((f) => <Fragment key={f.id}>{card(f, 0)}</Fragment>)}</div>)}
      </li>
    );
  };

  const root = nodes.find((n) => n.kind === 'group');
  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Setup</div><h1>Organisation & groups</h1><p className="sub">Main entity → sub-groups → facilities. Click a facility to open it: profile, meters, energy, fleet and landfill sites. Data is entered per facility; totals roll up the tree.</p></div>
        <div className="row"><span className="chip">{counts.sub} sub-groups</span><span className="chip">{counts.fac} facilities</span></div>
      </div>
      <div className="card" style={{ padding: 14, display: 'grid', gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="grow"><h2 style={{ fontSize: 16 }}>Organisation hierarchy</h2><div className="sub">Click a facility to open its profile; click a group to fold or unfold it.</div></div>
          <span className="ohchip group">● Main entity</span><span className="ohchip subgroup">● Sub-group</span><span className="ohchip facility">● Facility</span>
          <div className="seg"><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button><button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Org chart</button></div>
        </div>
        <div className="row">
          <input className="input grow" type="search" placeholder="Search entities, facilities or locations…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All facility types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <button className="btn sm" onClick={() => setClosed(new Set())}>Expand all</button>
          <button className="btn sm" onClick={() => setClosed(new Set(nodes.filter((n) => n.kind !== 'facility' && n.parent_id).map((n) => n.id)))}>Collapse all</button>
          {view === 'chart' && <><button className="btn sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}>−</button><b style={{ fontSize: 12, width: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</b><button className="btn sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}>+</button></>}
          <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Archived</label>
        </div>
        {view === 'list' ? (
          <div className="scrollx">
            <table className="t ohtab">
              <thead><tr><th>Organisation</th><th>Type</th><th className="hide-sm">Location</th><th className="hide-sm">Manager</th><th>Data</th><th /></tr></thead>
              <tbody>{root && row(root, 0)}</tbody>
            </table>
            {root && filtering && !matches(root) && <div className="empty">Nothing matches.</div>}
          </div>
        ) : (
          <div className="ocwrap">
            <div className="oc" style={{ zoom }}><ul>{root && branch(root)}</ul></div>
            {root && filtering && !matches(root) && <div className="empty">Nothing matches.</div>}
          </div>
        )}
      </div>

      <dialog ref={dlg} className={`drawer${sel?.node.kind === 'facility' ? ' wide' : ''}`} onClose={() => setSel(null)}>
        {sel && <Profile key={sel.node.id} node={sel.node} initialTab={sel.tab} nodes={nodes} managers={managers} onClose={() => dlg.current?.close()}
          onSaved={async (m) => { toast(m); await load(); dlg.current?.close(); }} />}
      </dialog>
      {adding && <AddNode parent={adding.parent} kind={adding.kind} managers={managers} onClose={() => setAdding(null)} onSaved={async (m) => { toast(m); setAdding(null); await load(); }} />}
    </div>
  );
}

function fieldsFrom(n: Partial<OrgNode>) {
  return {
    name: n.name ?? '', facilityType: n.facility_type ?? '', location: n.location ?? '', country: n.country ?? 'AE',
    floorAreaM2: n.floor_area_m2 != null ? String(n.floor_area_m2) : '', employees: n.employees != null ? String(n.employees) : '',
    ownershipPct: String(n.ownership_pct ?? 100), operationalControl: n.operational_control ?? true, financialControl: n.financial_control ?? true,
    managerUserId: n.manager_user_id ?? '', gridRegion: n.grid_region ?? '',
  };
}
type F = ReturnType<typeof fieldsFrom>;
const toBody = (f: F, kind: string) => ({
  name: f.name.trim(), country: f.country.toUpperCase(),
  ...(kind === 'facility' ? {
    facilityType: f.facilityType || null, location: f.location || null, floorAreaM2: f.floorAreaM2 === '' ? null : Number(f.floorAreaM2),
    employees: f.employees === '' ? null : Number(f.employees), ownershipPct: Number(f.ownershipPct), operationalControl: f.operationalControl,
    financialControl: f.financialControl, managerUserId: f.managerUserId || null, gridRegion: f.gridRegion || null,
  } : {}),
});

function NodeForm({ f, setF, kind, managers, disabled }: { f: F; setF: (f: F) => void; kind: string; managers: Person[]; disabled: boolean }) {
  const set = (k: keyof F) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
      <label className="field"><span>Name</span><input className="input" value={f.name} onChange={set('name')} /></label>
      {kind === 'facility' && (
        <>
          <div className="row">
            <label className="field grow"><span>Facility type</span><select className="input" value={f.facilityType} onChange={set('facilityType')}><option value="">—</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field grow"><span>Location (emirate / city)</span><input className="input" value={f.location} onChange={set('location')} /></label>
            <label className="field" style={{ width: 80 }}><span>Country</span><input className="input" maxLength={2} value={f.country} onChange={set('country')} /></label>
          </div>
          <div className="row">
            <label className="field grow"><span>Floor area m²</span><input className="input num" value={f.floorAreaM2} onChange={set('floorAreaM2')} /></label>
            <label className="field grow"><span>Employees</span><input className="input num" value={f.employees} onChange={set('employees')} /></label>
          </div>
          <GridRegionField country={f.country.toUpperCase()} value={f.gridRegion} onChange={(v) => setF({ ...f, gridRegion: v })} />
          <label className="field"><span>Manager (approves this facility's data)</span>
            <select className="input" value={f.managerUserId} onChange={set('managerUserId')}><option value="">— none —</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <div className="card" style={{ background: '#F8FAF9', padding: 12, display: 'grid', gap: 8 }}>
            <b>Boundary (used by Methodology & boundaries)</b>
            <div className="row">
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.operationalControl} onChange={set('operationalControl')} />Operational control</label>
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.financialControl} onChange={set('financialControl')} />Financial control</label>
              <label className="field" style={{ width: 120 }}><span>Ownership %</span><input className="input num" value={f.ownershipPct} onChange={set('ownershipPct')} /></label>
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
}

function Profile({ node, initialTab, nodes, managers, onClose, onSaved }: { node: OrgNode; initialTab?: string; nodes: OrgNode[]; managers: Person[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [tab, setTab] = useState<'profile' | 'meters' | 'energy' | 'fleet' | 'waste'>((['meters', 'energy', 'fleet', 'waste'].includes(initialTab ?? '') ? initialTab : 'profile') as 'profile');
  const [fleetCount, setFleetCount] = useState<number | null>(null);
  const [meterCount, setMeterCount] = useState<number | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  useEffect(() => { if (node.kind === 'facility') { api.facilities().then((r) => setFacilities(r.facilities)).catch(() => setFacilities([])); api.meters(node.id).then((r) => setMeterCount(r.meters.length)).catch(() => {}); } }, [node.id, node.kind]);
  const [f, setF] = useState(fieldsFrom(node));
  const [parent, setParent] = useState(node.parent_id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const parents = nodes.filter((n) => n.kind !== 'facility' && n.id !== node.id && n.active && n.canEdit);
  const { role } = useApp();
  const canManageFleet = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role);
  const run = async (fn: () => Promise<unknown>, m: string) => { setErr(null); try { const r = await fn() as { message?: string }; onSaved(r?.message ?? m); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{node.kind === 'group' ? 'Main entity' : node.kind === 'subgroup' ? 'Sub-group' : 'Facility profile'}</div><h2>{node.name}</h2></div>
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      {node.kind === 'facility' && (
        <div className="tabs">
          <button className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>Profile</button>
          <button className={tab === 'meters' ? 'on' : ''} onClick={() => setTab('meters')}>Meters{meterCount != null ? ` (${meterCount})` : ''}</button>
          <button className={tab === 'energy' ? 'on' : ''} onClick={() => setTab('energy')}>Energy</button>
          <button className={tab === 'fleet' ? 'on' : ''} onClick={() => setTab('fleet')}>Vehicle fleet{fleetCount != null ? ` (${fleetCount})` : ''}</button>
          <button className={tab === 'waste' ? 'on' : ''} onClick={() => setTab('waste')}>Landfill sites</button>
        </div>
      )}
      {tab === 'meters' && node.kind === 'facility' && <MeterRegister embedded facilityId={node.id} facilities={facilities} canEditFacility={node.canEnter && node.active} onCount={setMeterCount} />}
      {tab === 'energy' && node.kind === 'facility' && <FacilityEnergy node={node} onProfile={() => setTab('profile')} />}
      {tab === 'waste' && node.kind === 'facility' && <WasteSites facilityId={node.id} canEdit={node.canEnter && node.active && canManageFleet} />}
      {tab === 'fleet' && node.kind === 'facility' && <Fleet facilityId={node.id} canEdit={node.canEnter && node.active && canManageFleet} onCount={setFleetCount} />}
      {tab === 'profile' && <>
      {!node.canEdit && <div className="note info">Read-only: this is outside the part of the organisation you manage.</div>}
      <NodeForm f={f} setF={setF} kind={node.kind} managers={managers} disabled={!node.canEdit} />
      {node.kind !== 'group' && node.canEdit && (
        <label className="field"><span>Belongs to</span><select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      )}
      {node.kind === 'facility' && <div className="sub">{node.entries} entries recorded for this facility.</div>}
      {err && <div className="note bad">{err}</div>}
      {node.canEdit && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {node.kind !== 'group' && (node.active
            ? <button className="btn danger" onClick={() => run(() => api.removeNode(node.id), 'Removed')}>Remove</button>
            : <button className="btn" onClick={() => run(() => api.updateNode(node.id, { active: true }), 'Restored')}>Restore</button>)}
          <button className="btn p" onClick={() => run(() => api.updateNode(node.id, { ...toBody(f, node.kind), ...(parent && parent !== node.parent_id ? { parentId: parent } : {}) }), 'Saved')}>Save</button>
        </div>
      )}
      </>}
    </div>
  );
}

function AddNode({ parent, kind, managers, onClose, onSaved }: { parent: OrgNode; kind: 'subgroup' | 'facility'; managers: Person[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState(fieldsFrom({ country: parent.country }));
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>Add {kind === 'facility' ? 'a facility' : 'a sub-group'} under {parent.name}</h2>
        <NodeForm f={f} setF={setF} kind={kind} managers={managers} disabled={false} />
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn p" disabled={!f.name.trim()} onClick={async () => {
            setErr(null);
            try { await api.createNode({ parentId: parent.id, kind, ...toBody(f, kind) }); onSaved(`${kind === 'facility' ? 'Facility' : 'Sub-group'} added`); } catch (e) { setErr((e as Error).message); }
          }}>Add</button>
        </div>
      </div>
    </dialog>
  );
}

/** Grid region of a facility (location-based Scope 2): national average or a sub-region with its own factor. */
function GridRegionField({ country, value, onChange }: { country: string; value: string; onChange: (v: string) => void }) {
  const [regions, setRegions] = useState<GridRegion[]>([]);
  useEffect(() => { api.gridRegions().then((r) => setRegions(r.regions)).catch(() => setRegions([])); }, []);
  const here = regions.filter((r) => r.country === country && r.kind !== 'country');
  return (
    <label className="field"><span>Grid region (electricity)</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{country} national average</option>
        {here.map((r) => <option key={r.code} value={r.code}>{r.name} ({r.code}){r.factors?.some((x) => x.basis === 'scope2') ? '' : ' — no factor yet, national used'}</option>)}
      </select></label>
  );
}
