/**
 * WhatsApp: a ready-to-send monthly summary or due-date reminder built from this year's results.
 * There is no WhatsApp sending yet: the person copies the text or opens WhatsApp (wa.me) and sends it themselves.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { useSme } from './store';
import { Pill, Sample, SmeHead, copyText } from './ui';
import { dmy, f1, n } from '../../lib/sme';
import './share.css';
import { getLang, t, tn } from './i18n';

interface Due { id: string; title: string; date: string; status: string; days: number; who?: string; freq?: string }
type Kind = 'summary' | 'due';
type Lang = 'en' | 'hi';

const REMIND_AT = [45, 15, 3];
const minus = (date: string, days: number) => { const x = new Date(`${date}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - days); return x.toISOString().slice(0, 10); };
const month = (lang: Lang) => new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric' });
const when = (x: Due, lang: Lang) => lang === 'hi'
  ? (x.days < 0 ? `${-x.days} दिन देर से` : x.days === 0 ? 'आज' : `${x.days} दिन बाकी`)
  : (x.days < 0 ? `${-x.days} days overdue` : x.days === 0 ? 'today' : `in ${x.days} days`);

export function SmeWhatsapp() {
  const { d, error } = useSme();
  const { toast } = useApp();
  const [kind, setKind] = useState<Kind>('summary');
  const [lang, setLang] = useState<Lang>(getLang);
  const [pick, setPick] = useState('');
  const [phone, setPhone] = useState('');
  const msgRef = useRef<HTMLDivElement>(null);
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading…')}</div>;

  const r = d.results, company = d.company.name, hasData = Object.keys(d.meta).length > 0;
  const open = (r.calendar as Due[]).filter((x) => x.status !== 'done');
  const soon = open.filter((x) => x.days <= 60).slice(0, 5);
  const upcoming = open.filter((x) => x.days >= 0).slice(0, 6);
  const chosen = open.find((x) => x.id === pick) ?? open[0];
  const esg = `${Math.round(n(r.esg.overall))}%${r.esg.level ? ` (Level ${r.esg.level} ${r.esg.levelName})` : ''}`;
  const hi = lang === 'hi';

  const summary = [
    `EKOTRACE SME · ${company}`,
    hi ? `मासिक अपडेट, ${month(lang)} (${d.fy})` : `Monthly update, ${month(lang)} (${d.fy})`,
    '',
    hi ? 'जल्द देय:' : 'Due soon:',
    ...(soon.length ? soon.map((x) => `• ${x.title} – ${dmy(x.date)} (${when(x, lang)})`) : [hi ? '• अगले 60 दिनों में कुछ देय नहीं।' : '• Nothing due in the next 60 days.']),
    '',
    hi ? 'इस वर्ष अब तक:' : 'This year so far:',
    hi ? `• उत्सर्जन (स्कोप 1 + 2): ${f1(r.emissions.total)} tCO₂e` : `• Emissions (Scope 1 + 2): ${f1(r.emissions.total)} tCO₂e`,
    hi ? `• तीव्रता: ${f1(r.emissions.intensity)} t प्रति ₹ करोड़ बिक्री` : `• Intensity: ${f1(r.emissions.intensity)} t per ₹ crore of sales`,
    hi ? `• पहचानी गई बचत: ₹${f1(n(r.money.savingsFound) / 1e5)} लाख प्रति वर्ष` : `• Savings found: ₹${f1(n(r.money.savingsFound) / 1e5)} lakh a year`,
    hi ? `• ESG तैयारी: ${esg}` : `• ESG readiness: ${esg}`,
    '',
    hi ? 'आंकड़े अपडेट करने के लिए EKOTRACE SME खोलें।' : 'Open EKOTRACE SME to update your figures.',
  ].join('\n');

  const reminder = !chosen ? '' : [
    hi ? `याद दिलाना · ${company}` : `Reminder · ${company}`,
    '',
    hi ? `${chosen.title}: अंतिम तिथि ${dmy(chosen.date)} (${when(chosen, lang)})।` : `${chosen.title} is due on ${dmy(chosen.date)} (${when(chosen, lang)}).`,
    ...(chosen.who ? [hi ? `किसके पास: ${chosen.who}` : `With: ${chosen.who}`] : []),
    '',
    hi ? 'जमा करने के बाद EKOTRACE SME के कैलेंडर में इसे "हो गया" चिह्नित करें।' : 'Once filed, mark it done in the EKOTRACE SME calendar.',
  ].join('\n');

  const msg = kind === 'summary' ? summary : reminder;
  const digits = phone.replace(/\D/g, ''), to = digits.length === 10 ? `91${digits}` : digits;
  const phoneOk = !digits || digits.length === 10 || (digits.length >= 11 && digits.length <= 15);
  const wa = `https://wa.me/${phoneOk ? to : ''}?text=${encodeURIComponent(msg)}`;
  const copy = async () => { const ok = await copyText(msg, msgRef.current); toast(ok ? t('Message copied') : t('Message selected. Press Ctrl+C to copy.')); };

  return (
    <>
      <SmeHead lede={t('A ready-made WhatsApp message with your due dates and headline figures, to send to your owner, plant manager or accountant.')} />
      <div className="sme-callout warn"><b>{t('Automatic WhatsApp reminders are coming soon and are not switched on.')}</b> {t('EKOTRACE does not send any WhatsApp messages today. Copy the message below, or tap “Open in WhatsApp” and send it yourself.')}</div>

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Message')}</h2>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <div className="row"><span className="lbl" style={{ width: 70 }}>{t('Type')}</span>
              <div className="seg" role="group" aria-label={t('Message type')}>
                <button type="button" className={kind === 'summary' ? 'on' : ''} aria-pressed={kind === 'summary'} onClick={() => setKind('summary')}>{t('Monthly summary')}</button>
                <button type="button" className={kind === 'due' ? 'on' : ''} aria-pressed={kind === 'due'} onClick={() => setKind('due')}>{t('Due-date reminder')}</button>
              </div></div>
            <div className="row"><span className="lbl" style={{ width: 70 }}>{t('Language')}</span>
              <div className="seg" role="group" aria-label={t('Language')}>
                <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>{t('English')}</button>
                <button type="button" className={lang === 'hi' ? 'on' : ''} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिन्दी</button>
              </div></div>
            {kind === 'due' && open.length > 0 && (
              <div className="sme-field" style={{ borderTop: 0, padding: 0 }}><label htmlFor="smw-due">{t('Which due date')}</label>
                <select id="smw-due" className="input" value={chosen?.id ?? ''} onChange={(e) => setPick(e.target.value)}>
                  {open.map((x) => <option key={x.id} value={x.id}>{x.title} · {dmy(x.date)}</option>)}
                </select></div>)}
            <div className="sme-field" style={{ padding: '6px 0 0' }}>
              <label htmlFor="smw-ph">{t('Send to (optional)')}<small>{t('A mobile number. Leave empty to choose the chat in WhatsApp.')}</small></label>
              <input id="smw-ph" className={`input num${phoneOk ? '' : ' badin'}`} inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {!phoneOk && <p className="small" style={{ margin: 0, color: 'var(--bad)' }}>{t('Enter a 10-digit mobile number, or include the country code.')}</p>}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" type="button" onClick={copy} disabled={!msg}><Icon name="paste" />{t('Copy message')}</button>
            {msg && phoneOk
              ? <a className="btn p" href={wa} target="_blank" rel="noopener noreferrer"><Icon name="chat" />{t('Open in WhatsApp')}</a>
              : <button className="btn p" type="button" disabled><Icon name="chat" />{t('Open in WhatsApp')}</button>}
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>{t('“Open in WhatsApp” opens WhatsApp with this text filled in. Nothing is sent until you press send there.')}</p>
        </div>

        <div className="card">
          <div className="row"><h2 className="grow">{t('Preview')}</h2>{d.company.isExample && <Sample />}</div>
          <div className="smw-phone" style={{ marginTop: 12 }}>
            <span className="smw-tag">{t('This is how the message will look')}</span>
            {msg ? <div className="smw-bub" ref={msgRef}>{msg}<small>{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></div>
              : <span className="smw-tag">{tn('No due dates yet. Add your licence and renewal dates in {link}.', { link: <Link to="/sme/calendar">{t('Calendar')}</Link> })}</span>}
          </div>
          {!hasData && <p className="muted small" style={{ margin: '10px 0 0' }}>{tn('Your figures show as zero until you add your bills in {link}.', { link: <Link to="/sme/emissions">{t('Emissions')}</Link> })}</p>}
        </div>
      </div>

      <div className="card">
        <div className="row"><h2 className="grow">{t('Reminder plan')}</h2><Pill kind="watch">{t('Not switched on')}</Pill></div>
        <p className="muted" style={{ margin: '6px 0 4px', fontSize: 13.5 }}>{t('When automatic reminders are switched on, each due date will get three reminders: 45, 15 and 3 days before. Until then, use this plan to send them yourself.')}</p>
        {upcoming.length ? (
          <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>{t('Due date')}</th><th className="r">{t('Due')}</th><th>{t('Reminders on (days before)')}</th></tr></thead>
            <tbody>{upcoming.map((x) => (
              <tr key={x.id}><td>{t(x.title)}{x.who && <><br /><span className="muted small">{t(x.who)}</span></>}</td>
                <td className="r">{dmy(x.date)}<br /><Pill kind={x.status}>{when(x, getLang())}</Pill></td>
                <td className="smw-rem">{REMIND_AT.map((k) => <div key={k} style={{ whiteSpace: 'nowrap' }}>{x.days < k ? <s title={t('Already passed')}>{dmy(minus(x.date, k))}</s> : dmy(minus(x.date, k))} <span className="muted">· {t('{n} days', { n: k })}</span></div>)}</td></tr>))}
            </tbody></table></div>
        ) : <p className="muted">{tn('No upcoming due dates. Add your licence and renewal dates in {link}.', { link: <Link to="/sme/calendar">{t('Calendar')}</Link> })}</p>}
      </div>
    </>);
}
