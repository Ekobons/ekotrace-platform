/**
 * What applies: the rules that fit this company, grouped by how soon to act, each with why it shows and the next step;
 * "What changed": dated regulatory updates filtered to the company; "Your answers": the few extra questions the rules
 * need (pollution category, hazardous waste, BIS orders, power), stored in the profile module.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Choice, Kpi, Kpis, Pill, SmeHead, Text } from './ui';
import { SME_PAGES } from './nav';
import { dmy, f0, n } from '../../lib/sme';
import './carbon.css';
import './rules.css';
import { t, tn } from './i18n';

interface Item { key: string; status: string; label: string; title: string; detail: string; why?: string; action: string; go: string | null }
interface News { id: string; date: string; title: string; detail: string; source?: string; link?: string; concerns?: { sectors?: string[]; states?: string[]; flags?: string[] } }

const GROUPS: { status: string; title: string; sub: string; color: string }[] = [
  { status: 'apply', title: 'Act now', sub: 'These apply to you today.', color: 'var(--bad)' },
  { status: 'likely', title: 'Check soon', sub: 'Likely to apply, or an answer is missing.', color: 'var(--warn)' },
  { status: 'watch', title: 'Keep an eye on', sub: 'Not required yet, or an opportunity.', color: 'var(--muted)' },
  { status: 'good', title: 'In order', sub: 'Done, on track or not required.', color: 'var(--ok)' },
];
const PCB: [string, string][] = [['', 'Not sure yet'], ['red', 'Red (highly polluting)'], ['orange', 'Orange'], ['green', 'Green'], ['white', 'White (practically non-polluting)']];
const YN: [string, string][] = [['', 'Not answered'], ['yes', 'Yes'], ['no', 'No']];
const QCO: [string, string][] = [['', 'Not answered'], ['yes', 'Yes, covered'], ['no', 'No, not covered'], ['unsure', 'Not sure']];

type Tab = 'list' | 'news' | 'answers';

export function SmeApplies() {
  const { d, get, error } = useSme();
  const [tab, setTab] = useState<Tab>('list');
  const [allNews, setAllNews] = useState(false);
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading your data…')}</div>;
  const items = (d.results.requirements ?? []) as Item[];
  const known = new Set(GROUPS.map((g) => g.status));
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((x) => x.status === g.status || (g.status === 'watch' && !known.has(x.status))) }));
  const count = (s: string) => groups.find((g) => g.status === s)!.items.length;
  const profileEmpty = !d.meta.profile && !get('profile.turnover');
  const mfg = d.company.sector !== 'svc';

  // the companies an update concerns: sector, state and any one of the flags
  const p = (d.data.profile ?? {}) as Record<string, unknown>;
  const flags: Record<string, boolean> = {
    employer: n(p.employees) > 0, plastics: !!p.plastics, ewaste: !!p.ewaste, battery: !!p.battery,
    euExport: !!p.euExport, ukExport: !!p.ukExport, cbam: !!p.euExport && !!p.cbamGood && p.cbamGood !== 'none',
    listedBuyer: !!p.listedBuyer, csr: !!d.results.csr?.applies, hazWaste: p.hazWaste === 'yes' || p.hazWaste === true, qco: p.qco === 'yes', mfg,
  };
  const forUs = (x: News) => {
    const c = x.concerns ?? {};
    if (c.sectors?.length && !c.sectors.includes(d.company.sector)) return false;
    if (c.states?.length && !c.states.includes(d.company.state ?? '')) return false;
    if (c.flags?.length && !c.flags.some((f) => flags[f])) return false;
    return true;
  };
  const news = ([...((d.config.news?.items ?? []) as News[])]).sort((a, b) => (a.date < b.date ? 1 : -1));
  const mine = news.filter(forUs), shown = allNews ? news : mine;

  // extra answers the rules need and Profile does not ask
  const open = [
    mfg && !get('profile.pcbCategory'),
    mfg && !get('profile.hazWaste'),
    mfg && !get('profile.qco'),
  ].filter(Boolean).length;

  return (
    <div className="cb-stack">
      <SmeHead lede={t('The rules that fit your business, why each one shows, and the next step. Guidance to help you prioritise, not legal advice.')}><Link className="btn" to="/sme/profile">{t('Edit profile')}</Link></SmeHead>
      <div className="seg ru-tabs" role="tablist">
        {([['list', 'What applies'], ['news', 'What changed'], ['answers', 'Your answers']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(l)}{k === 'news' && mine.length > 0 && <span className="ru-ct">{mine.length}</span>}{k === 'answers' && open > 0 && <span className="ru-dot" aria-label={t('{n} unanswered', { n: open })} />}
          </button>))}
      </div>

      {tab === 'list' && <>
        {profileEmpty && <div className="sme-callout warn">{tn('Answer the questions in {link} first. Until then this list shows only the rules that apply to every business.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</div>}
        {!profileEmpty && open > 0 && <div className="sme-callout">{tn(open === 1 ? '{n} answer is missing for pollution, waste and product rules. {link} to complete the list.' : '{n} answers are missing for pollution, waste and product rules. {link} to complete the list.', { n: open, link: <button type="button" className="ru-link" onClick={() => setTab('answers')}>{t(open === 1 ? 'Answer it' : 'Answer them')}</button> })}</div>}
        <Kpis>
          <Kpi label={t('Act now')} value={count('apply')} unit={t('apply to you')} />
          <Kpi label={t('Check soon')} value={count('likely')} unit={t('likely or to prepare')} />
          <Kpi label={t('Keep an eye on')} value={count('watch')} unit={t('for information')} />
          <Kpi label={t('In order')} value={count('good')} unit={t('nothing to do')} good={count('good') > 0} />
        </Kpis>
        {groups.filter((g) => g.items.length).map((g) => (
          <div className="card cb-group" key={g.status}>
            <div className="cb-ghead"><span className="cb-dot" style={{ background: g.color }} /><h2>{t(g.title)}</h2><span className="cb-count">{g.items.length}</span></div>
            <p className="cb-sub" style={{ marginTop: 0 }}>{t(g.sub)}</p>
            {g.items.map((x) => (
              <div className="ru-req" key={x.key}>
                <div className="ru-req-h"><h3>{t(x.title)}</h3><Pill kind={x.status}>{x.label}</Pill></div>
                <p>{t(x.detail)}</p>
                {x.why && <p className="ru-why"><b>{t('Why it shows:')}</b> {t(x.why)}</p>}
                {(x.action || x.go) && <p className="ru-next"><b>{t('Next:')}</b> {t(x.action)} {x.go && <Link to={`/sme/${x.go}`}>{t('Open {page}', { page: t(SME_PAGES[x.go]?.title ?? x.go) })}</Link>}</p>}
              </div>))}
          </div>))}
        {!items.length && <div className="card empty">{tn('Nothing to show yet. Fill in your {link}.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</div>}
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{tn('The list updates as soon as you change an answer in {a} or {b}.', { a: <Link to="/sme/profile">{t('Profile')}</Link>, b: <button type="button" className="ru-link" onClick={() => setTab('answers')}>{t('Your answers')}</button> })}</p>
      </>}

      {tab === 'news' && (
        <div className="card">
          <div className="ru-h2row"><h2>{t('What changed')}</h2>
            {news.length > mine.length && <button type="button" className="btn sm ghost" onClick={() => setAllNews(!allNews)}>{allNews ? t('Show only yours ({n})', { n: mine.length }) : t('Show all {n} updates', { n: news.length })}</button>}</div>
          <p className="cb-sub">{t(allNews ? 'Recent changes to Indian and export rules, newest first. Read the source before you act.' : 'Recent changes to Indian and export rules that concern a business like yours (from your profile), newest first. Read the source before you act.')}</p>
          {!shown.length && <p className="muted" style={{ margin: '8px 0 0' }}>{t('No recent updates concern your profile.')}{news.length > 0 && <> <button type="button" className="ru-link" onClick={() => setAllNews(true)}>{t('Show all updates')}</button></>}</p>}
          <ul className="ru-news">
            {shown.map((x) => (
              <li key={x.id} className={forUs(x) ? '' : 'other'}>
                <span className="ru-date">{dmy(x.date)}</span>
                <div>
                  <h3>{x.title}{allNews && !forUs(x) && <span className="chip grey" style={{ marginLeft: 8 }}>{t('Not for you')}</span>}</h3>
                  <p>{x.detail}</p>
                  {x.link && <a className="small" href={x.link} target="_blank" rel="noopener noreferrer">{t('Source:')} {x.source ?? t('link')} ↗</a>}
                </div>
              </li>))}
          </ul>
        </div>)}

      {tab === 'answers' && (
        <div className="sme-grid2">
          <div className="card">
            <h2>{t('A few more answers')}</h2>
            <p className="cb-sub">{t('These decide the pollution, waste and product rules. They are saved with your profile.')}{!d.canEdit && ` ${t('You can view them; only editors can change them.')}`}</p>
            {mfg ? <>
              <Choice path="profile.pcbCategory" label={t('Pollution control category')} options={PCB} hint={t('It is on your Consent to Operate, or in your state board’s category list')} />
              <Text path="calendar.cto" label={t('Consent to Operate valid till')} type="date" />
              <Choice path="profile.hazWaste" label={t('Do you generate hazardous waste?')} options={YN} hint={t('Used oil, spent solvents, paint or ETP sludge, plating waste, chemical drums')} />
              <Choice path="profile.qco" label={t('Is your product under a BIS Quality Control Order?')} options={QCO} hint={t('Products that need the ISI mark or BIS registration by law')} />
              <Choice path="profile.power" label={t('Do your machines run on electric power?')} options={YN} hint={t('Decides the factory limit: 20 workers with power, 40 without')} />
            </> : <p className="muted" style={{ margin: '8px 0 0' }}>{tn('No extra questions for service businesses. If you run a workshop or plant, set your sector to Manufacturing in {link}.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</p>}
          </div>
          <div className="card">
            <h2>{t('From your profile')}</h2>
            <p className="cb-sub">{tn('The rules also read these answers. Change them in {link}.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</p>
            <dl className="ru-facts">
              <div><dt>{t('Sector')}</dt><dd>{t(mfg ? 'Manufacturing' : 'Services')}</dd></div>
              <div><dt>{t('State')}</dt><dd>{d.company.state || '—'}</dd></div>
              <div><dt>{t('Employees')}</dt><dd>{p.employees !== undefined && p.employees !== '' ? f0(p.employees) : '—'}</dd></div>
              <div><dt>{t('Udyam')}</dt><dd>{t(p.udyam ? 'Registered' : 'Not marked')}</dd></div>
              <div><dt>{t('Plastic packaging')}</dt><dd>{t(p.plastics ? 'Yes' : 'No')}</dd></div>
              <div><dt>{t('Electrical goods')}</dt><dd>{t(p.ewaste ? 'Yes' : 'No')}</dd></div>
              <div><dt>{t('Batteries')}</dt><dd>{t(p.battery ? 'Yes' : 'No')}</dd></div>
              <div><dt>{t('Exports')}</dt><dd>{[p.euExport && 'EU', p.ukExport && 'UK'].filter(Boolean).join(', ') || t('None marked')}</dd></div>
              <div><dt>{t('Supplies a listed company')}</dt><dd>{t(p.listedBuyer ? 'Yes' : 'No')}</dd></div>
            </dl>
          </div>
        </div>)}
    </div>);
}
