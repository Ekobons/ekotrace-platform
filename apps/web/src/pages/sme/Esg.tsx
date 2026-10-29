/** ESG readiness: the inputs behind the Environment, Social and Governance scores, the level and what would lift it. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Req, Sample, SmeHead, Toggle } from './ui';
import { f0, LEVELS } from '../../lib/sme';
import './carbon.css';

type Sec = 'env' | 'soc' | 'gov';
type Weights = Record<Sec, Record<string, number>>;

/** A check the score reads from another page: shown with its state and a link there. */
function From({ label, hint, ok, go, goLabel, pts }: { label: string; hint: ReactNode; ok: boolean; go: string; goLabel: string; pts?: string }) {
  return (
    <div className="cb-ro">
      <span>{label}<small>{hint} · <Link to={`/sme/${go}`}>{goLabel}</Link>{pts ? ` · ${pts}` : ''}</small></span>
      <Pill kind={ok ? 'good' : 'watch'}>{ok ? 'Done' : 'Not yet'}</Pill>
    </div>);
}

export function SmeEsg() {
  const { d, get, error } = useSme();
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading your data…</div>;
  const e = d.results.esg as { E: number; S: number; G: number; overall: number; eligible: boolean; level: number; levelName: string; gaps: { text: string; gain: string; go?: string }[] };
  const W = (d.config.esg?.weights ?? null) as Weights | null;
  const pts = (s: Sec, k: string) => {
    if (!W) return '';
    const tot = Object.values(W[s] ?? {}).reduce((a, b) => a + Number(b || 0), 0), w = Number(W[s]?.[k] ?? 0);
    return w ? `${w} of ${tot} points` : '';
  };
  const h = (text: string, s: Sec, k: string) => [text, pts(s, k)].filter(Boolean).join(' · ') || undefined;
  const iso = ((get('certs') ?? []) as { id: string; level?: string }[]).find((c) => c.id === 'iso14001');
  const isoHeld = !!iso?.level && iso.level !== 'none';
  const lti = Number(d.results.safety?.lti ?? 0), entries = Number(d.results.safety?.entries ?? 0);
  const noInc = !!get('people.noIncidents');
  const low = (['Environment', 'Social', 'Governance'] as const).filter((_, i) => [e.E, e.S, e.G][i]! < 30);
  const started = Object.keys(d.meta).length > 0;
  return (
    <div className="cb-stack">
      <SmeHead lede="Mapped to what listed customers ask under BRSR Core. About ten minutes. Scores update as you answer." />

      <Kpis>
        <Kpi label="Overall readiness" value={<>{f0(e.overall)}%{d.company.isExample && <Sample />}</>} unit={e.level ? `Level ${e.level} · ${e.levelName}` : LEVELS[0]} good={e.level > 0} />
        <Kpi label="Environment" value={`${f0(e.E)}%`} unit={e.E < 30 ? 'Below the 30% floor' : 'Above the 30% floor'} />
        <Kpi label="Social" value={`${f0(e.S)}%`} unit={e.S < 30 ? 'Below the 30% floor' : 'Above the 30% floor'} />
        <Kpi label="Governance" value={`${f0(e.G)}%`} unit={e.G < 30 ? 'Below the 30% floor' : 'Above the 30% floor'} />
      </Kpis>

      {!started && <div className="sme-callout">Nothing entered for {d.fy} yet. Answer the questions below, and add your power and fuel bills in <Link to="/sme/emissions">Emissions</Link>.</div>}

      <div className="sme-grid2">
        <div className="card">
          <div className="cb-h"><h2>Readiness level</h2><Pill kind={e.level ? 'good' : 'soon'}>{e.level ? `Level ${e.level} · ${e.levelName}` : 'Not yet rated'}</Pill></div>
          <div className="sme-ladder">{[1, 2, 3, 4].map((i) => <div key={i} className={e.level >= i ? 'on' : ''} style={{ height: `${25 + i * 18}%` }}>{i}</div>)}</div>
          <div className="sme-ladder-l"><span>Formative<br />30–50%</span><span>Developing<br />&gt;50–65%</span><span>Emerging<br />&gt;65–80%</span><span>Established<br />&gt;80%</span></div>
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {([['Environment', e.E], ['Social', e.S], ['Governance', e.G]] as [string, number][]).map(([l, v]) => (
              <div key={l} className="sme-secbar"><span>{l}</span><div className="sme-track"><b style={{ width: `${Math.min(100, v)}%`, background: v < 30 ? 'var(--warn)' : undefined }} /><em /></div><span className="num">{f0(v)}%</span></div>))}
          </div>
          {e.eligible
            ? <p className="cb-muted-note">Every section is at 30% or more, so a level can be given. The overall score is the average of the three sections.</p>
            : <div className="sme-callout warn" style={{ marginTop: 12 }}>{low.join(' and ')} {low.length === 1 ? 'is' : 'are'} below 30%. Each section needs at least 30% before any level is given, whatever the overall score. The marker on each bar shows that floor.</div>}
        </div>
        <div className="card">
          <h2>What would lift your level</h2>
          <p className="cb-sub">The quickest gains, with the points each one adds.</p>
          {e.gaps.map((g) => <Req key={g.text} title={g.text} pill={g.gain} kind="good" action={g.go ? <Link to={`/sme/${g.go}`}>Open {g.go === 'certs' ? 'Certifications' : g.go === 'dpdp' ? 'DPDP' : g.go === 'people' ? 'People & safety' : g.go}</Link> : null} />)}
          {!e.gaps.length && <p className="muted">All the main checks are done.</p>}
        </div>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <div className="cb-h"><h2>Environment</h2><b className="num">{f0(e.E)}%</b></div>
          <From label="Energy use tracked" hint="Grid electricity or diesel entered" ok={Number(get('emissions.grid')) > 0 || Number(get('emissions.diesel')) > 0} go="emissions" goLabel="Emissions" pts={pts('env', 'energy_tracked')} />
          <From label="Renewable electricity" hint="Any rooftop solar used" ok={Number(d.results.emissions?.renewablePct ?? 0) > 0} go="emissions" goLabel="Emissions" pts={pts('env', 'renewables')} />
          <Num path="esg.water" label="Water withdrawn" unit="kL" hint={h('Yearly, from water bills or meter', 'env', 'water_tracked')} />
          <Num path="esg.waste" label="Waste generated" unit="t" hint={h('All solid and hazardous waste', 'env', 'waste_tracked')} />
          <Num path="esg.recycled" label="Waste recycled or reused" unit="%" hint={h('50% or more counts', 'env', 'recycling_50')} />
          <Toggle path="esg.target" label="We have an energy or emission reduction target" hint={pts('env', 'target') || undefined} />
          <From label="ISO 14001 or similar system" hint={isoHeld ? `Status: ${iso?.level === 'inprogress' ? 'in progress' : iso?.level}` : 'Not held'} ok={isoHeld} go="certs" goLabel="Certifications" pts={pts('env', 'ems')} />
        </div>
        <div className="card">
          <div className="cb-h"><h2>Social</h2><b className="num">{f0(e.S)}%</b></div>
          <From label="Headcount recorded" hint={Number(get('profile.employees')) > 0 ? `${f0(get('profile.employees'))} employees` : 'Not entered'} ok={Number(get('profile.employees')) > 0} go="profile" goLabel="Profile" pts={pts('soc', 'headcount')} />
          <Num path="esg.women" label="Women in the workforce" unit="%" hint={h('Share of all employees and workers', 'soc', 'women_recorded')} />
          <Num path="esg.training" label="Training per employee" unit="hrs" hint={h('Average hours a year', 'soc', 'training')} />
          <From label="Safety log kept" hint={entries ? `${entries} entr${entries === 1 ? 'y' : 'ies'}, ${lti} lost-time injur${lti === 1 ? 'y' : 'ies'}` : noInc ? 'No incidents this year' : 'Nothing logged'} ok={entries > 0 || noInc} go="people" goLabel="Safety log" pts={[pts('soc', 'safety_log'), (entries > 0 || noInc) && lti === 0 && pts('soc', 'zero_lti') ? `+${pts('soc', 'zero_lti')} for no lost-time injuries` : ''].filter(Boolean).join(', ')} />
          <Toggle path="people.noIncidents" label="No safety incidents this year" hint="Tick only if the safety log is empty because nothing happened" disabled={entries > 0} />
          <Toggle path="esg.minwage" label="All workers paid at least minimum wage" hint={pts('soc', 'min_wage') || undefined} />
          <Toggle path="esg.posh" label="Internal Committee under the POSH Act" hint={pts('soc', 'posh') || undefined} />
        </div>
        <div className="card">
          <div className="cb-h"><h2>Governance</h2><b className="num">{f0(e.G)}%</b></div>
          <Toggle path="esg.coc" label="Written code of conduct" hint={pts('gov', 'coc') || undefined} />
          <Toggle path="esg.abc" label="Anti-bribery policy" hint={pts('gov', 'abc') || undefined} />
          <Toggle path="esg.grievance" label="Grievance channel for workers and communities" hint={pts('gov', 'grievance') || undefined} />
          <Toggle path="esg.privacy" label="Data privacy policy (DPDP Act)" hint={pts('gov', 'privacy') || undefined} />
          <Toggle path="esg.supplierCode" label="Supplier code of conduct" hint={pts('gov', 'supplier_code') || undefined} />
          <Toggle path="esg.ownerEsg" label="A named owner or director responsible for ESG" hint={pts('gov', 'owner_esg') || undefined} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>This readiness score is EKOTRACE’s own quick check. For the ICAI maturity level that buyers and banks recognise, complete <Link to="/sme/srmm">SRMM</Link>.</p>
    </div>);
}
