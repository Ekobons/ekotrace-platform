/**
 * Share & validate: the buyers, clusters, banks and CA firms linked to this company, with the owner's consent
 * switch per link (and exactly what each partner sees), plus CA validation of the SRMM level.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../App';
import { useSme } from './store';
import { Kpi, Kpis, Pill, Sample, SmeHead, Toggle } from './ui';
import { smeApi, dmy, f1, LEVELS, type SmeCaRequest, type SmeLink } from '../../lib/sme';
import './share.css';
import { t, tn } from './i18n';

const KIND: Record<string, string> = { buyer: 'Buyer', cluster: 'Industry cluster', bank: 'Bank', ca_firm: 'CA firm' };
const SEES: Record<string, string> = {
  buyer: 'your company name, industry and state; Scope 1 + 2 and Scope 3 emissions; ESG readiness level; SRMM score and level; CBAM emissions per tonne (only if you export to the EU); and whether a CA has validated your score.',
  bank: 'your company name and industry; Scope 1 + 2 emissions, which the bank combines with its own loan to you to report financed emissions; whether rooftop solar suits your site; and whether a CA has validated your score.',
  cluster: 'only totals and ranges across members, never your name or your own figures (emission intensity spread, main emission sources, readiness levels, savings found, solar capacity). These show only once at least 5 members share and only if you are in the benchmark below.',
  ca_firm: 'nothing through this switch. A CA firm reads your data only for a validation request that the EKOTRACE team assigns to it: your SRMM scores, ESG answers, certificates and calculated figures for that one year.',
};
const OFF: Record<string, string> = {
  buyer: 'only that you are linked: your name, industry, state and their own purchase share. Your figures show as “not shared”.',
  bank: 'only that you are linked, with their own loan figures. Your emissions show as “awaiting consent”.',
  cluster: 'that you are a member. You are left out of every total.',
  ca_firm: 'only that you are linked.',
};
const STATUS: Record<string, [string, string]> = {
  requested: ['Waiting for a CA', 'soon'], assigned: ['CA assigned', 'soon'], in_review: ['In review', 'soon'],
  validated: ['Validated', 'done'], rejected: ['Not validated', 'apply'],
};
const OPEN = ['requested', 'assigned', 'in_review'];

export function SmeShare() {
  const { d, fy, error } = useSme();
  const { can, toast } = useApp();
  const owner = can('super_admin');
  const [links, setLinks] = useState<SmeLink[] | null>(null);
  const [linksErr, setLinksErr] = useState('');
  const [ca, setCa] = useState<SmeCaRequest[] | null>(null);
  const [caErr, setCaErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const [asking, setAsking] = useState(false);

  const loadCa = () => smeApi.caRequests().then((r) => { setCa(r.items); setCaErr(''); }).catch((e: Error) => setCaErr(e.message));
  useEffect(() => {
    smeApi.links().then((r) => setLinks(r.links)).catch((e: Error) => setLinksErr(e.message));
    loadCa();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const r = d.results, sr = r.srmm;

  const setShare = async (l: SmeLink, on: boolean) => {
    setBusy(l.id);
    try {
      await smeApi.setShare(l.id, on);
      const now = new Date().toISOString();
      setLinks((p) => p && p.map((x) => (x.id === l.id ? { ...x, share: on, consent_at: on ? now : x.consent_at, revoked_at: on ? null : now } : x)));
      toast(t(on ? 'Sharing with {name}' : 'Stopped sharing with {name}', { name: l.name }));
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  const askCa = async () => {
    setAsking(true); setCaErr('');
    try { await smeApi.requestCa(fy, publish); await loadCa(); toast(t('CA validation requested')); }
    catch (e) { setCaErr((e as Error).message); }
    finally { setAsking(false); }
  };

  const sharing = (links ?? []).filter((l) => l.share).length;
  const mine = (ca ?? []).filter((c) => c.fy === fy);
  const openReq = mine.find((c) => OPEN.includes(c.status));
  const validated = mine.find((c) => c.status === 'validated');
  const latest = mine[0];
  const bench = !!d.data.share?.bench;
  const clusterOn = (links ?? []).some((l) => l.kind === 'cluster' && l.share);
  const sections = (['A', 'B', 'C'] as const).map((k) => ({ k, ...(sr.sections[k] as { pct: number; eligible: boolean; open: number; got: number; min: number; max: number }) }));

  return (
    <>
      <SmeHead lede={t('You decide who sees your figures. Nothing reaches a buyer, bank or cluster until you switch sharing on, and you can switch it off at any time.')} />
      <Kpis>
        <Kpi label={t('Partners linked')} value={links ? links.length : '…'} />
        <Kpi label={t('Sharing with')} value={links ? sharing : '…'} unit={links ? `of ${links.length}` : undefined} />
        <Kpi label={t('SRMM self-assessed')} value={`${f1(sr.pct * 100)}%`} unit={sr.level ? `Level ${sr.level} · ${LEVELS[sr.level]}` : t('Below Level 1')} />
        <Kpi label={t('CA validation')} value={latest ? STATUS[latest.status]?.[0] ?? latest.status : 'Not asked'} unit={fy} good={!!validated} />
      </Kpis>

      <div className="sme-grid2">
        <div className="card">
          <div className="row"><h2 className="grow">{t('Partners and consent')}</h2>{d.company.isExample && <Sample />}</div>
          <p className="muted" style={{ margin: '4px 0 6px', fontSize: 13 }}>{t('Partners appear here when they invite you. Each switch is your consent for that one partner, recorded with date and your name.')}</p>
          {linksErr && <div className="note bad" role="alert">{linksErr}</div>}
          {!links && !linksErr && <p className="muted">{t('Loading partners…')}</p>}
          {links && !links.length && <div className="empty" style={{ padding: '24px 8px' }}>{t('No buyer, bank or cluster has linked to you yet. When one invites you, it appears here and you decide whether to share.')}</div>}
          {links?.map((l) => {
            const k = l.kind ?? '', id = `sms-${l.id}`;
            return (
              <div key={l.id} className="sms-link">
                <label htmlFor={id}><h3>{l.name}</h3>
                  <span className="meta">{KIND[k] ? t(KIND[k]) : t('Partner')}{l.city ? ` · ${l.city}` : ''} · {l.share ? t('Shared since {date}', { date: dmy(l.consent_at) }) : l.revoked_at ? t('Stopped {date}', { date: dmy(l.revoked_at) }) : t('Not shared yet')}</span></label>
                <span className="row" style={{ gap: 8 }}>
                  <Pill kind={l.share ? 'good' : 'watch'}>{l.share ? t('Sharing') : t('Off')}</Pill>
                  <span className="sme-sw"><input id={id} type="checkbox" checked={l.share} disabled={!owner || busy === l.id} onChange={(e) => setShare(l, e.target.checked)} aria-label={t('Share with {name}', { name: l.name })} /><i /></span>
                </span>
                <div className="sees">{l.share ? <><b>{t('They see')}</b> {t(SEES[k] ?? 'your summary figures.')}</> : <><b>{t('Now they see')}</b> {t(OFF[k] ?? 'only that you are linked.')}<br /><b>{t('If you switch on, they see')}</b> {t(SEES[k] ?? 'your summary figures.')}</>}</div>
              </div>);
          })}
          {!owner && links && links.length > 0 && <p className="note info" style={{ marginTop: 10 }}>{t('Only the company owner (super admin) can change consent. You can see who has access.')}</p>}
        </div>

        <div className="card">
          <h2>{t('Benchmark')}</h2>
          <Toggle path="share.bench" label={t('Include my figures in the anonymous SME benchmark')} hint={t('Your name is never shown. Clusters and the sector benchmark see only group totals of at least 5 companies.')} disabled={!owner} />
          {clusterOn && !bench && <p className="note warn" style={{ marginTop: 8 }}>{t('You share with a cluster but are not in the benchmark, so the cluster’s totals leave you out.')}</p>}
          <h2 style={{ marginTop: 18 }}>{t('Never shared')}</h2>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5 }}>{t('No partner ever sees your bills, invoices, individual entries, worker grievances or uploaded documents. Partners see the summary figures listed against each partner, for the years you share.')}</p>
        </div>
      </div>

      <div className="card">
        <div className="row"><h2 className="grow">{t('CA validation of your SRMM level')}</h2><Link to="/sme/srmm">{t('Open SRMM')}</Link></div>
        <p className="muted" style={{ margin: '6px 0 10px', fontSize: 13.5, maxWidth: '80ch' }}>{t('A Chartered Accountant reviews your SRMM self-assessment and evidence and gives limited assurance on your level. Buyers see “validated” next to your score, and banks treat validated figures as the best data quality.')}</p>
        {caErr && <div className="note bad" role="alert" style={{ marginBottom: 10 }}>{caErr}</div>}

        {openReq ? <div className="sme-callout">{tn(openReq.ca_firm ? 'Your request for {fy} is open: {status} with {firm}. The CA will contact you to plan the review.' : 'Your request for {fy} is open: {status}. The CA will contact you to plan the review.', { fy, status: <b>{t(STATUS[openReq.status]?.[0])}</b>, firm: openReq.ca_firm })}</div>
          : validated ? <div className="sme-callout">{t('{fy} is validated: {pct}%, Level {n} · {name}.', { fy, pct: f1(validated.validated_pct), n: validated.validated_level, name: t(LEVELS[validated.validated_level ?? 0]) })}</div>
          : !sr.eligible ? (
            <div className="sme-callout warn">
              <b>{t('Not ready for CA validation yet.')}</b> {t('ICAI awards a level only when each of the three SRMM sections scores at least 30%.')} {sr.open ? t('{n} indicators are still unscored.', { n: sr.open }) : ''}
              <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8, background: 'transparent' }}>
                <thead><tr><th>{t('Section')}</th><th className="r">{t('Score')}</th><th className="r">{t('Needed')}</th><th className="r">{t('Unscored')}</th><th /></tr></thead>
                <tbody>{sections.map((s) => (
                  <tr key={s.k}><td>{t('Section {k}', { k: s.k })}</td><td className="r">{f1(s.pct * 100)}%</td><td className="r">30%</td><td className="r">{s.open}</td>
                    <td className="r"><Pill kind={s.eligible ? 'good' : 'soon'}>{s.eligible ? t('Meets 30%') : t('{n} points short', { n: f1(s.min - s.got) })}</Pill></td></tr>))}
                </tbody></table></div>
              <div style={{ marginTop: 8 }}><Link to="/sme/srmm">{t('Score the open indicators in SRMM')}</Link></div>
            </div>)
          : !owner ? <p className="note info">{t('Your SRMM self-assessment ({pct}%, {label}) is ready for validation. Only the company owner (super admin) can ask a CA to validate it.', { pct: f1(sr.pct * 100), label: t(sr.label) })}</p>
          : (
            <div className="sme-callout">
              <b>{t('Ready to validate.')}</b> {t('Self-assessed {pct}%, {label}, for {fy}.', { pct: f1(sr.pct * 100), label: t(sr.label), fy })}
              <label className="sms-check"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />{t('Show my validated score on ICAI’s public list of SRMM companies')}</label>
              <div style={{ marginTop: 10 }}><button className="btn p" type="button" disabled={asking} onClick={askCa}>{asking ? t('Sending…') : `Ask a CA to validate ${fy}`}</button></div>
            </div>)}

        <h3 className="lbl" style={{ margin: '18px 0 4px' }}>{t('Your requests')}</h3>
        {!ca && !caErr && <p className="muted">{t('Loading…')}</p>}
        {ca && !ca.length && <p className="muted" style={{ margin: 0 }}>{t('No requests yet.')}</p>}
        {ca && ca.length > 0 && (
          <div className="sme-scroll"><table className="sme-tbl">
            <thead><tr><th>{t('Year')}</th><th>{t('Status')}</th><th className="r">{t('Self-assessed')}</th><th className="r">{t('Validated')}</th><th>{t('CA firm')}</th><th>{t('Asked on')}</th></tr></thead>
            <tbody>{ca.map((c) => (
              <tr key={c.id}><td>{c.fy}<br /><span className="muted small">{c.srmm_version === 'svc' ? t('Services v3.2') : t('Manufacturing v3.1')}</span></td>
                <td><Pill kind={STATUS[c.status]?.[1] ?? 'watch'}>{t(STATUS[c.status]?.[0] ?? c.status)}</Pill>{c.publish_on_icai && <><br /><span className="muted small">{t('To be shown on ICAI list')}</span></>}{c.notes && <><br /><span className="muted small">{c.notes}</span></>}</td>
                <td className="r">{c.self_pct != null ? `${f1(c.self_pct)}%` : '—'}</td>
                <td className="r">{c.status === 'validated' ? <>{f1(c.validated_pct)}%<br /><span className="muted small">{t('Level {n}', { n: c.validated_level })} · {t(LEVELS[c.validated_level ?? 0])}</span></> : '—'}</td>
                <td>{c.ca_firm ?? <span className="muted">{t('Not assigned yet')}</span>}{c.reviewer_name && <><br /><span className="muted small">{c.reviewer_name}</span></>}</td>
                <td>{dmy(c.created_at)}</td></tr>))}
            </tbody></table></div>)}
      </div>
    </>);
}
