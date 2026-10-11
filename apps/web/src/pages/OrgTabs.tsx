/**
 * Organisation & groups — the other tabs next to the tree (as in the prototype):
 *   Facilities        one table of every facility: type, sub-group, location, manager, meters,
 *                     vehicles, landfill sites, the year's data approved and tCO₂e.
 *   Sub-groups        the main entity and its sub-groups: where each sits, admins, facilities,
 *                     tCO₂e; edit, add a facility there.
 *   Dashboard groups  any mix of facilities to view together (Professional and Enterprise).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, type DashGroup, type FacSummary, type OrgNode } from '../lib/api';

const fmtT = (t: number) => (t >= 100 ? Math.round(t).toLocaleString('en') : t.toLocaleString('en', { maximumFractionDigits: 1 }));
const KIND: Record<OrgNode['kind'], string> = { group: 'Main entity', subgroup: 'Sub-group', facility: 'Facility' };

function useSummary(year: number) {
  const [s, setS] = useState<{ facilities: Map<string, FacSummary>; admins: Record<string, string[]>; superAdmins: string[] } | null>(null);
  useEffect(() => { api.orgSummary(year).then((r) => setS({ facilities: new Map(r.facilities.map((f) => [f.id, f])), admins: r.admins, superAdmins: r.superAdmins })).catch(() => setS({ facilities: new Map(), admins: {}, superAdmins: [] })); }, [year]);
  return s;
}

export function FacilitiesTab({ nodes, onOpen }: { nodes: OrgNode[]; onOpen: (n: OrgNode) => void }) {
  const { tenant } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [q, setQ] = useState('');
  const sum = useSummary(year);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const all = nodes.filter((n) => n.kind === 'facility' && n.active);
  const fs = all.filter((n) => n.canSee && (!q || `${n.name} ${n.facility_type ?? ''} ${n.location ?? ''} ${byId.get(n.parent_id ?? '')?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const max = tenant?.planLimits?.facilities;
  return (
    <div className="card flush">
      <div className="row" style={{ padding: '12px 16px', gap: 10 }}>
        <input className="input" style={{ maxWidth: 280 }} type="search" placeholder="Search facilities" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2, 3].map((k) => new Date().getFullYear() - k).map((y) => <option key={y}>{y}</option>)}</select>
        <span className="grow" />
        <span className="sub">{fs.length} of {all.length} facilities · plan allows {max == null ? 'unlimited' : max}</span>
      </div>
      <div className="scrollx"><table className="t">
        <thead><tr><th>Facility</th><th>Type</th><th>Sub-group</th><th>Location</th><th>Manager</th><th className="num">Meters</th><th className="num">Vehicles</th><th className="num">Landfill sites</th><th>{year} data approved</th><th className="num">tCO₂e {year}</th></tr></thead>
        <tbody>{fs.map((f) => { const x = sum?.facilities.get(f.id); const pct = x && x.entries ? x.approved / x.entries : 0; return (
          <tr key={f.id} className="click" onClick={() => onOpen(f)} title={`Open ${f.name}`}>
            <td><b>{f.name}</b>{f.ownership_pct !== 100 && <span className="chip info" style={{ marginLeft: 6 }}>{f.ownership_pct}%</span>}</td>
            <td>{f.facility_type ? <span className="chip grey">{f.facility_type}</span> : '—'}</td>
            <td>{byId.get(f.parent_id ?? '')?.name ?? '—'}</td>
            <td>{[f.location, f.country].filter(Boolean).join(', ') || '—'}</td>
            <td>{f.manager_name ?? <span style={{ color: 'var(--bad)' }}>Not set</span>}</td>
            <td className="num">{x?.meters ?? '…'}</td><td className="num">{x?.vehicles ?? '…'}</td><td className="num">{x?.sites ?? '…'}</td>
            <td>{x ? (x.entries ? <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><div className="revbar" style={{ width: 80, height: 8 }}><span className="c" style={{ flex: pct || 0.0001 }} /><span className="a" style={{ flex: 1 - pct || 0.0001 }} /></div><span className="small">{Math.round(pct * 100)}% of {x.entries}{x.months ? ` · ${x.months} month${x.months === 1 ? '' : 's'}` : ' · whole year'}</span></div> : <span className="chip grey">no data</span>) : '…'}</td>
            <td className="num"><b>{x ? fmtT(x.t) : '…'}</b></td>
          </tr>); })}
          {!fs.length && <tr><td colSpan={10} className="muted">No facilities match.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

export function SubgroupsTab({ nodes, onOpen, onEdit, onAddFacility }: { nodes: OrgNode[]; onOpen: (n: OrgNode) => void; onEdit: (n: OrgNode) => void; onAddFacility: (n: OrgNode) => void }) {
  const year = new Date().getFullYear();
  const sum = useSummary(year);
  const groups = nodes.filter((n) => (n.kind === 'group' || n.kind === 'subgroup') && n.active);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = groups.find((g) => g.id === selId) ?? groups[0];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const facsUnder = (id: string): OrgNode[] => nodes.filter((n) => n.parent_id === id && n.active).flatMap((k) => (k.kind === 'facility' ? [k] : facsUnder(k.id)));
  const t = (id: string) => facsUnder(id).reduce((a, f) => a + (sum?.facilities.get(f.id)?.t ?? 0), 0);
  const kv = (k: string, v: React.ReactNode) => <div className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', flexWrap: 'nowrap' }}><span className="muted" style={{ width: 150, flex: 'none' }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span></div>;
  const fs = sel ? facsUnder(sel.id) : [];
  const admins = sel ? (sel.kind === 'group' ? sum?.superAdmins ?? [] : sum?.admins[sel.id] ?? []) : [];
  return (
    <div className="orggrid">
      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2 style={{ fontSize: 16 }}>Main entity and sub-groups</h2></div>
        <table className="t">
          <thead><tr><th>Name</th><th>Type</th><th>Sits under</th><th className="num">Facilities</th><th className="num">tCO₂e {year}</th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.id} className={`click ${sel?.id === g.id ? 'sel' : ''}`} onClick={() => setSelId(g.id)}>
              <td><b>{g.name}</b></td><td><span className={`ohchip ${g.kind}`}>{KIND[g.kind]}</span></td>
              <td>{g.parent_id ? byId.get(g.parent_id)?.name ?? '—' : '—'}</td>
              <td className="num">{facsUnder(g.id).length}</td><td className="num">{sum ? fmtT(t(g.id)) : '…'}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {sel && (
        <div className="card" style={{ display: 'grid', gap: 4 }}>
          <span className="eyebrow">{KIND[sel.kind]}</span><h2 style={{ fontSize: 20 }}>{sel.name}</h2>
          {kv('Sits under', sel.parent_id ? byId.get(sel.parent_id)?.name ?? '—' : '—')}
          {kv('Country', sel.country)}
          {kv(sel.kind === 'group' ? 'Super admins' : 'Admins', admins.length ? admins.join(', ') : <span style={{ color: 'var(--bad)' }}>None yet</span>)}
          {kv('Facilities', fs.length)}
          {kv(`tCO₂e ${year} to date`, sum ? fmtT(t(sel.id)) : '…')}
          <div style={{ display: 'grid', gap: 2, marginTop: 8 }}>{fs.map((f) => (
            <button key={f.id} className="node" disabled={!f.canSee} onClick={() => onOpen(f)}><b>{f.name}</b><span className="grow" />{f.facility_type && <span className="chip grey">{f.facility_type}</span>}<span className="muted small">{byId.get(f.parent_id ?? '')?.id !== sel.id ? byId.get(f.parent_id ?? '')?.name : ''}</span></button>))}</div>
          {sel.canEdit && <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={() => onEdit(sel)}>Edit</button><button className="btn" onClick={() => onAddFacility(sel)}>+ Facility here</button></div>}
        </div>
      )}
    </div>
  );
}

export function GroupsTab({ nodes }: { nodes: OrgNode[] }) {
  const { role, toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<{ allowed: boolean; hidden: number; groups: DashGroup[] } | null>(null);
  const [name, setName] = useState('');
  const [ticks, setTicks] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.dashGroups().then(setD).catch(() => setD({ allowed: false, hidden: 0, groups: [] }));
  useEffect(() => { load(); }, []);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const vis = nodes.filter((n) => n.kind === 'facility' && n.active && n.canSee).sort((a, b) => (byId.get(a.parent_id ?? '')?.name ?? '').localeCompare(byId.get(b.parent_id ?? '')?.name ?? '') || a.name.localeCompare(b.name));
  if (!d) return <div className="card empty">Loading…</div>;
  const save = async () => {
    setErr(null);
    try { await api.createGroup({ name: name.trim(), facilityIds: [...ticks] }); toast(`Group “${name.trim()}” saved`); setName(''); setTicks(new Set()); load(); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="orggrid">
      <div className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ fontSize: 16 }}>Dashboard groups</h2>
        <p className="sub" style={{ margin: 0 }}>Any mix of facilities to view together — for example “Sharjah sites” or the SBTi boundary. They never change the organisation. People only see a group if they can see every facility in it, so totals are never partial. Open one in Dashboards (it is also in the “part of the group” list there).</p>
        {d.groups.map((g) => (
          <div key={g.id} className="row" style={{ padding: '10px 0', borderTop: '1px solid var(--line)', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0 }}><b>{g.name}</b><div className="muted small">{g.facilities.map((f) => f.name).join(' · ')}</div></span>
            <span className="muted small">by {g.created_by_name}</span>
            <button className="btn sm" onClick={() => nav(`/dashboards?group=${g.id}`)}>Open dashboard</button>
            {g.canDelete && <button className="btn sm ghost danger" onClick={async () => { try { await api.deleteGroup(g.id); toast('Group deleted'); load(); } catch (e) { toast((e as Error).message); } }}>Delete</button>}
          </div>))}
        {!d.groups.length && <div className="muted">No groups yet.</div>}
        {d.hidden > 0 && <div className="sub">{d.hidden} group{d.hidden === 1 ? '' : 's'} not shown: {d.hidden === 1 ? 'it includes' : 'they include'} facilities outside your access.</div>}
      </div>
      {role !== 'verifier' && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>New group</h2>
          <label className="field"><span>Name</span><input className="input" value={name} placeholder="e.g. Sharjah sites" onChange={(e) => setName(e.target.value)} /></label>
          <div className="sub">{ticks.size} of {vis.length} facilities ticked</div>
          <div style={{ maxHeight: 360, overflow: 'auto', display: 'grid' }}>{vis.map((f) => (
            <label key={f.id} className="row" style={{ padding: '5px 0', gap: 8 }}>
              <input type="checkbox" checked={ticks.has(f.id)} onChange={(e) => { const n = new Set(ticks); if (e.target.checked) n.add(f.id); else n.delete(f.id); setTicks(n); }} />
              {f.name} <span className="muted small">{byId.get(f.parent_id ?? '')?.name}</span>
            </label>))}</div>
          {err && <div className="note bad">{err}</div>}
          <div><button className="btn p" disabled={!ticks.size || name.trim().length < 2} onClick={save}>Save group</button></div>
        </div>
      )}
    </div>
  );
}
