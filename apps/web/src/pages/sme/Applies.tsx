/** What applies: the rules that fit this company, grouped by how soon to act, each with its next step. */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Pill, Req, SmeHead } from './ui';
import { SME_PAGES } from './nav';
import './carbon.css';

interface Item { key: string; status: string; label: string; title: string; detail: string; action: string; go: string | null }

const GROUPS: { status: string; title: string; sub: string; color: string }[] = [
  { status: 'apply', title: 'Act now', sub: 'These apply to you today.', color: 'var(--bad)' },
  { status: 'likely', title: 'Check soon', sub: 'Likely to apply, or worth preparing for.', color: 'var(--warn)' },
  { status: 'watch', title: 'Keep an eye on', sub: 'Not required yet, or an opportunity.', color: 'var(--muted)' },
  { status: 'good', title: 'In order', sub: 'Done, on track or not required.', color: 'var(--ok)' },
];

export function SmeApplies() {
  const { d, get, error } = useSme();
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading your data…</div>;
  const items = (d.results.requirements ?? []) as Item[];
  const known = new Set(GROUPS.map((g) => g.status));
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((x) => x.status === g.status || (g.status === 'watch' && !known.has(x.status))) }));
  const count = (s: string) => groups.find((g) => g.status === s)!.items.length;
  const profileEmpty = !d.meta.profile && !get('profile.turnover');
  return (
    <div className="cb-stack">
      <SmeHead lede="Based on your profile. Guidance to help you prioritise, not legal advice."><Link className="btn" to="/sme/profile">Edit profile</Link></SmeHead>
      {profileEmpty && <div className="sme-callout warn">Answer the questions in <Link to="/sme/profile">Profile</Link> first. Until then this list shows only the rules that apply to every business.</div>}
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
            <Req key={x.key} title={x.title} pill={x.label} kind={x.status}
              action={x.action || x.go ? <>{x.action && <><b>Next:</b> {x.action} </>}{x.go && <Link to={`/sme/${x.go}`}>Open {SME_PAGES[x.go]?.title ?? x.go}</Link>}</> : null}>
              {x.detail}
            </Req>))}
        </div>))}
      {!items.length && <div className="card empty">Nothing to show yet. Fill in your <Link to="/sme/profile">Profile</Link>.</div>}
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>The list updates as soon as you change an answer in <Link to="/sme/profile">Profile</Link>. Status: <Pill kind="apply">Applies</Pill> <Pill kind="likely">Check</Pill> <Pill kind="watch">Watch</Pill> <Pill kind="good">In order</Pill></p>
    </div>);
}
