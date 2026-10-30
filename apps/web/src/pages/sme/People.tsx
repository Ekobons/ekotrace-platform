/** People & safety: workforce figures, the safety log (LTIFR), POSH status and the workers' anonymous grievance QR. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { useApp } from '../../App';
import { printHtml } from '../../lib/printwin';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Req, SmeHead, Toggle, copyText } from './ui';
import { dmy, f0, f2, n, smeApi, type SmeGrievance } from '../../lib/sme';
import { Evidence } from './Evidence';
import './comply.css';
import { t, tn } from './i18n';

interface LogRow { date: string; what: string; days: number }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const qrSvg = (text: string) => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); };
const today = () => new Date().toISOString().slice(0, 10);
/** first and last day of a financial year label such as "FY 2025-26" */
function fyRange(fy: string): [string, string] | null { const m = /(\d{4})/.exec(fy); return m ? [`${m[1]}-04-01`, `${Number(m[1]) + 1}-03-31`] : null; }

function SafetyLog() {
  const { d, get, setModule } = useSme();
  const log: LogRow[] = Array.isArray(get('people.log')) ? get('people.log') : [];
  const range = fyRange(d?.fy ?? '');
  const max = range && range[1] < today() ? range[1] : today();
  const [date, setDate] = useState(max);
  const [what, setWhat] = useState('');
  const [days, setDays] = useState('0');
  const [err, setErr] = useState('');
  const people = () => ({ ...(d?.data.people ?? {}) });
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!what.trim()) return setErr(t('Describe what happened.'));
    if (!date) return setErr(t('Choose the date.'));
    if (days === '' || Number(days) < 0) return setErr(t('Days lost must be 0 or more.'));
    setErr('');
    const rows = [...log, { date, what: what.trim().slice(0, 200), days: Math.round(Number(days)) }].sort((a, b) => (a.date < b.date ? 1 : -1));
    setModule('people', { ...people(), log: rows });
    setWhat(''); setDays('0');
  };
  const remove = (i: number) => { if (window.confirm(t('Remove this entry from the safety log?'))) setModule('people', { ...people(), log: log.filter((_, j) => j !== i) }); };
  return (
    <div className="card">
      <div className="cmp-h2row"><h2>{t('Safety log')}</h2><span className="muted small">{t(log.length === 1 ? '{n} entry' : '{n} entries', { n: log.length })}</span></div>
      <p className="cmp-sub">{t('Record every injury, including those where no time was lost. A lost-time injury is one where the person missed at least a day.')}</p>
      <div className="sme-scroll"><table className="sme-tbl">
        <thead><tr><th>{t('What happened')}</th><th className="r">{t('Days lost')}</th>{d?.canEdit && <th aria-label={t('Remove')} />}</tr></thead>
        <tbody>
          {log.map((x, i) => (
            <tr key={`${x.date}-${i}`}><td>{x.what}<br /><span className="muted small">{x.date ? dmy(x.date) : t('No date')}</span></td>
              <td className="r">{n(x.days) > 0 ? <Pill kind="soon">{x.days}</Pill> : <span className="muted">0</span>}</td>
              {d?.canEdit && <td className="r"><button type="button" className="btn xs ghost danger" onClick={() => remove(i)} aria-label={t('Remove {name}', { name: x.what })}>{t('Remove')}</button></td>}</tr>))}
          {!log.length && <tr><td colSpan={3} className="muted">{t('No incidents logged yet.')}</td></tr>}
        </tbody>
      </table></div>
      {d?.canEdit && (
        <form className="cmp-form" onSubmit={add} noValidate>
          <label className="wide"><span>{t('What happened')}</span><input className="input" value={what} maxLength={200} onChange={(e) => setWhat(e.target.value)} placeholder={t('e.g. Cut finger at press shop')} /></label>
          <label><span>{t('Date')}</span><input className="input" type="date" value={date} min={range?.[0]} max={max} onChange={(e) => setDate(e.target.value)} /></label>
          <label><span>{t('Days lost')}<small> {t('(0 if none)')}</small></span><input className="input num" type="number" inputMode="numeric" min={0} step={1} value={days} onChange={(e) => setDays(e.target.value)} /></label>
          {err && <p className="cmp-err" role="alert">{err}</p>}
          <div className="wide"><button className="btn p sm" type="submit">{t('Add to log')}</button></div>
        </form>)}
      {!log.length && <Toggle path="people.noIncidents" label={t('No incidents at all this year')} hint={t('Counts as a complete safety log for your ESG score')} />}
      <div className="cmp-proof">
        <Evidence module="people" item="safety" label={t('Safety records')} />
        <p className="muted small">{t('For example the accident register, first-aid register, a safety audit or training records.')}</p>
      </div>
    </div>);
}

function Grievances() {
  const { d } = useSme();
  const { toast, role } = useApp();
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<SmeGrievance[] | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'open' | 'resolved' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const linkRef = useRef<HTMLParagraphElement>(null);
  const canResolve = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role);
  useEffect(() => { smeApi.grievances().then((r) => { setToken(r.token); setItems(r.items); }).catch((e) => setErr((e as Error).message)); }, []);
  const link = token ? `${window.location.origin}/sme-grievance?t=${token}` : '';
  const svg = useMemo(() => (link ? qrSvg(link) : ''), [link]);
  const name = d?.company.name ?? '';

  const setStatus = async (g: SmeGrievance, status: 'open' | 'resolved') => {
    setBusy(g.id);
    try {
      await smeApi.grievanceStatus(g.id, status);
      setItems((xs) => (xs ?? []).map((x) => (x.id === g.id ? { ...x, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null } : x)));
      toast(status === 'resolved' ? t('Marked resolved') : t('Reopened'));
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  const copy = async () => toast((await copyText(link, linkRef.current)) ? t('Link copied') : t('Link selected. Press Ctrl+C to copy.'));
  const print = () => {
    const ok = printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Grievance QR · ${esc(name)}</title><style>
      @page { size: A4; margin: 18mm; } body { font-family: system-ui, sans-serif; color: #10201C; text-align: center; margin: 0; }
      .co { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; color: #5B6B66; margin: 8mm 0 0; }
      h1 { font-size: 34px; margin: 6mm 0 2mm; } .l { font-size: 21px; margin: 1mm 0; color: #3D4F49; }
      .qr { width: 95mm; height: 95mm; margin: 10mm auto 6mm; padding: 4mm; border: 2px solid #10201C; border-radius: 6mm; }
      .qr svg { width: 100%; height: 100%; display: block; }
      ol { display: inline-block; text-align: left; font-size: 17px; line-height: 1.7; margin: 2mm 0 6mm; }
      .u { font-family: monospace; font-size: 12px; color: #5B6B66; word-break: break-all; } .f { margin-top: 8mm; font-size: 13px; color: #5B6B66; }
    </style></head><body>
      <p class="co">${esc(name)}</p>
      <h1>{t('Have a problem at work?')}</h1>
      <p class="l">काम पर कोई समस्या? हमें बताएं।</p><p class="l">कामावर काही अडचण? आम्हाला सांगा.</p>
      <div class="qr">${svg}</div>
      <ol><li>{t('Scan with your phone camera')}</li><li>{t('Write your problem in Hindi, Marathi or English')}</li><li>{t('You do not have to give your name')}</li></ol>
      <p class="u">${esc(link)}</p>
      <p class="f">{t('Every complaint is read by management. Your identity is not recorded.')}</p>
    </body></html>`);
    if (!ok) toast(t('Allow pop-ups to print the poster'));
  };

  const list = (items ?? []).filter((g) => view === 'all' || g.status === view);
  const openN = (items ?? []).filter((g) => g.status === 'open').length;
  return (
    <>
      <div className="card">
        <h2>{t('Worker grievance QR')}</h2>
        <p className="cmp-sub">{t('Put this up at the gate, canteen and notice board. Workers scan it and report a problem from their phone, without giving their name.')}</p>
        {err && <div className="note bad">{err}</div>}
        {!err && !items && <p className="muted">{t('Loading…')}</p>}
        {!err && items && !token && <div className="note warn">{t('No grievance link has been set up for your company yet. Contact EKOTRACE support.')}</div>}
        {link && (
          <div className="cmp-qr">
            <div className="cmp-qrbox" role="img" aria-label={t('QR code for the grievance page')} dangerouslySetInnerHTML={{ __html: svg }} />
            <div>
              <p className="cmp-link" ref={linkRef}>{link}</p>
              <div className="row"><button type="button" className="btn p sm" onClick={print}>{t('Print poster')}</button><button type="button" className="btn sm" onClick={copy}>{t('Copy link')}</button>
                <a className="btn sm ghost" href={link} target="_blank" rel="noreferrer">{t('Preview')}</a></div>
            </div>
          </div>)}
      </div>

      <div className="card">
        <div className="cmp-h2row"><h2>{t('Grievances received')}</h2>
          <div className="seg cmp-filter" role="group" aria-label={t('Show')}>
            {([['open', 'Open|status'], ['resolved', 'Resolved'], ['all', 'All']] as const).map(([k, l]) => <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{t(l)}{k === 'open' && <span className="ct">{openN}</span>}</button>)}
          </div>
        </div>
        <div style={{ marginTop: 6 }}>
          {list.map((g) => (
            <div key={g.id} className="cmp-gv">
              <p>{g.text}</p>
              <div className="cal-end">
                <Pill kind={g.status === 'resolved' ? 'done' : 'soon'}>{g.status === 'resolved' ? t('Resolved') : t('Open|status')}</Pill>
                {canResolve && <button type="button" className="btn xs" disabled={busy === g.id} onClick={() => setStatus(g, g.status === 'resolved' ? 'open' : 'resolved')}>{g.status === 'resolved' ? t('Reopen') : t('Mark resolved')}</button>}
              </div>
              <small>{t(g.category || 'General')} · {dmy(g.created_at)}{g.resolved_at ? ` · ${t('resolved {date}', { date: dmy(g.resolved_at) })}` : ''}</small>
            </div>))}
          {items && !list.length && <p className="muted" style={{ margin: '8px 0 0' }}>{view === 'open' ? t('No open grievances.') : view === 'resolved' ? t('None resolved yet.') : t('No grievances yet. Once the QR is up, reports from workers appear here.')}</p>}
        </div>
        {!canResolve && !!items?.length && <p className="muted small" style={{ margin: '10px 0 0' }}>{t('A manager or admin can mark grievances resolved.')}</p>}
      </div>
    </>);
}

export function SmePeople() {
  const { d, get } = useSme();
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const s = d.results.safety as { lti: number; hours: number; ltifr: number; entries: number };
  const emp = n(get('profile.employees'));
  const ic = !!get('people.posh_ic'), ext = !!get('people.posh_ext'), rep = !!get('people.posh_report');
  const poshDue = (d.results.calendar as { id: string; date: string }[]).find((x) => x.id === 'posh');
  return (
    <>
      <SmeHead lede={t('Your workforce, safety record, POSH compliance and a grievance channel workers can use from their phone.')} />
      <Kpis>
        <Kpi label={t('Employees')} value={emp ? f0(emp) : '—'} unit={emp ? t('on the rolls') : t('add below')} />
        <Kpi label={t('Lost-time injuries')} value={s.lti} unit={t('this year')} good={s.entries > 0 && s.lti === 0} />
        <Kpi label={t('LTIFR')} value={s.hours ? f2(s.ltifr) : '—'} unit={t('per million hours worked')} />
        <Kpi label={t('Hours worked')} value={s.hours ? f0(s.hours) : '—'} unit={t('this year')} />
      </Kpis>

      <div className="sme-grid2">
        <div className="cmp-stack">
          <div className="card"><h2>{t('Workforce')}</h2>
            <Num path="profile.employees" label={t('Employees')} hint={t('Permanent and contract, as on 31 March')} unit={t('people')} />
            <Num path="esg.women" label={t('Women in the workforce')} unit="%" />
            <Num path="people.hours" label={t('Hours worked per employee')} hint={t('Typical: 8 hours × 300 days = 2,400')} unit="hrs/yr" placeholder="2400" />
          </div>
          <SafetyLog />
        </div>

        <div className="cmp-stack">
          <div className="card">
            <div className="cmp-h2row"><h2>{t('POSH')}</h2><Pill kind={ic && rep ? 'done' : emp >= 10 && !ic ? 'overdue' : 'soon'}>{ic && rep ? t('On track') : emp >= 10 && !ic ? t('Committee needed') : t('Check')}</Pill></div>
            <p className="cmp-sub">{t('The Sexual Harassment of Women at Workplace Act needs an Internal Committee where there are 10 or more employees, and a yearly report to the District Officer.')}</p>
            <Toggle path="people.posh_ic" label={t('Internal Committee constituted')} hint={t('Presided by a senior woman employee, at least half women')} />
            <Toggle path="people.posh_ext" label={t('External member on the committee')} hint={t('From an NGO or someone familiar with women\'s issues')} />
            <Toggle path="people.posh_report" label={t('Annual report filed with the District Officer')} />
            <div className="sme-ev-under"><Evidence module="people" item="posh_report" label={t('Filed report')} /></div>
            {ic && !ext && <Req title={t('Add the external member')} kind="soon" pill="Gap">{t('The committee is not valid without one member from outside the company.')}</Req>}
            {poshDue && <p className="cmp-sub" style={{ marginTop: 10 }}>{tn('Next annual report due {date} (date varies by state).', { date: <b>{dmy(poshDue.date)}</b> })} <Link to="/sme/calendar">{t('Calendar')}</Link></p>}
          </div>
          <Grievances />
        </div>
      </div>
    </>);
}
