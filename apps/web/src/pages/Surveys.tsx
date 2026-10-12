/**
 * Capture → Surveys: employee commuting asked in Ekotrace (as in the prototype).
 *
 * List: surveys with answers / invited and the estimated tCO₂e a year; + New survey (name, year,
 * answers due by, working weeks, facilities, home working). Detail tabs: Overview (how it works,
 * response rate, estimate, how people travel), People (add, codes, invitations, answers on
 * behalf), Questionnaire (questions, preview, calculation settings), Responses (admins only),
 * Results & publish (per facility × headcount with a 95% range → Scope 3 · Employee commuting),
 * Actions (ways to reduce, guides).
 */
import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, download, type Facility, type PublishRow, type SurveyDetail, type SurveyOptions, type SurveyPerson, type Survey } from '../lib/api';
import { SurveyForm } from './SurveyAnswer';

const ST: Record<string, [string, string]> = { draft: ['Draft', 'grey'], open: ['Collecting answers', 'info'], closed: ['Closed', 'warn'], published: ['Published to Scope 3', ''] };
const f0 = (v: number) => Math.round(v).toLocaleString('en');
const f1 = (v: number, d = 1) => v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (d: string | null | undefined, long = false) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-GB', { day: 'numeric', month: long ? 'long' : 'short', timeZone: 'UTC' }) : '');

export function Surveys() {
  const { id } = useParams();
  return id ? <SurveyView id={id} /> : <SurveyList />;
}

// ------------------------------------------------------------------- list --
function SurveyList() {
  const nav = useNavigate();
  const [d, setD] = useState<{ surveys: Survey[]; canCreate: boolean } | null>(null);
  const [form, setForm] = useState(() => new URLSearchParams(window.location.search).get('new') === '1');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.surveys().then(setD).catch((e) => setErr((e as Error).message)); }, []);
  return (
    <div className="page">
      <div className="head"><div>
        <div className="eyebrow">Capture</div><h1>Surveys</h1>
        <p className="sub">Ask employees for data you can't get from bills or systems. Answers from a sample are scaled up to the whole headcount and published into Scope 3.</p>
      </div>{d?.canCreate && !form && <button className="btn p" onClick={() => setForm(true)}>+ New survey</button>}</div>
      {err && <div className="note bad">{err}</div>}
      {form && <NewSurvey onCancel={() => setForm(false)} onCreated={(sid) => nav(`/surveys/${sid}?tab=people`)} />}
      <div className="ggrid">
        {d?.surveys.map((s) => { const st = ST[s.status]!; const inv = s.invited ?? 0, ans = s.answered ?? 0; return (
          <button key={s.id} className="gcard" onClick={() => nav(`/surveys/${s.id}`)}>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="gic">🚌</span><b style={{ flex: 1, minWidth: 0 }}>{s.name}</b><span className={`chip ${st[1]}`}>{st[0]}</span></div>
            <span className="muted small">Employee commuting · {s.year} · {s.facility_ids.length} facilit{s.facility_ids.length === 1 ? 'y' : 'ies'}{s.close_at ? ` · answers by ${day(s.close_at)}` : ''}</span>
            <div className="row" style={{ gap: 14 }}><span><b style={{ fontSize: 18 }}>{ans}</b><span className="muted small"> / {inv} invited</span></span><span><b style={{ fontSize: 18 }}>{f0(s.est ?? 0)}</b><span className="muted small"> tCO₂e / yr est.</span></span></div>
            <div className="mbar"><span style={{ width: `${inv ? Math.min(100, (ans / inv) * 100) : 0}%` }} /></div>
            <span className="muted small">{inv ? Math.round((ans / inv) * 100) : 0}% responded · sample is {s.N ? ((ans / s.N) * 100).toFixed(1) : 0}% of {f0(s.N ?? 0)} employees</span>
          </button>); })}
        {d && !d.surveys.length && <div className="card muted">No surveys yet.{d.canCreate ? ' Start with an employee commuting survey.' : ''}</div>}
        <div className="gcard" style={{ opacity: 0.6, cursor: 'default' }}><b>More survey types</b><span className="muted small">Home working detail, events & visitors, supplier questionnaires — coming later.</span></div>
      </div>
    </div>
  );
}

function NewSurvey({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const y = new Date().getFullYear();
  const [facs, setFacs] = useState<(Facility & { employees?: number | null })[]>([]);
  const [f, setF] = useState({ name: `Employee commuting ${y}`, year: y, closeAt: new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10), weeks: '46', facs: [] as string[], wfh: false });
  const [emp, setEmp] = useState<Record<string, number | null>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.facilities().then((r) => { const mine = r.facilities.filter((x) => x.canEnter); setFacs(mine); setF((o) => ({ ...o, facs: mine.map((x) => x.id) })); }).catch(() => {});
    api.org().then((r) => setEmp(Object.fromEntries(r.nodes.map((n) => [n.id, n.employees])))).catch(() => {});
  }, []);
  const create = async () => {
    setErr(null);
    try { const r = await api.createSurvey({ name: f.name, year: f.year, closeAt: f.closeAt || null, weeks: Number(f.weeks) || 46, facilityIds: f.facs, wfh: f.wfh }); onCreated(r.id); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <section className="card" style={{ display: 'grid', gap: 12, borderColor: 'var(--primary)' }}>
      <div className="row"><h2 style={{ fontSize: 17, margin: 0 }}>New survey · Employee commuting</h2><span className="grow" /><button className="btn sm ghost" onClick={onCancel}>Cancel</button></div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field grow" style={{ minWidth: 200 }}><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ width: 160 }}><span>Reporting year</span><select className="input" value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })}>{[y + 1, y, y - 1, y - 2].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="field" style={{ width: 180 }}><span>Answers due by</span><input className="input" type="date" value={f.closeAt} onChange={(e) => setF({ ...f, closeAt: e.target.value })} /></label>
        <label className="field" style={{ width: 180 }}><span>Working weeks per year</span><input className="input" inputMode="numeric" value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      <div><span className="lbl">Facilities covered</span>
        <div className="gpick">{facs.map((x) => { const on = f.facs.includes(x.id); return (
          <label key={x.id} className={on ? 'on' : ''}><input type="checkbox" checked={on} onChange={() => setF({ ...f, facs: on ? f.facs.filter((i) => i !== x.id) : [...f.facs, x.id] })} /> {x.name}
            <span className="muted small">{emp[x.id] ? `${f0(emp[x.id]!)} staff` : 'staff not set'}</span></label>); })}</div></div>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={f.wfh} onChange={() => setF({ ...f, wfh: !f.wfh })} /> Also ask about home-working days (adds home-working emissions, indicative)</label>
      {err && <div className="note bad">{err}</div>}
      <div className="row"><button className="btn p" disabled={!f.facs.length || !f.name.trim()} onClick={create}>Create survey</button><span className="muted small">Next you add the people to ask.</span></div>
    </section>
  );
}

// ----------------------------------------------------------------- detail --
type Tab = 'over' | 'people' | 'questions' | 'resp' | 'results' | 'acts';
function SurveyView({ id }: { id: string }) {
  const { toast, tenant } = useApp();
  const nav = useNavigate();
  const [tab, setTabState] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'over');
  const setTab = (t: Tab) => { setTabState(t); window.history.replaceState(null, '', `/surveys/${id}${t === 'over' ? '' : `?tab=${t}`}`); };
  const [d, setD] = useState<SurveyDetail | null>(null);
  const [opt, setOpt] = useState<SurveyOptions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ person: SurveyPerson | null } | null>(null);
  const load = () => api.survey(id).then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); api.surveyOptions().then((o) => { MODE_LABELS = Object.fromEntries(o.modes.map((m) => [m.key, m.label])); setOpt(o); }).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="page"><div className="note bad">{err}</div><Link to="/surveys">← Surveys</Link></div>;
  if (!d || !opt) return <div className="page"><div className="card empty">Loading…</div></div>;
  const sv = d.survey, res = d.results, st = ST[sv.status]!, man = d.canManage, pubd = sv.status === 'published';
  const answered = d.people.filter((p) => p.answered_at).length;
  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await load(); } catch (e) { toast((e as Error).message); } };
  const tabs: [Tab, string][] = [['over', 'Overview'], ['people', `People · ${d.people.length}`], ['questions', 'Questionnaire'], ...(d.answers.length || man ? [['resp', `Responses · ${res.n}`] as [Tab, string]] : []), ['results', 'Results & publish'], ['acts', 'Actions']];
  const company = tenant?.name ?? 'our company';
  const linkOf = (code: string) => `${window.location.origin}/survey?code=${code}`;
  const invite = (p: SurveyPerson) => `Hi ${(p.name ?? '').split(' ')[0]},\n\nWe're measuring the carbon footprint of commuting at ${company}. Please answer a 2-minute survey about how you usually get to work${sv.close_at ? ` by ${day(sv.close_at, true)}` : ''}.\n\n1. Open ${linkOf(p.code!)}\n2. Your code: ${p.code}\n\nYour answers are only reported as averages. Thank you!`;
  const setup = { modes: opt.modes, fuels: opt.fuels, facilities: d.facilities.map((f) => ({ id: f.id, name: f.name })), wfh: sv.wfh };
  return (
    <div className="page">
      <div><Link to="/surveys" className="small">← Surveys</Link></div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div><div className="eyebrow">Employee commuting · Scope 3 category 7 · {sv.year}</div><h1 style={{ margin: '2px 0' }}>{sv.name}</h1>
          <div className="row" style={{ gap: 8 }}><span className={`chip ${st[1]}`}>{st[0]}</span><span className="muted small">{res.n} answers from {d.people.length} invited · {f0(res.N)} employees in scope{sv.close_at ? ` · due ${day(sv.close_at, true)}` : ''}</span></div></div>
        <span className="grow" />
        {man && sv.status === 'draft' && <button className="btn p" disabled={!d.people.length} title={d.people.length ? undefined : 'Add people first'} onClick={() => act(() => api.surveyStatus(id, 'open'), 'Survey open — send each person their invitation').then(() => setTab('people'))}>Open & send invitations</button>}
        {man && sv.status === 'open' && <button className="btn" onClick={() => act(() => api.surveyStatus(id, 'closed'), 'Survey closed')}>Close survey</button>}
        {man && sv.status === 'closed' && <button className="btn" onClick={() => act(() => api.surveyStatus(id, 'open'), 'Survey reopened')}>Reopen</button>}
        {man && pubd && <button className="btn" onClick={() => act(() => api.reopenSurvey(id), 'Survey reopened: publish again to update Scope 3')}>Reopen</button>}
        {man && !pubd && <button className="btn ghost" title="Delete survey" aria-label="Delete survey" onClick={() => { if (window.confirm(`Delete “${sv.name}” with its people and answers?`)) void act(() => api.deleteSurvey(id), 'Survey deleted').then(() => nav('/surveys')); }}>✕</button>}
      </div>
      <nav className="tabs">{tabs.map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</nav>
      {tab === 'over' && <Overview d={d} go={setTab} />}
      {tab === 'people' && <People d={d} man={man} answered={answered} invite={invite} reload={load} onBehalf={(p) => setForm({ person: p })} />}
      {tab === 'questions' && <Questions d={d} man={man && !pubd} reload={load} preview={() => setForm({ person: null })} />}
      {tab === 'resp' && <Responses d={d} opt={opt} />}
      {tab === 'results' && <Results d={d} opt={opt} man={man && !pubd} reload={load} />}
      {tab === 'acts' && <Actions d={d} opt={opt} />}
      {form && (
        <div className="sv-overlay" role="dialog" aria-modal="true"><div className="sv-sheet">
          {form.person ? <div className="note info">Entering answers on behalf of {form.person.name}.</div> : <div className="note info">Preview: this is what employees see. Nothing is saved.</div>}
          <SurveyForm setup={setup} facilityId={form.person?.facility_id ?? setup.facilities[0]!.id} title={`How do you usually get to work${form.person?.name ? `, ${form.person.name.split(' ')[0]}` : ''}?`}
            intro="Think of a normal week. Rough numbers are fine." submitLabel={form.person ? 'Save answers' : 'Submit (preview)'} onCancel={() => setForm(null)}
            onSubmit={async (fac, a) => {
              if (!form.person) { toast('Preview only: nothing saved'); setForm(null); return; }
              const r = await api.answerOnBehalf(id, form.person.id, { facilityId: fac, answers: a });
              toast(`Saved · about ${f0(r.kg)} kg CO₂e a year`); setForm(null); await load();
            }} />
        </div></div>)}
    </div>
  );
}

function Overview({ d, go }: { d: SurveyDetail; go: (t: Tab) => void }) {
  const sv = d.survey, res = d.results, modes = Object.entries(res.modes).sort((a, b) => b[1] - a[1]);
  const steps: [string, string, Tab, boolean][] = [
    ['Add people', 'Employees to ask, by facility — paste a list or upload CSV.', 'people', d.people.length > 0],
    ['Open & send', 'Each person gets a personal code. Send the invitation by email.', 'people', sv.status !== 'draft'],
    ['Collect answers', 'People answer in about 2 minutes. Watch the response rate.', 'resp', res.n > 0],
    ['Scale up & publish', 'Average per respondent × headcount, per facility. Publishes into Scope 3 · Employee commuting.', 'results', sv.status === 'published'],
  ];
  const label = (k: string) => d && OPTS_LABEL(k);
  return <>
    <section className="card" style={{ display: 'grid', gap: 10 }}><span className="lbl">How this survey works</span>
      <div className="flow">{steps.map(([n, t, tab, ok], i) => <Fragment key={n}>
        {i > 0 && <span className="farr">→</span>}
        <button className={`fstep${ok ? ' ok' : ''}`} onClick={() => go(tab)}><span className="fn">{ok ? '✓' : i + 1}</span><b>{n}</b><span className="muted small">{t}</span></button></Fragment>)}</div>
    </section>
    <div className="svk">
      <section className="card"><span className="muted small">Responses</span><b>{res.n}</b><small>of {d.people.length} invited</small></section>
      <section className="card"><span className="muted small">Sample of headcount</span><b>{res.N ? ((res.n / res.N) * 100).toFixed(1) : 0}%</b><small>{f0(res.N)} employees</small></section>
      <section className="card"><span className="muted small">Estimated tCO₂e / year</span><b>{f0(res.tot)}</b><small>{res.n > 1 ? `95% range ${f0(res.totLo)}–${f0(res.totHi)}` : 'needs more answers'}</small></section>
      <section className="card"><span className="muted small">Average per employee</span><b>{f1(res.gMean / 1000, 2)} t</b><small>per year, from answers</small></section>
    </div>
    <section className="card" style={{ display: 'grid', gap: 8 }}><h2 style={{ fontSize: 16, margin: 0 }}>How people get to work (main mode)</h2>
      {modes.length ? modes.map(([k, v]) => (
        <div key={k} className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><span style={{ width: 210, flex: 'none', fontSize: 13 }}>{label(k)}</span><div className="mbar" style={{ flex: 1 }}><span style={{ width: `${(v / res.n) * 100}%`, background: 'var(--s2)' }} /></div><b style={{ width: 60, textAlign: 'right' }}>{Math.round((v / res.n) * 100)}%</b></div>))
        : <span className="muted">No answers yet.</span>}
    </section>
  </>;
}
let MODE_LABELS: Record<string, string> = {};
const OPTS_LABEL = (k: string) => MODE_LABELS[k] ?? k;

function People({ d, man, answered, invite, reload, onBehalf }: { d: SurveyDetail; man: boolean; answered: number; invite: (p: SurveyPerson) => string; reload: () => Promise<unknown>; onBehalf: (p: SurveyPerson) => void }) {
  const { toast } = useApp();
  const sv = d.survey, pubd = sv.status === 'published';
  const [text, setText] = useState('');
  const [fac, setFac] = useState(d.facilities[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string[]>([]);
  const list = d.people.filter((p) => !q || `${p.name} ${p.email} ${p.department} ${p.facility}`.toLowerCase().includes(q.toLowerCase()));
  const un = d.people.filter((p) => !p.answered_at);
  const add = async (t: string) => {
    try { const r = await api.addSurveyPeople(sv.id, { text: t, defaultFacilityId: fac }); toast(`${r.added} added${r.skipped ? ` · ${r.skipped} already on the list` : ''}`); setMsg(r.problems); setText(''); await reload(); }
    catch (e) { toast((e as Error).message); }
  };
  const sent = (ids: string[]) => api.surveySent(sv.id, ids).then(() => reload()).catch(() => {});
  const mailto = (p: SurveyPerson) => `mailto:${encodeURIComponent(p.email ?? '')}?subject=${encodeURIComponent('2-minute commuting survey')}&body=${encodeURIComponent(invite(p))}`;
  return <>
    {man && <section className="card row" style={{ gap: 18 }}>
      <div><span className="muted small">Surveys completed</span><div style={{ fontSize: 22, fontWeight: 700 }}>{answered}</div></div>
      <div><span className="muted small">Not completed</span><div style={{ fontSize: 22, fontWeight: 700 }}>{un.length}</div></div>
      <span className="grow" />
      {sv.status === 'open' && un.length > 0 && <button className="btn p" onClick={() => { void download(`/api/surveys/${sv.id}/invitations?unanswered=1`, `${sv.name} - not answered.csv`); void sent(un.map((p) => p.id)); }}>Send to unanswered ({un.length})</button>}
    </section>}
    {man && !pubd && <section className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Add people</h2>
      <p className="sub" style={{ margin: 0 }}>One person per line: <span className="mono">name, email, facility, department</span>. Facility can be its name; if missing, the one picked here is used. Or upload a CSV with those columns.</p>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <textarea className="input" rows={4} style={{ flex: '1 1 360px', height: 'auto', padding: 10 }} value={text} placeholder="Fatima Al Hashimi, fatima@company.ae, BEEAH Headquarters, Finance" onChange={(e) => setText(e.target.value)} />
        <div style={{ display: 'grid', gap: 8, flex: '0 1 240px' }}>
          <label className="field"><span>Default facility</span><select className="input" value={fac} onChange={(e) => setFac(e.target.value)}>{d.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <button className="btn p" disabled={!text.trim()} onClick={() => add(text)}>Add people</button>
          <label className="btn">Upload CSV<input type="file" accept=".csv,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await add(await f.text()); }} /></label>
        </div>
      </div>
      {msg.map((m) => <div key={m} className="note warn" style={{ margin: 0 }}>{m}</div>)}
    </section>}
    <section className="card flush">
      <div className="row" style={{ padding: '12px 16px', gap: 8 }}><h2 style={{ fontSize: 16, margin: 0 }}>People asked · {d.people.length}</h2><span className="grow" />
        <input className="input" style={{ maxWidth: 220 }} type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {man && d.people.length > 0 && <button className="btn sm" onClick={() => download(`/api/surveys/${sv.id}/invitations`, `${sv.name} - invitations.csv`)}>Download invitations (CSV)</button>}</div>
      {sv.status === 'draft' && d.people.length > 0 && man && <div className="note info" style={{ margin: '0 16px 10px' }}>Codes are ready. Open the survey to start collecting, then send each person their invitation.</div>}
      <div className="scrollx"><table className="t">
        <thead><tr><th>Person</th><th>Facility</th><th>Department</th>{man && <><th>Code</th><th>Invitation</th></>}<th>Answered</th>{man && <th />}</tr></thead>
        <tbody>{list.slice(0, 300).map((p) => (
          <tr key={p.id}>
            <td>{man ? <><b>{p.name}</b><div className="muted mono small">{p.email}</div></> : <span className="muted">—</span>}</td>
            <td className="small">{p.facility}</td><td className="muted small">{p.department ?? ''}</td>
            {man && <><td className="mono"><b>{p.code}</b></td>
              <td>{sv.status === 'draft' ? <span className="muted small">after opening</span> : <>
                {p.email && <a className="btn sm" href={mailto(p)} onClick={() => void sent([p.id])}>Email</a>}{' '}
                <button className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(invite(p)); toast('Invitation copied'); void sent([p.id]); } catch { toast('Copy is not allowed here — use Download invitations'); } }}>Copy text</button>
                {p.sent_at && <div className="muted small">sent {day(p.sent_at)}</div>}</>}</td></>}
            <td>{p.answered_at ? <span className="chip">{day(p.answered_at)}{p.entered_by ? ' · entered' : ''}</span> : man && !['published', 'draft'].includes(sv.status) ? <button className="btn sm ghost" onClick={() => onBehalf(p)}>Enter on their behalf</button> : <span className="muted">—</span>}</td>
            {man && <td>{!p.answered_at && !pubd && <button className="btn sm ghost" aria-label="Remove" onClick={() => api.removeSurveyPerson(sv.id, p.id).then(reload).catch((e) => toast((e as Error).message))}>✕</button>}</td>}
          </tr>))}
          {!list.length && <tr><td colSpan={7} className="muted">No one yet.</td></tr>}</tbody>
      </table></div>
      {list.length > 300 && <div className="muted small" style={{ padding: '8px 16px' }}>Showing 300 of {list.length} — search to narrow.</div>}
      <p className="muted small" style={{ padding: '0 16px 12px', margin: 0 }}>“Email” opens your mail app with the personal invitation; “Download invitations” gives a CSV (name, email, code, link, invitation text) for a mail merge from a company address. People answer at <span className="mono">{d.link}</span> with their code — no account needed.</p>
    </section>
  </>;
}

function Questions({ d, man, reload, preview }: { d: SurveyDetail; man: boolean; reload: () => Promise<unknown>; preview: () => void }) {
  const { toast } = useApp();
  const sv = d.survey;
  const [weeks, setWeeks] = useState(String(sv.weeks));
  const [due, setDue] = useState(sv.close_at ?? '');
  const save = (b: Parameters<typeof api.patchSurvey>[1]) => api.patchSurvey(sv.id, b).then(() => { toast('Saved'); return reload(); }).catch((e) => toast((e as Error).message));
  return (
    <div className="grid2">
      <section className="card" style={{ display: 'grid', gap: 10 }}><h2 style={{ fontSize: 16, margin: 0 }}>What people are asked</h2>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}><li>Which site do you usually work at?</li><li>On a typical week, how many days do you travel to work?</li>{sv.wfh && <li>How many days do you work from home?</li>}
          <li>How do you usually travel? (main way)</li><li>One-way distance for the main way, in km</li><li>Do you change to a second way for part of the trip? Which, and how far?</li><li>If by car: fuel, and for a car pool, how many people share it</li></ol>
        <div><button className="btn" onClick={preview}>Preview the form</button></div>
      </section>
      <section className="card" style={{ display: 'grid', gap: 10 }}><h2 style={{ fontSize: 16, margin: 0 }}>Calculation settings</h2>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 230 }}><span>Working weeks per year · after leave and holidays</span><input className="input" inputMode="numeric" disabled={!man} value={weeks} onChange={(e) => setWeeks(e.target.value.replace(/\D/g, ''))} onBlur={() => Number(weeks) !== sv.weeks && Number(weeks) >= 1 && Number(weeks) <= 52 && save({ weeks: Number(weeks) })} /></label>
          <label className="field" style={{ width: 180 }}><span>Answers due by</span><input className="input" type="date" disabled={!man} value={due} onChange={(e) => setDue(e.target.value)} onBlur={() => due !== (sv.close_at ?? '') && save({ closeAt: due || null })} /></label>
        </div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={sv.wfh} disabled={!man} onChange={() => save({ wfh: !sv.wfh })} /> Include home-working emissions (DESNZ office equipment per FTE hour × 8 h a day; indicative — heating is not counted, home cooling is not covered by DESNZ)</label>
        <div className="note info" style={{ margin: 0 }}><b>Method (GHG Protocol, distance-based)</b><ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Yearly km per person = one-way km × 2 × days per week × working weeks.</li><li>Car-pool km are divided by the people sharing the car.</li>
          <li>kg CO₂e = km × the DESNZ land travel factor for that mode and car fuel, with well-to-tank.</li>
          <li>Facility estimate = average per respondent × headcount. A facility with no answers uses the company-wide average and is flagged.</li></ul></div>
      </section>
    </div>
  );
}

function Responses({ d }: { d: SurveyDetail; opt: SurveyOptions }) {
  const people = new Map(d.people.map((p) => [p.id, p]));
  const lab = (k?: string) => (k ? OPTS_LABEL(k) : '');
  return (
    <section className="card flush">
      <div className="scrollx"><table className="t">
        <thead><tr><th>Respondent</th><th>Facility</th><th className="num">Days / week</th><th>Main way</th><th className="num">One-way km</th><th>Second way</th><th className="num">kg CO₂e / yr</th><th>Answered</th></tr></thead>
        <tbody>{d.answers.map((r) => { const a = r.answers, l0 = a.legs[0], l1 = a.legs[1], p = people.get(r.participant_id); return (
          <tr key={r.id}><td>{p?.name ?? '—'}{r.entered_by && <div className="muted small">entered by {r.entered_by}</div>}</td><td className="small">{r.facility}</td>
            <td className="num">{a.days}{d.survey.wfh && a.wfh ? <span className="muted"> +{a.wfh} home</span> : null}</td>
            <td className="small">{lab(l0?.mode)}{l0 && ['car', 'carpool'].includes(l0.mode) ? ` · ${a.fuel}${l0.mode === 'carpool' ? ` · ${a.occ} sharing` : ''}` : ''}</td>
            <td className="num">{l0?.km ?? 0}</td><td className="small">{l1 ? `${lab(l1.mode)} · ${l1.km} km` : '—'}</td><td className="num"><b>{f0(r.kg)}</b></td><td className="muted small">{day(r.updated_at)}</td></tr>); })}
          {!d.answers.length && <tr><td colSpan={8} className="muted">No answers yet.</td></tr>}</tbody>
      </table></div>
      <p className="muted small" style={{ padding: '8px 16px 12px', margin: 0 }}>Individual answers are visible to admins only; published figures are averages per facility.</p>
    </section>
  );
}

function Results({ d, man, reload }: { d: SurveyDetail; opt: SurveyOptions; man: boolean; reload: () => Promise<unknown> }) {
  const { toast } = useApp();
  const sv = d.survey, res = d.results, pubd = sv.status === 'published';
  const [head, setHead] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<PublishRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (d.canPublish && res.n) api.publishSurvey(sv.id, true).then((r) => setPlan(r.facilities)).catch(() => setPlan(null)); }, [sv.id, res.n, res.N, sv.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = Object.entries(res.byItem).sort((a, b) => b[1].t - a[1].t);
  const mt = items.reduce((s, [, v]) => s + v.t, 0) || 1;
  const depts = Object.entries(res.byDept).sort((a, b) => b[1].kg / b[1].n - a[1].kg / a[1].n);
  const unitName = (u: string) => (u === 'pkm' ? 'passenger-km' : u === 'fte_h' ? 'FTE hours' : 'km');
  const publish = async () => {
    setBusy(true);
    try {
      const r = await api.publishSurvey(sv.id, false);
      const ok = r.facilities.filter((x) => x.status === 'ok');
      toast(`${ok.length} facilit${ok.length === 1 ? 'y' : 'ies'} published · ${ok.reduce((s, x) => s + (x.entries ?? 0), 0)} monthly entries${r.facilities.length > ok.length ? ` · ${r.facilities.length - ok.length} skipped` : ''}`);
      await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <section className="card flush">
      <div className="row" style={{ padding: '12px 16px' }}><h2 style={{ fontSize: 16, margin: 0 }}>Scaled up to the headcount</h2><span className="grow" /><span className="muted small">Headcount comes from each facility's details; change it here for this survey.</span></div>
      <div className="scrollx"><table className="t">
        <thead><tr><th>Facility</th><th className="num">Headcount</th><th className="num">Answers</th><th>Sample</th><th className="num">Avg kg CO₂e / person</th><th className="num">tCO₂e / year</th><th className="num">95% range</th><th>Note</th></tr></thead>
        <tbody>{res.facs.map((x) => (
          <tr key={x.id}><td><b>{x.name}</b></td>
            <td className="num">{man ? <input className="input num" style={{ width: 90 }} inputMode="numeric" value={head[x.id] ?? String(x.N)} onChange={(e) => setHead({ ...head, [x.id]: e.target.value.replace(/\D/g, '') })}
              onBlur={() => { const v = head[x.id]; if (v !== undefined && Number(v) !== x.N) api.patchSurvey(sv.id, { headcount: { [x.id]: Number(v) } }).then(() => { toast('Headcount saved'); return reload(); }).catch((e) => toast((e as Error).message)); }} /> : f0(x.N)}</td>
            <td className="num">{x.n}</td>
            <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><div className="mbar" style={{ width: 70 }}><span style={{ width: `${Math.min(100, x.rate * 100)}%`, background: x.low ? 'var(--s3)' : 'var(--primary)' }} /></div><span className="small">{(x.rate * 100).toFixed(0)}%</span></div></td>
            <td className="num">{f0(x.mean)}</td><td className="num"><b>{f1(x.t)}</b></td><td className="num muted small">{x.moe === null ? '—' : `±${f1(x.moe)}`}</td>
            <td>{x.useG ? <span className="chip warn">No answers — company average used</span> : x.low ? <span className="chip warn">Small sample</span> : <span className="chip">OK</span>}</td></tr>))}
          <tr><td><b>Total</b></td><td className="num"><b>{f0(res.N)}</b></td><td className="num"><b>{res.n}</b></td><td /><td /><td className="num"><b>{f1(res.tot)}</b></td><td className="num muted small">{f0(res.totLo)}–{f0(res.totHi)}</td><td /></tr></tbody>
      </table></div>
      <div style={{ padding: '10px 16px', display: 'grid', gap: 6 }}><span className="lbl">By mode (scaled)</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{items.map(([k, v]) => <span key={k} className="chip grey">{v.name} · {f0(v.q)} {unitName(v.unit)} · {f1(v.t)} t</span>)}</div>
        <span className="muted small">Small sample = fewer than 30 answers or 10% of headcount at that facility. The 95% range shows how much the estimate could move with a different sample.</span></div>
    </section>
    <section className="card" style={{ display: 'grid', gap: 10 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Publish into Scope 3 · Employee commuting</h2>
      {pubd && <div className="note ok" style={{ margin: 0 }}>Published {day(sv.published_at, true)}{sv.published_by_name ? ` by ${sv.published_by_name}` : ''}: {(sv.published ?? []).filter((x) => x.status === 'ok').map((x) => `${x.name} ${f1(x.t)} t`).join(' · ')}. Reopen the survey to change answers, then publish again: that replaces these figures.</div>}
      <p className="sub" style={{ margin: 0 }}>Each facility gets its commuting record for {sv.year} — the same as typing it in under Add data → Employee commuting — with one entry per mode and month (the year split by working days), waiting for the usual approver. Publishing again replaces it.</p>
      {plan && <table className="t"><thead><tr><th>Facility</th><th className="num">tCO₂e / year</th><th>What happens</th></tr></thead>
        <tbody>{plan.map((x) => <tr key={x.facilityId}><td>{x.name}</td><td className="num">{f1(x.t)}</td><td className="small">{x.status === 'ok' ? (x.replaces ? <span className="chip warn">Replaces {x.replaces}</span> : <span className="chip">New record</span>) : <span className="chip bad">Skipped: {x.reason}</span>}</td></tr>)}</tbody></table>}
      <div className="row"><button className="btn p" disabled={busy || !d.canPublish || !res.n || pubd} onClick={publish}>{busy ? 'Publishing…' : `Publish · ${f1(res.tot)} tCO₂e for ${sv.year}`}</button>
        {sv.status === 'open' && <span className="muted small">You can publish while still collecting; reopen and publish again later to update.</span>}</div>
    </section>
    <div className="grid2">
      <section className="card" style={{ display: 'grid', gap: 6 }}><h2 style={{ fontSize: 16, margin: 0 }}>Emissions by mode (scaled)</h2>
        {items.map(([k, v]) => <div key={k} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span style={{ width: 190, flex: 'none', fontSize: 12.5 }}>{v.name}</span><div className="mbar" style={{ flex: 1 }}><span style={{ width: `${(v.t / mt) * 100}%`, background: 'var(--s3)' }} /></div><b style={{ width: 80, textAlign: 'right', fontSize: 12.5 }}>{f1(v.t)} t</b></div>)}
        {!items.length && <span className="muted">No answers yet.</span>}</section>
      <section className="card flush"><h2 style={{ fontSize: 16, margin: 0, padding: '12px 16px' }}>By department (respondents)</h2>
        <table className="t"><thead><tr><th>Department</th><th className="num">Answers</th><th className="num">Avg kg CO₂e / person / yr</th></tr></thead>
          <tbody>{depts.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{f0(v.kg / v.n)}</td></tr>)}</tbody></table></section>
    </div>
  </>;
}

function Actions({ d }: { d: SurveyDetail; opt: SurveyOptions }) {
  const res = d.results, tot = res.tot || 0, n = res.n || 1, carShare = ((res.modes.car ?? 0) + (res.modes.taxi ?? 0)) / n;
  const ideas: [string, string, number][] = [
    ['Expand staff shuttle service', `Shuttle routes from the main residential areas; ${Math.round(carShare * 100)}% of respondents drive alone or take taxis.`, 0.15 * 0.3],
    ['Car-pool matching and parking incentives', 'Reserved car-pool parking and an internal matching board.', 0.1 * 0.25],
    ['Hybrid working (1 home day a week)', 'One home day a week for office roles removes about 20% of commuting trips.', 0.2 * 0.6],
    ['EV charging for employees', 'Workplace charging and EV salary-sacrifice for car commuters.', 0.15 * 0.2],
  ];
  return <>
    <section className="card" style={{ display: 'grid', gap: 10 }}><div><h2 style={{ fontSize: 16, margin: 0 }}>Reduce your employees’ commuting emissions</h2>
      <div className="muted small">Estimated from this survey ({f0(tot)} tCO₂e a year). Indicative savings; the action portfolio comes with Targets & actions.</div></div>
      {ideas.map(([name, why, f]) => <div key={name} className="svitem"><span style={{ flex: 1 }}><b>{name}</b><small>{why} About {f0(tot * f)} tCO₂e a year.</small></span></div>)}
    </section>
    <section className="card" style={{ display: 'grid', gap: 8 }}><h2 style={{ fontSize: 16, margin: 0 }}>Employee survey documentation</h2>
      {[['Sending the employee survey', 'People tab → Open & send invitations; each person gets a personal code.'], ['Making sure invitations arrive', 'Send from a company address; ask IT to allow-list it; use “Send to unanswered” after a week.'],
        ['Email template', 'Use “Copy text” on a person or download the invitations CSV for a mail merge.'], ['Extrapolation of answers', 'Average kg CO₂e per respondent at each facility × headcount; facilities with no answers use the company average and are flagged.'],
        ['Train your employees', 'Share the results by mode and the actions above.']].map(([t, x]) => <div key={t} className="svitem"><span className="chip grey">Guide</span><span style={{ flex: 1 }}><b>{t}</b><small>{x}</small></span></div>)}
    </section>
  </>;
}

/** Mode labels for the tabs (from the server's options). */
