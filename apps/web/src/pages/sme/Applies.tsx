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
  if (!d) return <div className="card empty">Loading your data…</div>;
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
      <SmeHead lede="The rules that fit your business, why each one shows, and the next step. Guidance to help you prioritise, not legal advice."><Link className="btn" to="/sme/profile">Edit profile</Link></SmeHead>
      <div className="seg ru-tabs" role="tablist">
        {([['list', 'What applies'], ['news', 'What changed'], ['answers', 'Your answers']] as [Tab, string][]).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t}{k === 'news' && mine.length > 0 && <span className="ru-ct">{mine.length}</span>}{k === 'answers' && open > 0 && <span className="ru-dot" aria-label={`${open} unanswered`} />}
          </button>))}
      </div>

      {tab === 'list' && <>
        {profileEmpty && <div className="sme-callout warn">Answer the questions in <Link to="/sme/profile">Profile</Link> first. Until then this list shows only the rules that apply to every business.</div>}
        {!profileEmpty && open > 0 && <div className="sme-callout">{open} {open === 1 ? 'answer is' : 'answers are'} missing for pollution, waste and product rules. <button type="button" className="ru-link" onClick={() => setTab('answers')}>Answer {open === 1 ? 'it' : 'them'}</button> to complete the list.</div>}
        <Kpis>
          <Kpi label="Act now" value={count('apply')} unit="apply to you" />
          <Kpi label="Check soon" value={count('likely')} unit="likely or to prepare" />
          <Kpi label="Keep an eye on" value={count('watch')} unit="for information" />
          <Kpi label="In order" value={count('good')} unit="nothing to do" good={count('good') > 0} />
        </Kpis>
        {groups.filter((g) => g.items.length).map((g) => (
          <div className="card cb-group" key={g.status}>
            <div className="cb-ghead"><span className="cb-dot" style={{ background: g.color }} /><h2>{g.title}</h2><span className="cb-count">{g.items.length}</span></div>
            <p className="cb-sub" style={{ marginTop: 0 }}>{g.sub}</p>
            {g.items.map((x) => (
              <div className="ru-req" key={x.key}>
                <div className="ru-req-h"><h3>{x.title}</h3><Pill kind={x.status}>{x.label}</Pill></div>
                <p>{x.detail}</p>
                {x.why && <p className="ru-why"><b>Why it shows:</b> {x.why}</p>}
                {(x.action || x.go) && <p className="ru-next"><b>Next:</b> {x.action} {x.go && <Link to={`/sme/${x.go}`}>Open {SME_PAGES[x.go]?.title ?? x.go}</Link>}</p>}
              </div>))}
          </div>))}
        {!items.length && <div className="card empty">Nothing to show yet. Fill in your <Link to="/sme/profile">Profile</Link>.</div>}
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>The list updates as soon as you change an answer in <Link to="/sme/profile">Profile</Link> or <button type="button" className="ru-link" onClick={() => setTab('answers')}>Your answers</button>.</p>
      </>}

      {tab === 'news' && (
        <div className="card">
          <div className="ru-h2row"><h2>What changed</h2>
            {news.length > mine.length && <button type="button" className="btn sm ghost" onClick={() => setAllNews(!allNews)}>{allNews ? `Show only yours (${mine.length})` : `Show all ${news.length} updates`}</button>}</div>
          <p className="cb-sub">Recent changes to Indian and export rules{allNews ? '' : ' that concern a business like yours (from your profile)'}, newest first. Read the source before you act.</p>
          {!shown.length && <p className="muted" style={{ margin: '8px 0 0' }}>No recent updates concern your profile.{news.length > 0 && <> <button type="button" className="ru-link" onClick={() => setAllNews(true)}>Show all updates</button></>}</p>}
          <ul className="ru-news">
            {shown.map((x) => (
              <li key={x.id} className={forUs(x) ? '' : 'other'}>
                <span className="ru-date">{dmy(x.date)}</span>
                <div>
                  <h3>{x.title}{allNews && !forUs(x) && <span className="chip grey" style={{ marginLeft: 8 }}>Not for you</span>}</h3>
                  <p>{x.detail}</p>
                  {x.link && <a className="small" href={x.link} target="_blank" rel="noopener noreferrer">Source: {x.source ?? 'link'} ↗</a>}
                </div>
              </li>))}
          </ul>
        </div>)}

      {tab === 'answers' && (
        <div className="sme-grid2">
          <div className="card">
            <h2>A few more answers</h2>
            <p className="cb-sub">These decide the pollution, waste and product rules. They are saved with your profile.{!d.canEdit && ' You can view them; only editors can change them.'}</p>
            {mfg ? <>
              <Choice path="profile.pcbCategory" label="Pollution control category" options={PCB} hint="It is on your Consent to Operate, or in your state board’s category list" />
              <Text path="calendar.cto" label="Consent to Operate valid till" type="date" />
              <Choice path="profile.hazWaste" label="Do you generate hazardous waste?" options={YN} hint="Used oil, spent solvents, paint or ETP sludge, plating waste, chemical drums" />
              <Choice path="profile.qco" label="Is your product under a BIS Quality Control Order?" options={QCO} hint="Products that need the ISI mark or BIS registration by law" />
              <Choice path="profile.power" label="Do your machines run on electric power?" options={YN} hint="Decides the factory limit: 20 workers with power, 40 without" />
            </> : <p className="muted" style={{ margin: '8px 0 0' }}>No extra questions for service businesses. If you run a workshop or plant, set your sector to Manufacturing in <Link to="/sme/profile">Profile</Link>.</p>}
          </div>
          <div className="card">
            <h2>From your profile</h2>
            <p className="cb-sub">The rules also read these answers. Change them in <Link to="/sme/profile">Profile</Link>.</p>
            <dl className="ru-facts">
              <div><dt>Sector</dt><dd>{mfg ? 'Manufacturing' : 'Services'}</dd></div>
              <div><dt>State</dt><dd>{d.company.state || '—'}</dd></div>
              <div><dt>Employees</dt><dd>{p.employees !== undefined && p.employees !== '' ? f0(p.employees) : '—'}</dd></div>
              <div><dt>Udyam</dt><dd>{p.udyam ? 'Registered' : 'Not marked'}</dd></div>
              <div><dt>Plastic packaging</dt><dd>{p.plastics ? 'Yes' : 'No'}</dd></div>
              <div><dt>Electrical goods</dt><dd>{p.ewaste ? 'Yes' : 'No'}</dd></div>
              <div><dt>Batteries</dt><dd>{p.battery ? 'Yes' : 'No'}</dd></div>
              <div><dt>Exports</dt><dd>{[p.euExport && 'EU', p.ukExport && 'UK'].filter(Boolean).join(', ') || 'None marked'}</dd></div>
              <div><dt>Supplies a listed company</dt><dd>{p.listedBuyer ? 'Yes' : 'No'}</dd></div>
            </dl>
          </div>
        </div>)}
    </div>);
}
