/**
 * Dashboards: the year's inventory at a glance — Scope 1, 2 and 3 against last year and the
 * base year, by month, category, facility and Scope 3 category, the largest sources, which
 * months each facility has data for, and how much of the purchases use suppliers' own factors.
 * Totals follow the company's consolidation approach; Scope 2 is location- or market-based.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Dashboard, type OrgNode } from '../lib/api';
import { BarList, Delta, Kpi, MONTHS, MonthColumns, PALETTE, ShareBar, t as tonnes } from '../components/Charts';

const SCOPE_COLOR = { 1: 'var(--s1)', 2: 'var(--s2)', 3: 'var(--s3)' } as Record<number, string>;
const CONSOLIDATION: Record<string, string> = { operational: 'operational control', financial: 'financial control', equity: 'equity share' };

export function Dashboards() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  const node = sp.get('node') ?? '';
  const scope2 = (sp.get('scope2') as 'location' | 'market') || 'location';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [d, setD] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  useEffect(() => { api.org().then((r) => setNodes(r.nodes.filter((n) => n.canSee && n.active))).catch(() => {}); }, []);
  useEffect(() => { setErr(null); api.dashboard({ year, node: node || undefined, scope2 }).then(setD).catch((e) => setErr(e.message)); }, [year, node, scope2]);
  if (!d) return <div className="page"><div className="card empty">{err ?? 'Loading…'}</div></div>;

  const T = d.totals;
  const s1 = T.s1 ?? 0, s2 = T.s2 ?? 0, s3 = T.s3 ?? 0;
  const nodeName = nodes.find((n) => n.id === node)?.name;
  const subgroups = nodes.filter((n) => n.kind !== 'facility');
  const facilities = nodes.filter((n) => n.kind === 'facility');
  const months = d.coverage.reduce((s, c) => s + c.months.length, 0);
  const quality = d.quality.supplier_co2e + d.quality.spend_co2e;

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Overview</div><h1>Dashboards</h1>
          <p className="sub">{nodeName ? <b>{nodeName}</b> : 'Whole group'} · {d.year} · {CONSOLIDATION[d.consolidation] ?? d.consolidation} · Scope 2 {scope2}-based. Rejected entries are left out; biogenic CO₂ and gases outside the Kyoto basket are shown apart from the totals.</p></div>
      </div>
      <div className="card row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 110 }}><span>Year</span><select className="input" value={d.year} onChange={(e) => set('year', e.target.value)}>{(d.years.length ? d.years : [d.year]).map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="field" style={{ minWidth: 240 }}><span>Part of the group</span>
          <select className="input" value={node} onChange={(e) => set('node', e.target.value || null)}>
            <option value="">Whole group</option>
            {subgroups.length > 0 && <optgroup label="Sub-groups">{subgroups.filter((n) => n.kind === 'subgroup').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>}
            <optgroup label="Facilities">{facilities.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>
          </select></label>
        <div className="grow" />
        <div className="field"><span>Scope 2</span><div className="seg" role="group" aria-label="Scope 2 method">
          <button className={scope2 === 'location' ? 'on' : ''} onClick={() => set('scope2', null)}>Location-based</button>
          <button className={scope2 === 'market' ? 'on' : ''} onClick={() => set('scope2', 'market')}>Market-based</button></div></div>
      </div>
      {!T.entries ? <div className="card empty"><h3>No entries in {d.year}{nodeName ? ` for ${nodeName}` : ''}</h3><p className="sub">Add data under “Add data”, or pick another year.</p></div> : <>
        <div className="kpis">
          <Kpi label="Total Scope 1 + 2 + 3" value={tonnes(T.total)} unit="tCO₂e" sub={<><Delta now={T.total} before={d.previous.total} label={String(d.previous.year)} />{d.baseYear && <Delta now={T.total} before={d.baseYear.total} label={`base year ${d.baseYear.year}`} />}</>} />
          <Kpi label="Scope 1 · direct" value={tonnes(s1)} unit="t" tone="s1" sub={`${T.total ? Math.round((s1 / T.total) * 100) : 0}% of total`} />
          <Kpi label={`Scope 2 · ${scope2}-based`} value={tonnes(s2)} unit="t" tone={scope2 === 'market' ? 's2m' : 's2'}
            sub={<span>{scope2 === 'market' ? 'location-based' : 'market-based'}: {tonnes(scope2 === 'market' ? T.s2_location : T.s2_market)} t</span>} />
          <Kpi label="Scope 3 · value chain" value={tonnes(s3)} unit="t" tone="s3" sub={`${d.scope3.length} categor${d.scope3.length === 1 ? 'y' : 'ies'} reported`} />
          <Kpi label="Outside the totals" value={tonnes(T.biogenic)} unit="t bio CO₂" tone="bio" sub={T.memo ? `${tonnes(T.memo)} t other gases (memo)` : 'biogenic CO₂ from biomass and waste'} />
          <Kpi label="Entries" value={T.entries.toLocaleString('en')} sub={<><span>{T.approved.toLocaleString('en')} approved</span><span>{T.estimated.toLocaleString('en')} estimated (not actual data)</span></>} />
        </div>
        <div className="card"><ShareBar parts={[{ key: 's1', label: 'Scope 1', value: s1, color: 'var(--s1)' }, { key: 's2', label: `Scope 2 (${scope2})`, value: s2, color: 'var(--s2)' }, { key: 's3', label: 'Scope 3', value: s3, color: 'var(--s3)' }]} /></div>
        <div className="dashgrid">
          <div className="card" style={{ gridColumn: '1 / -1' }}><h3>By month</h3>
            <p className="sub">Monthly entries by scope.{d.annualOnly > 0 ? ` ${tonnes(d.annualOnly)} t entered for longer periods (quarters, the year) is in the totals but not in the months.` : ''}</p>
            <MonthColumns data={d.monthly} series={[{ key: 's1', label: 'Scope 1', color: 'var(--s1)' }, { key: 's2', label: `Scope 2 (${scope2})`, color: 'var(--s2)' }, { key: 's3', label: 'Scope 3', color: 'var(--s3)' }]} height={220} /></div>
          <div className="card"><h3>By category</h3><p className="sub">Click a category to open its data.</p>
            <BarList rows={d.byCategory.filter((r) => r.co2e).map((r) => ({ key: r.code, label: r.name, sub: `Scope ${r.scope}${r.ghg_category ? ` · 3.${r.ghg_category}` : ''}`, value: r.co2e, color: SCOPE_COLOR[r.scope], onClick: () => nav(`/data/${r.code}`) }))} total={T.total} /></div>
          <div className="card"><h3>By facility</h3><p className="sub">Click a facility to show only its figures.</p>
            <BarList rows={d.byFacility.filter((r) => r.co2e).map((r, i) => ({ key: r.id, label: r.name, sub: [r.parent, r.facility_type].filter(Boolean).join(' · '), value: r.co2e, color: PALETTE[i % PALETTE.length], onClick: () => set('node', r.id) }))} total={T.total} /></div>
          <div className="card"><h3>Scope 3 categories</h3><p className="sub">GHG Protocol categories with data. 3.3 includes well-to-tank and grid losses of fuels and energy used.</p>
            <BarList rows={d.scope3.map((r) => ({ key: String(r.cat), label: `3.${r.cat} ${r.name}`, value: r.co2e, color: 'var(--s3)' }))} total={s3} empty="No Scope 3 data yet." /></div>
          <div className="card"><h3>Largest sources</h3><p className="sub">The ten items with the most emissions.</p>
            <BarList rows={d.top.map((r, i) => ({ key: `${r.item}${i}`, label: r.item, sub: `${r.category} · Scope ${r.scope}`, value: r.co2e, color: SCOPE_COLOR[r.scope] }))} total={T.total} max={10} /></div>
          <div className="card" style={{ gridColumn: '1 / -1' }}><h3>Data coverage</h3>
            <p className="sub">Months of {d.year} with at least one entry, per facility ({months} of {d.coverage.length * 12} facility-months). Gaps are the places to chase.</p>
            <div className="covgrid">
              <span />{MONTHS.map((m) => <span key={m} className="cg-h">{m}</span>)}
              {d.coverage.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <FacilityRow key={c.id} name={c.name} months={c.months} />
              ))}
            </div></div>
          {quality > 0 && <div className="card"><h3>Purchases: data quality</h3><p className="sub">Published purchases calculated with the supplier's own factor versus spend-based estimates.</p>
            <ShareBar parts={[{ key: 'sup', label: "Supplier's own factor", value: d.quality.supplier_co2e, color: 'var(--s1)' }, { key: 'spend', label: 'Spend-based (EPA)', value: d.quality.spend_co2e, color: 'var(--s3)' }]} />
            <div className="sub" style={{ marginTop: 8 }}>{d.quality.supplier_lines.toLocaleString('en')} lines with supplier factors, {d.quality.spend_lines.toLocaleString('en')} spend-based. <a href="/suppliers?tab=analytics" onClick={(e) => { e.preventDefault(); nav('/suppliers?tab=analytics'); }}>Supplier analytics →</a></div></div>}
        </div>
      </>}
    </div>
  );
}

function FacilityRow({ name, months }: { name: string; months: number[] }) {
  const has = new Set(months);
  return <>
    <span className="cg-n" title={name}>{name}</span>
    {MONTHS.map((m, i) => <span key={m} className={`cg-c ${has.has(i + 1) ? 'on' : ''}`} title={`${name} · ${m}: ${has.has(i + 1) ? 'data' : 'no data'}`} />)}
  </>;
}
