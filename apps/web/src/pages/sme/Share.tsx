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
  if (!d) return <div className="card empty">Loading…</div>;
  const r = d.results, sr = r.srmm;

  const setShare = async (l: SmeLink, on: boolean) => {
    setBusy(l.id);
    try {
      await smeApi.setShare(l.id, on);
      const now = new Date().toISOString();
      setLinks((p) => p && p.map((x) => (x.id === l.id ? { ...x, share: on, consent_at: on ? now : x.consent_at, revoked_at: on ? null : now } : x)));
      toast(on ? `Sharing with ${l.name}` : `Stopped sharing with ${l.name}`);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  const askCa = async () => {
    setAsking(true); setCaErr('');
    try { await smeApi.requestCa(fy, publish); await loadCa(); toast('CA validation requested'); }
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
      <SmeHead lede="You decide who sees your figures. Nothing reaches a buyer, bank or cluster until you switch sharing on, and you can switch it off at any time." />
      <Kpis>
        <Kpi label="Partners linked" value={links ? links.length : '…'} />
        <Kpi label="Sharing with" value={links ? sharing : '…'} unit={links ? `of ${links.length}` : undefined} />
        <Kpi label="SRMM self-assessed" value={`${f1(sr.pct * 100)}%`} unit={sr.level ? `Level ${sr.level} · ${LEVELS[sr.level]}` : 'Below Level 1'} />
        <Kpi label="CA validation" value={latest ? STATUS[latest.status]?.[0] ?? latest.status : 'Not asked'} unit={fy} good={!!validated} />
      </Kpis>

      <div className="sme-grid2">
        <div className="card">
          <div className="row"><h2 className="grow">Partners and consent</h2>{d.company.isExample && <Sample />}</div>
          <p className="muted" style={{ margin: '4px 0 6px', fontSize: 13 }}>Partners appear here when they invite you. Each switch is your consent for that one partner, recorded with date and your name.</p>
          {linksErr && <div className="note bad" role="alert">{linksErr}</div>}
          {!links && !linksErr && <p className="muted">Loading partners…</p>}
          {links && !links.length && <div className="empty" style={{ padding: '24px 8px' }}>No buyer, bank or cluster has linked to you yet. When one invites you, it appears here and you decide whether to share.</div>}
          {links?.map((l) => {
            const k = l.kind ?? '', id = `sms-${l.id}`;
            return (
              <div key={l.id} className="sms-link">
                <label htmlFor={id}><h3>{l.name}</h3>
                  <span className="meta">{KIND[k] ?? 'Partner'}{l.city ? ` · ${l.city}` : ''} · {l.share ? `Shared since ${dmy(l.consent_at)}` : l.revoked_at ? `Stopped ${dmy(l.revoked_at)}` : 'Not shared yet'}</span></label>
                <span className="row" style={{ gap: 8 }}>
                  <Pill kind={l.share ? 'good' : 'watch'}>{l.share ? 'Sharing' : 'Off'}</Pill>
                  <span className="sme-sw"><input id={id} type="checkbox" checked={l.share} disabled={!owner || busy === l.id} onChange={(e) => setShare(l, e.target.checked)} aria-label={`Share with ${l.name}`} /><i /></span>
                </span>
                <div className="sees">{l.share ? <><b>They see</b> {SEES[k] ?? 'your summary figures.'}</> : <><b>Now they see</b> {OFF[k] ?? 'only that you are linked.'}<br /><b>If you switch on, they see</b> {SEES[k] ?? 'your summary figures.'}</>}</div>
              </div>);
          })}
          {!owner && links && links.length > 0 && <p className="note info" style={{ marginTop: 10 }}>Only the company owner (super admin) can change consent. You can see who has access.</p>}
        </div>

        <div className="card">
          <h2>Benchmark</h2>
          <Toggle path="share.bench" label="Include my figures in the anonymous SME benchmark" hint="Your name is never shown. Clusters and the sector benchmark see only group totals of at least 5 companies." disabled={!owner} />
          {clusterOn && !bench && <p className="note warn" style={{ marginTop: 8 }}>You share with a cluster but are not in the benchmark, so the cluster’s totals leave you out.</p>}
          <h2 style={{ marginTop: 18 }}>Never shared</h2>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5 }}>No partner ever sees your bills, invoices, individual entries, worker grievances or uploaded documents. Partners see the summary figures listed against each partner, for the years you share.</p>
        </div>
      </div>

      <div className="card">
        <div className="row"><h2 className="grow">CA validation of your SRMM level</h2><Link to="/sme/srmm">Open SRMM</Link></div>
        <p className="muted" style={{ margin: '6px 0 10px', fontSize: 13.5, maxWidth: '80ch' }}>A Chartered Accountant reviews your SRMM self-assessment and evidence and gives limited assurance on your level. Buyers see “validated” next to your score, and banks treat validated figures as the best data quality.</p>
        {caErr && <div className="note bad" role="alert" style={{ marginBottom: 10 }}>{caErr}</div>}

        {openReq ? <div className="sme-callout">Your request for {fy} is open: <b>{STATUS[openReq.status]?.[0]}</b>{openReq.ca_firm ? ` with ${openReq.ca_firm}` : ''}. The CA will contact you to plan the review.</div>
          : validated ? <div className="sme-callout">{fy} is validated: {f1(validated.validated_pct)}%, Level {validated.validated_level} · {LEVELS[validated.validated_level ?? 0]}.</div>
          : !sr.eligible ? (
            <div className="sme-callout warn">
              <b>Not ready for CA validation yet.</b> ICAI awards a level only when each of the three SRMM sections scores at least 30%. {sr.open ? `${sr.open} indicators are still unscored.` : ''}
              <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8, background: 'transparent' }}>
                <thead><tr><th>Section</th><th className="r">Score</th><th className="r">Needed</th><th className="r">Unscored</th><th /></tr></thead>
                <tbody>{sections.map((s) => (
                  <tr key={s.k}><td>Section {s.k}</td><td className="r">{f1(s.pct * 100)}%</td><td className="r">30%</td><td className="r">{s.open}</td>
                    <td className="r"><Pill kind={s.eligible ? 'good' : 'soon'}>{s.eligible ? 'Meets 30%' : `${f1(s.min - s.got)} points short`}</Pill></td></tr>))}
                </tbody></table></div>
              <div style={{ marginTop: 8 }}><Link to="/sme/srmm">Score the open indicators in SRMM</Link></div>
            </div>)
          : !owner ? <p className="note info">Your SRMM self-assessment ({f1(sr.pct * 100)}%, {sr.label}) is ready for validation. Only the company owner (super admin) can ask a CA to validate it.</p>
          : (
            <div className="sme-callout">
              <b>Ready to validate.</b> Self-assessed {f1(sr.pct * 100)}%, {sr.label}, for {fy}.
              <label className="sms-check"><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />Show my validated score on ICAI’s public list of SRMM companies</label>
              <div style={{ marginTop: 10 }}><button className="btn p" type="button" disabled={asking} onClick={askCa}>{asking ? 'Sending…' : `Ask a CA to validate ${fy}`}</button></div>
            </div>)}

        <h3 className="lbl" style={{ margin: '18px 0 4px' }}>Your requests</h3>
        {!ca && !caErr && <p className="muted">Loading…</p>}
        {ca && !ca.length && <p className="muted" style={{ margin: 0 }}>No requests yet.</p>}
        {ca && ca.length > 0 && (
          <div className="sme-scroll"><table className="sme-tbl">
            <thead><tr><th>Year</th><th>Status</th><th className="r">Self-assessed</th><th className="r">Validated</th><th>CA firm</th><th>Asked on</th></tr></thead>
            <tbody>{ca.map((c) => (
              <tr key={c.id}><td>{c.fy}<br /><span className="muted small">{c.srmm_version === 'svc' ? 'Services v3.2' : 'Manufacturing v3.1'}</span></td>
                <td><Pill kind={STATUS[c.status]?.[1] ?? 'watch'}>{STATUS[c.status]?.[0] ?? c.status}</Pill>{c.publish_on_icai && <><br /><span className="muted small">To be shown on ICAI list</span></>}{c.notes && <><br /><span className="muted small">{c.notes}</span></>}</td>
                <td className="r">{c.self_pct != null ? `${f1(c.self_pct)}%` : '—'}</td>
                <td className="r">{c.status === 'validated' ? <>{f1(c.validated_pct)}%<br /><span className="muted small">Level {c.validated_level} · {LEVELS[c.validated_level ?? 0]}</span></> : '—'}</td>
                <td>{c.ca_firm ?? <span className="muted">Not assigned yet</span>}{c.reviewer_name && <><br /><span className="muted small">{c.reviewer_name}</span></>}</td>
                <td>{dmy(c.created_at)}</td></tr>))}
            </tbody></table></div>)}
      </div>
    </>);
}
