/** Emissions: yearly totals from bills and invoices; scope is worked out from the factor library. */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, SmeHead } from './ui';
import { f1, f2 } from '../../lib/sme';

const GROUPS = [
  { title: 'Fuels & refrigerants', scope: 1, note: 'Scope 1: fuels you burn and refrigerant you top up.' },
  { title: 'Electricity', scope: 2, note: 'Scope 2: electricity you buy. Solar you generate adds no emissions.' },
  { title: 'Value chain', scope: 3, note: 'Scope 3, optional: purchased goods (Cat 1), inbound transport (Cat 4) and business travel (Cat 6). Add only what buyers ask for.' },
];

export function SmeEmissions() {
  const { d } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const r = d.results, F = d.config.factors.items as Record<string, { label: string; unit: string; scope: number; category: string | null }>;
  const keys = (s: number) => Object.keys(F).filter((k) => F[k]!.scope === s);
  const total = (s: number) => (s === 1 ? r.emissions.s1 : s === 2 ? r.emissions.s2 : r.emissions.s3);
  const out = (k: string) => { const row = (r.emissions.rows as { key: string; tco2e: number; category: string | null; scope: number }[]).find((x) => x.key === k); return row && row.tco2e ? `= ${f2(row.tco2e)} tCO₂e · ${row.category ?? `Scope ${row.scope}`}` : ''; };
  const group = (g: (typeof GROUPS)[number]) => (
    <div className="card" key={g.title}>
      <div className="row"><h2 className="grow">{g.title}</h2><b className="num">{f1(total(g.scope))} t</b></div>
      <p className="muted" style={{ margin: '4px 0 6px', fontSize: 13 }}>{g.note}</p>
      {keys(g.scope).map((k) => <Num key={k} path={`emissions.${k}`} label={F[k]!.label} unit={F[k]!.unit} out={out(k)} />)}
    </div>);
  return (
    <>
      <SmeHead lede="Enter yearly totals from your bills and invoices. Scope is worked out for you."><Link className="btn" to="/sme/scan">Read a bill</Link></SmeHead>
      <Kpis><Kpi label="Scope 1" value={f1(r.emissions.s1)} unit="tCO₂e" /><Kpi label="Scope 2" value={f1(r.emissions.s2)} unit="tCO₂e" /><Kpi label="Scope 3" value={f1(r.emissions.s3)} unit="tCO₂e" /><Kpi label="Intensity" value={f1(r.emissions.intensity)} unit="tCO₂e per ₹ crore" /></Kpis>
      <div className="sme-grid2">{GROUPS.slice(0, 2).map(group)}</div>
      {group(GROUPS[2]!)}
      <p className="muted" style={{ fontSize: 12 }}>{d.config.factors.note} Factor set {d.config.factors.version}.</p>
    </>);
}
