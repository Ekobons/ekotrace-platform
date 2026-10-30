/** ESG readiness: the inputs behind the Environment, Social and Governance scores, the level and what would lift it. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Req, Sample, SmeHead, Toggle } from './ui';
import { f0, LEVELS } from '../../lib/sme';
import { Evidence, ProofCount, useProofCounts } from './Evidence';
import './carbon.css';
import { t, tn } from './i18n';

type Sec = 'env' | 'soc' | 'gov';
type Weights = Record<Sec, Record<string, number>>;
/** Policies a buyer or CA asks to see: [store path, proof item, what to attach]. */
const POLICIES: [string, string, string][] = [
  ['esg.coc', 'coc', 'Code of conduct'], ['esg.abc', 'abc', 'Anti-bribery policy'], ['esg.posh', 'posh', 'POSH policy and committee order'],
  ['esg.privacy', 'privacy', 'Privacy policy'], ['esg.grievance', 'grievance', 'Grievance mechanism'], ['esg.supplierCode', 'supplier_code', 'Supplier code of conduct'],
  ['esg.target', 'target', 'Reduction target'],
];

/** The proof line under a policy toggle, once the policy is ticked. */
function Proof({ path, item }: { path: string; item: string }) {
  const { get } = useSme();
  return get(path) ? <div className="sme-ev-under"><Evidence module="esg" item={item} label={t('Proof')} /></div> : null;
}

/** A check the score reads from another page: shown with its state and a link there. */
function From({ label, hint, ok, go, goLabel, pts }: { label: string; hint: ReactNode; ok: boolean; go: string; goLabel: string; pts?: string }) {
  return (
    <div className="cb-ro">
      <span>{label}<small>{hint} · <Link to={`/sme/${go}`}>{t(goLabel)}</Link>{pts ? ` · ${pts}` : ''}</small></span>
      <Pill kind={ok ? 'good' : 'watch'}>{ok ? t('Done') : t('Not yet')}</Pill>
    </div>);
}

export function SmeEsg() {
  const { d, get, error } = useSme();
  const proofs = useProofCounts('esg');
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading your data…')}</div>;
  const e = d.results.esg as { E: number; S: number; G: number; overall: number; eligible: boolean; level: number; levelName: string; gaps: { text: string; gain: string; go?: string }[] };
  const W = (d.config.esg?.weights ?? null) as Weights | null;
  const pts = (s: Sec, k: string) => {
    if (!W) return '';
    const tot = Object.values(W[s] ?? {}).reduce((a, b) => a + Number(b || 0), 0), w = Number(W[s]?.[k] ?? 0);
    return w ? t('{w} of {tot} points', { w, tot }) : '';
  };
  const h = (text: string, s: Sec, k: string) => [t(text), pts(s, k)].filter(Boolean).join(' · ') || undefined;
  const iso = ((get('certs') ?? []) as { id: string; level?: string }[]).find((c) => c.id === 'iso14001');
  const isoHeld = !!iso?.level && iso.level !== 'none';
  const lti = Number(d.results.safety?.lti ?? 0), entries = Number(d.results.safety?.entries ?? 0);
  const noInc = !!get('people.noIncidents');
  const low = (['Environment', 'Social', 'Governance'] as const).filter((_, i) => [e.E, e.S, e.G][i]! < 30);
  const started = Object.keys(d.meta).length > 0;
  const proven = POLICIES.filter(([, k]) => (proofs?.[k] ?? 0) > 0).length;
  return (
    <div className="cb-stack">
      <SmeHead lede={t('Mapped to what listed customers ask under BRSR Core. About ten minutes. Scores update as you answer.')} />

      <Kpis>
        <Kpi label={t('Overall readiness')} value={<>{f0(e.overall)}%{d.company.isExample && <Sample />}</>} unit={e.level ? `Level ${e.level} · ${e.levelName}` : LEVELS[0]} good={e.level > 0} />
        <Kpi label={t('Environment')} value={`${f0(e.E)}%`} unit={e.E < 30 ? t('Below the 30% floor') : t('Above the 30% floor')} />
        <Kpi label={t('Social')} value={`${f0(e.S)}%`} unit={e.S < 30 ? t('Below the 30% floor') : t('Above the 30% floor')} />
        <Kpi label={t('Governance')} value={`${f0(e.G)}%`} unit={e.G < 30 ? t('Below the 30% floor') : t('Above the 30% floor')} />
      </Kpis>

      {!started && <div className="sme-callout">{tn('Nothing entered for {fy} yet. Answer the questions below, and add your power and fuel bills in {link}.', { fy: d.fy, link: <Link to="/sme/emissions">{t('Emissions')}</Link> })}</div>}

      <div className="sme-grid2">
        <div className="card">
          <div className="cb-h"><h2>{t('Readiness level')}</h2><Pill kind={e.level ? 'good' : 'soon'}>{e.level ? `Level ${e.level} · ${e.levelName}` : t('Not yet rated')}</Pill></div>
          <div className="sme-ladder">{[1, 2, 3, 4].map((i) => <div key={i} className={e.level >= i ? 'on' : ''} style={{ height: `${25 + i * 18}%` }}>{i}</div>)}</div>
          <div className="sme-ladder-l"><span>{t('Formative')}<br />30–50%</span><span>{t('Developing')}<br />&gt;50–65%</span><span>{t('Emerging')}<br />&gt;65–80%</span><span>{t('Established')}<br />&gt;80%</span></div>
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {([['Environment', e.E], ['Social', e.S], ['Governance', e.G]] as [string, number][]).map(([l, v]) => (
              <div key={l} className="sme-secbar"><span>{l}</span><div className="sme-track"><b style={{ width: `${Math.min(100, v)}%`, background: v < 30 ? 'var(--warn)' : undefined }} /><em /></div><span className="num">{f0(v)}%</span></div>))}
          </div>
          {e.eligible
            ? <p className="cb-muted-note">{t('Every section is at 30% or more, so a level can be given. The overall score is the average of the three sections.')}</p>
            : <div className="sme-callout warn" style={{ marginTop: 12 }}>{t(low.length === 1 ? '{list} is below 30%.' : '{list} are below 30%.', { list: low.map((x) => t(x)).join(` ${t('and')} `) })} {t('Each section needs at least 30% before any level is given, whatever the overall score. The marker on each bar shows that floor.')}</div>}
        </div>
        <div className="card">
          <h2>{t('What would lift your level')}</h2>
          <p className="cb-sub">{t('The quickest gains, with the points each one adds.')}</p>
          {e.gaps.map((g) => <Req key={g.text} title={g.text} pill={g.gain} kind="good" action={g.go ? <Link to={`/sme/${g.go}`}>{t('Open {page}', { page: g.go === 'certs' ? t('Certifications') : g.go === 'dpdp' ? t('DPDP') : g.go === 'people' ? t('People & safety') : g.go })}</Link> : null} />)}
          {!e.gaps.length && <p className="muted">{t('All the main checks are done.')}</p>}
        </div>
      </div>

      <div className="card sme-ev-head" style={{ marginBottom: 0 }}>
        <div style={{ flex: '1 1 300px' }}><h2 style={{ margin: 0 }}>{t('Proof of your policies')}</h2>
          <p className="cb-sub" style={{ margin: '4px 0 0' }}>{t('Buyers, banks and CAs ask to see the documents. Tick a policy below, then attach the signed copy under it.')}</p></div>
        {proofs && <ProofCount have={proven} of={POLICIES.length} what={t('policies have proof')} />}
      </div>

      <div className="sme-grid2">
        <div className="card">
          <div className="cb-h"><h2>{t('Environment')}</h2><b className="num">{f0(e.E)}%</b></div>
          <From label={t('Energy use tracked')} hint={t('Grid electricity or diesel entered')} ok={Number(get('emissions.grid')) > 0 || Number(get('emissions.diesel')) > 0} go="emissions" goLabel="Emissions" pts={pts('env', 'energy_tracked')} />
          <From label={t('Renewable electricity')} hint={t('Any rooftop solar used')} ok={Number(d.results.emissions?.renewablePct ?? 0) > 0} go="emissions" goLabel="Emissions" pts={pts('env', 'renewables')} />
          <Num path="esg.water" label={t('Water withdrawn')} unit="kL" hint={h('Yearly, from water bills or meter', 'env', 'water_tracked')} />
          <Num path="esg.waste" label={t('Waste generated')} unit="t" hint={h('All solid and hazardous waste', 'env', 'waste_tracked')} />
          <Num path="esg.recycled" label={t('Waste recycled or reused')} unit="%" hint={h('50% or more counts', 'env', 'recycling_50')} />
          <Toggle path="esg.target" label={t('We have an energy or emission reduction target')} hint={pts('env', 'target') || undefined} />
          <Proof path="esg.target" item="target" />
          <From label={t('ISO 14001 or similar system')} hint={isoHeld ? `${t('Status:')} ${iso?.level === 'inprogress' ? t('in progress') : t(iso?.level)}` : t('Not held')} ok={isoHeld} go="certs" goLabel="Certifications" pts={pts('env', 'ems')} />
        </div>
        <div className="card">
          <div className="cb-h"><h2>{t('Social')}</h2><b className="num">{f0(e.S)}%</b></div>
          <From label={t('Headcount recorded')} hint={Number(get('profile.employees')) > 0 ? `${f0(get('profile.employees'))} employees` : t('Not entered')} ok={Number(get('profile.employees')) > 0} go="profile" goLabel="Profile" pts={pts('soc', 'headcount')} />
          <Num path="esg.women" label={t('Women in the workforce')} unit="%" hint={h('Share of all employees and workers', 'soc', 'women_recorded')} />
          <Num path="esg.training" label={t('Training per employee')} unit="hrs" hint={h('Average hours a year', 'soc', 'training')} />
          <From label={t('Safety log kept')} hint={entries ? `${t(entries === 1 ? '{n} entry' : '{n} entries', { n: entries })}, ${t(lti === 1 ? '{n} lost-time injury' : '{n} lost-time injuries', { n: lti })}` : noInc ? t('No incidents this year') : t('Nothing logged')} ok={entries > 0 || noInc} go="people" goLabel="Safety log" pts={[pts('soc', 'safety_log'), (entries > 0 || noInc) && lti === 0 && pts('soc', 'zero_lti') ? t('+{n} for no lost-time injuries', { n: pts('soc', 'zero_lti') }) : ''].filter(Boolean).join(', ')} />
          <Toggle path="people.noIncidents" label={t('No safety incidents this year')} hint={t('Tick only if the safety log is empty because nothing happened')} disabled={entries > 0} />
          <Toggle path="esg.minwage" label={t('All workers paid at least minimum wage')} hint={pts('soc', 'min_wage') || undefined} />
          <Toggle path="esg.posh" label={t('Internal Committee under the POSH Act')} hint={pts('soc', 'posh') || undefined} />
          <Proof path="esg.posh" item="posh" />
        </div>
        <div className="card">
          <div className="cb-h"><h2>{t('Governance')}</h2><b className="num">{f0(e.G)}%</b></div>
          <Toggle path="esg.coc" label={t('Written code of conduct')} hint={pts('gov', 'coc') || undefined} />
          <Proof path="esg.coc" item="coc" />
          <Toggle path="esg.abc" label={t('Anti-bribery policy')} hint={pts('gov', 'abc') || undefined} />
          <Proof path="esg.abc" item="abc" />
          <Toggle path="esg.grievance" label={t('Grievance channel for workers and communities')} hint={pts('gov', 'grievance') || undefined} />
          <Proof path="esg.grievance" item="grievance" />
          <Toggle path="esg.privacy" label={t('Data privacy policy (DPDP Act)')} hint={pts('gov', 'privacy') || undefined} />
          <Proof path="esg.privacy" item="privacy" />
          <Toggle path="esg.supplierCode" label={t('Supplier code of conduct')} hint={pts('gov', 'supplier_code') || undefined} />
          <Proof path="esg.supplierCode" item="supplier_code" />
          <Toggle path="esg.ownerEsg" label={t('A named owner or director responsible for ESG')} hint={pts('gov', 'owner_esg') || undefined} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>{tn('This readiness score is EKOTRACE’s own quick check. For the ICAI maturity level that buyers and banks recognise, complete {link}.', { link: <Link to="/sme/srmm">SRMM</Link> })}</p>
    </div>);
}
