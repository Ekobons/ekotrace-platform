/**
 * Schemes: government and bank support matched to the company (likely / check first), how to apply, and an application
 * tracker per scheme (status, dates, amounts, reference number, documents checklist, proof). The tracker is stored in
 * the 'schemes' module as { apps: { [schemeId]: App } }; totals of support sanctioned and received are shown on top.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import './rules.css';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead } from './ui';
import { Evidence } from './Evidence';
import { dmy, f0, lakh, n } from '../../lib/sme';
import { t, tn } from './i18n';

const inr = (v: number) => (v < 1e5 ? `₹${f0(v)}` : lakh(v));

type Status = 'not_started' | 'applied' | 'sanctioned' | 'received' | 'rejected';
type Scheme = { id: string; title: string; detail: string; eligible: boolean; label: string; note: string; link: string | null; docs?: string[]; status?: Status; sanctioned?: number; received?: number };
interface App { status?: Status; applied?: string; sanctionedOn?: string; receivedOn?: string; sanctioned?: number | ''; received?: number | ''; ref?: string; docs?: Record<string, boolean>; note?: string }

const STATUS: [Status, string, string][] = [
  ['not_started', 'Not started', 'watch'], ['applied', 'Applied', 'likely'], ['sanctioned', 'Sanctioned', 'likely'], ['received', 'Received|status', 'good'], ['rejected', 'Rejected', 'apply'],
];
const stName = (s: Status | undefined) => STATUS.find((x) => x[0] === (s ?? 'not_started'))!;
const STEP: Record<Status, number> = { not_started: 0, applied: 1, sanctioned: 2, received: 3, rejected: 1 };

/** How to apply, per scheme. Kept short and general: terms change, the official portal is the reference. */
const HOW: Record<string, { steps: string[]; go?: [string, string] }> = {
  adeetie: { steps: ['Check your industrial cluster is on the BEE ADEETIE list.', 'Get an investment-grade energy audit (BEE empanelled auditor).', 'Apply on the BEE portal with the audit and a loan sanction from a participating bank.'], go: ['bills', 'See your bill savings'] },
  zed: { steps: ['Register on the MSME ZED portal with your Udyam number.', 'Take the ZED pledge and apply for Bronze.', 'Complete the online self-assessment; the certificate follows a desk review.'], go: ['certs', 'Track it in Certifications'] },
  lean: { steps: ['Register on the MSME LEAN portal with your Udyam number.', 'Take the LEAN pledge and start at Basic level.', 'Choose a consultant from the portal for Intermediate and Advanced levels.'] },
  cgtmse: { steps: ['Ask your bank for a CGTMSE-covered loan when you apply.', 'The bank applies for the guarantee; you pay no collateral.', 'The yearly guarantee fee is usually passed on in the loan cost.'], go: ['loan', 'Build the loan pack'] },
  mcgs: { steps: ['Get quotations for the plant and machinery.', 'Apply for the term loan at your bank and ask for MCGS-MSME cover.', 'The bank registers the loan with NCGTC.'], go: ['loan', 'Build the loan pack'] },
  sidbi: { steps: ['Get quotes for the equipment or rooftop solar.', 'Approach a SIDBI branch or apply online with the quotes and your last two years’ financials.', 'Use the green-loan pack to show the savings and emissions cut.'], go: ['loan', 'Build the loan pack'] },
  state_subsidy: { steps: ['Ask the District Industries Centre (DIC) which incentives your district and investment qualify for.', 'Get the eligibility certificate before or soon after the investment, as the policy requires.', 'Claim the subsidy with invoices, loan papers and a CA certificate.'] },
  state_solar: { steps: ['Read your DISCOM’s net-metering rules and connected-load limit.', 'Apply for net metering on the DISCOM portal before installing.', 'Ask the state nodal agency about any MSME capital support.'], go: ['solar', 'Size your rooftop system'] },
  pmegp: { steps: ['Apply on the PMEGP e-portal with a project report.', 'The KVIC, KVIB or DIC office scrutinises it and sends it to a bank.', 'Complete the entrepreneurship training before the subsidy is released.'] },
  ccts_offset: { steps: ['Add your solar or efficiency project to the EKOTRACE pool.', 'EKOTRACE bundles projects and handles one shared registration.', 'Revenue from credits is shared yearly.'], go: ['credits', 'Open Carbon credits'] },
};

export function SmeSchemes() {
  const { d, setModule } = useSme();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const list = (d.results.schemes ?? []) as Scheme[];
  const p = (d.data.profile ?? {}) as any, cls = d.results.msmeClass as string;
  const raw = (d.data.schemes ?? {}) as { apps?: Record<string, App> };
  const apps = raw.apps ?? {};
  const can = d.canEdit;
  const upd = (id: string, v: Partial<App>) => setModule('schemes', { ...raw, apps: { ...apps, [id]: { ...apps[id], ...v } } });
  const statusOf = (id: string): Status => apps[id]?.status ?? 'not_started';
  const tracked = list.filter((x) => statusOf(x.id) !== 'not_started');
  const sanctioned = list.filter((x) => ['sanctioned', 'received'].includes(statusOf(x.id))).reduce((a, x) => a + n(apps[x.id]?.sanctioned), 0);
  const received = list.filter((x) => statusOf(x.id) !== 'rejected').reduce((a, x) => a + n(apps[x.id]?.received), 0);
  const yes = list.filter((x) => x.eligible), maybe = list.filter((x) => !x.eligible);
  const gaps: string[] = [];
  if (!p.udyam) gaps.push('Udyam registration is not marked in your profile; most MSME schemes need it.');
  if (cls === 'Large') gaps.push('Your turnover puts you above the MSME limit, so MSME-only schemes do not apply.');
  if (!n(p.turnover)) gaps.push('Turnover is not entered, so your MSME class is a guess.');
  const why = (x: Scheme) => {
    const r: string[] = [];
    if (x.id === 'pmegp') return 'For new micro units, or an upgrade of an existing PMEGP unit.';
    if (!p.udyam || cls === 'Large') r.push(!p.udyam ? t('needs Udyam registration') : t('for MSMEs only'));
    if (d.company.sector === 'svc' && /adeetie|lean|mcgs/.test(x.id)) r.push('for manufacturers');
    if (x.id === 'cgtmse' && cls === 'Medium') r.push('for micro and small enterprises');
    return r.length ? `Not matched yet: ${r.join(', ')}.` : 'Check the conditions on the portal.';
  };

  const tracker = (x: Scheme) => {
    const a = apps[x.id] ?? {}, st = statusOf(x.id), docs = x.docs ?? [];
    const ready = docs.filter((_, i) => a.docs?.[i]).length;
    return (
      <div className="ru-tracker sv-span">
        <div className="ru-h2row"><b style={{ flex: 1 }}>{t('Your application')}</b><Pill kind={stName(st)[2]}>{stName(st)[1]}</Pill></div>
        <div className={`ru-steps${st === 'rejected' ? ' bad' : ''}`} aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={STEP[st] >= i ? 'on' : ''} />)}</div>
        <div className="ru-track">
          <label><span>{t('Status')}</span><select className="input" disabled={!can} value={st} onChange={(e) => upd(x.id, { status: e.target.value as Status })}>{STATUS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
          <label><span>{t('Applied on')}</span><input className="input" type="date" disabled={!can} value={a.applied ?? ''} onChange={(e) => upd(x.id, { applied: e.target.value })} /></label>
          <label><span>{t('Reference no.')}</span><input className="input" disabled={!can} value={a.ref ?? ''} onChange={(e) => upd(x.id, { ref: e.target.value })} /></label>
          <label><span>{t('Sanctioned on')}</span><input className="input" type="date" disabled={!can} value={a.sanctionedOn ?? ''} onChange={(e) => upd(x.id, { sanctionedOn: e.target.value })} /></label>
          <label><span>{t('Amount sanctioned (₹)')}</span><input className="input num" type="number" min={0} step="any" disabled={!can} value={a.sanctioned ?? ''} onChange={(e) => upd(x.id, { sanctioned: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
          <label><span>{t('Received on')}</span><input className="input" type="date" disabled={!can} value={a.receivedOn ?? ''} onChange={(e) => upd(x.id, { receivedOn: e.target.value })} /></label>
          <label><span>{t('Amount received (₹)')}</span><input className="input num" type="number" min={0} step="any" disabled={!can} value={a.received ?? ''} onChange={(e) => upd(x.id, { received: e.target.value === '' ? '' : Number(e.target.value) })} /></label>
          <label className="wide"><span>{t('Note')}</span><input className="input" disabled={!can} value={a.note ?? ''} placeholder={t('e.g. Bank asked for the energy audit report')} onChange={(e) => upd(x.id, { note: e.target.value })} /></label>
        </div>
        {docs.length > 0 && <>
          <p className="lbl" style={{ margin: '14px 0 2px' }}>{t('Documents to keep ready')} · {t('{a} of {b}', { a: ready, b: docs.length })}</p>
          <div className="ru-checks">{docs.map((doc, i) => (
            <label key={doc} className={`ru-check${a.docs?.[i] ? ' on' : ''}`}><input type="checkbox" disabled={!can} checked={!!a.docs?.[i]} onChange={(e) => upd(x.id, { docs: { ...a.docs, [i]: e.target.checked } })} /><span>{t(doc)}</span></label>))}</div>
        </>}
        <div style={{ marginTop: 10 }}><Evidence module="schemes" item={x.id} label={t('Application, sanction letter, receipts')} /></div>
      </div>);
  };

  const card = (x: Scheme) => {
    const how = HOW[x.id], st = statusOf(x.id), show = open[x.id] ?? st !== 'not_started';
    return (
      <div className="sv-item" key={x.id}>
        <h3>{t(x.title)} <Pill kind={x.eligible ? 'good' : 'watch'}>{x.label}</Pill>{st !== 'not_started' && <> <Pill kind={stName(st)[2]}>{stName(st)[1]}</Pill></>}</h3>
        <div />
        <div className="sv-body sv-scheme">
          <div className="sv-col">
            <p><span className="lbl">{t('What it gives')}</span><br />{x.detail}</p>
            {x.eligible ? (x.note && <div className="sv-do"><b>{t('For you:')}</b> {x.note}</div>) : <div className="note warn">{why(x)}{x.note ? ` ${x.note}` : ''}</div>}
          </div>
          {how && <div><span className="lbl">{t('How to apply')}</span><ol className="sv-steps" style={{ marginTop: 8 }}>{how.steps.map((s) => <li key={s}><span>{t(s)}</span></li>)}</ol></div>}
          <div className="row sv-span">
            {x.link && <a className="btn sm" href={x.link} target="_blank" rel="noopener noreferrer">{t('Official portal')}<span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> {t('for {name} (opens in a new tab)', { name: x.title })}</span></a>}
            {how?.go && <Link className="btn sm ghost" to={`/sme/${how.go[0]}`}>{t(how.go[1])}</Link>}
            {(can || st !== 'not_started') && <button type="button" className="btn sm ghost" aria-expanded={show} onClick={() => setOpen({ ...open, [x.id]: !show })}>{show ? t('Hide application') : st === 'not_started' ? t('Track an application') : t('Show application')}</button>}
          </div>
          {show && tracker(x)}
        </div>
      </div>);
  };

  return (
    <>
      <SmeHead lede={t('Government and bank support matched to your profile and figures, and a tracker for each application. Terms change, so confirm on the official portal before you apply.')} />
      <Kpis>
        <Kpi label={t('Likely for you')} value={yes.length} unit={t('of {n} schemes', { n: list.length })} good={yes.length > 0} />
        <Kpi label={t('Applications')} value={tracked.length} unit={tracked.length ? (() => { const w = tracked.filter((x) => statusOf(x.id) === 'applied').length; return w ? `${w} waiting for a decision` : 'none waiting'; })() : t('none tracked yet')} />
        <Kpi label={t('Support sanctioned')} value={sanctioned ? inr(sanctioned) : '—'} unit={t('from tracked schemes')} />
        <Kpi label={t('Support received')} value={received ? inr(received) : '—'} good={received > 0} unit={`${t('MSME class')}: ${cls ? t(cls) : '—'}`} />
      </Kpis>
      {gaps.length > 0 && <div className="sme-callout warn">{gaps.map((g) => t(g)).join(' ')} {tn('{link} to match more schemes.', { link: <Link to="/sme/profile">{t('Update your profile')}</Link> })}</div>}
      {!list.length && <div className="card empty">{tn('No schemes to show yet. Complete your {link} first.', { link: <Link to="/sme/profile">{t('profile')}</Link> })}</div>}

      {tracked.length > 0 && (
        <div className="card">
          <div className="sv-h2row"><h2>{t('Your applications')}</h2><span className="muted small">{t('{n} tracked', { n: tracked.length })}</span></div>
          <div className="sme-scroll"><table className="sme-tbl">
            <thead><tr><th>{t('Scheme')}</th><th>{t('Status')}</th><th>{t('Applied')}</th><th>{t('Reference')}</th><th className="r">{t('Sanctioned')}</th><th className="r">{t('Received')}</th></tr></thead>
            <tbody>{tracked.map((x) => { const a = apps[x.id] ?? {}; const s = stName(statusOf(x.id)); return (
              <tr key={x.id}><td>{t(x.title)}</td><td><Pill kind={s[2]}>{s[1]}</Pill></td><td>{a.applied ? dmy(a.applied) : '—'}</td><td>{a.ref || '—'}</td>
                <td className="r">{n(a.sanctioned) ? inr(n(a.sanctioned)) : '—'}</td><td className="r">{n(a.received) ? inr(n(a.received)) : '—'}</td></tr>); })}</tbody>
            <tfoot><tr className="tot"><td colSpan={4}>{t('Total')}</td><td className="r">{inr(sanctioned)}</td><td className="r">{inr(received)}</td></tr></tfoot>
          </table></div>
        </div>)}

      {yes.length > 0 && <div className="card"><div className="sv-h2row"><h2>{t('Likely for you')}</h2><span className="muted small">{t('{n} schemes', { n: yes.length })}</span></div>{yes.map(card)}</div>}
      {maybe.length > 0 && <div className="card"><div className="sv-h2row"><h2>{t('Check first')}</h2><span className="muted small">{t('You may qualify once the gap is closed')}</span></div>{maybe.map(card)}</div>}
    </>);
}
