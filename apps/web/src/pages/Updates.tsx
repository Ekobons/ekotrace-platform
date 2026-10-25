/**
 * Weekly updates (platform admin): what the weekly research run found — emission factor releases,
 * CBAM, US CPI, exchange rates, tech and market news — and the draft LinkedIn posts.
 * Exchange rates and the CPI are applied with one click; everything else names the screen to use
 * and is marked done. Nothing is applied or posted by itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, type UpdateItem, type UpdatePost, type UpdatesData } from '../lib/api';

const STREAM: Record<UpdateItem['stream'], string> = {
  factors: 'Emission factors', cbam: 'CBAM', cpi: 'US CPI', fx: 'Exchange rates', regulation: 'Regulation', tech: 'Tech', market: 'Market',
};
const STATUS: Record<UpdateItem['status'], [string, string]> = { new: ['To review', 'warn'], applied: ['Applied', ''], done: ['Done', ''], dismissed: ['Dismissed', 'grey'] };
const POST: Record<UpdatePost['status'], [string, string]> = { draft: ['Draft', 'warn'], approved: ['Approved', 'info'], rejected: ['Rejected', 'grey'], posted: ['Posted', ''] };
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** Internal screens an item can point to. */
const SCREENS: [RegExp, string][] = [[/factor|librar|desnz|epa|grid/i, '/library'], [/cbam/i, '/cbam'], [/currenc|price index|cpi/i, '/currency']];

export function Updates() {
  const { toast } = useApp();
  const [d, setD] = useState<UpdatesData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [week, setWeek] = useState<string>('');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const load = () => api.updates().then((x) => { setD(x); setErr(null); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);
  const weeks = useMemo(() => [...new Set([...(d?.items ?? []).map((i) => i.week), ...(d?.posts ?? []).map((p) => p.week), ...(d?.weeks ?? []).map((w) => w.week)])].sort().reverse(), [d]);
  const sel = week || weeks[0] || '';
  const summary = d?.weeks.find((w) => w.week === sel)?.summary;
  const items = (d?.items ?? []).filter((i) => (show === 'open' ? i.status === 'new' : i.week === sel));
  const posts = (d?.posts ?? []).filter((p) => (show === 'open' ? p.status === 'draft' : p.week === sel));
  const open = (d?.items ?? []).filter((i) => i.status === 'new').length + (d?.posts ?? []).filter((p) => p.status === 'draft').length;

  async function decide(i: UpdateItem, action: 'apply' | 'done' | 'dismiss' | 'reopen') {
    try {
      const r = await api.decideUpdate(i.key, action);
      toast(action === 'apply' ? `${r.rows} ${i.apply?.kind === 'cpi' ? 'index value' : 'rate'}${r.rows === 1 ? '' : 's'} saved` : action === 'reopen' ? 'Back to review' : action === 'done' ? 'Marked done' : 'Dismissed');
      window.dispatchEvent(new Event('eko-updates')); load();
    } catch (e) { toast((e as Error).message); }
  }
  async function post(p: UpdatePost, status: UpdatePost['status'], body?: string) {
    try { await api.updatePost(p.key, { status, ...(body ? { body } : {}) }); window.dispatchEvent(new Event('eko-updates')); load(); } catch (e) { toast((e as Error).message); }
  }

  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Ekobon · platform</div><h1>Weekly updates</h1>
        <p className="sub">Found every Monday by the weekly research run: emission factor releases, CBAM, US CPI, exchange rates, tech and market news, and LinkedIn drafts. Nothing is applied or posted until you decide here.</p></div></div>
      {err && <div className="note bad">{err}</div>}
      <div className="tabs">
        <button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>To review ({open})</button>
        <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>By week</button>
      </div>
      {show === 'all' && weeks.length > 0 && <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {weeks.map((w) => <button key={w} type="button" className={`chipbtn${w === sel ? ' on' : ''}`} onClick={() => setWeek(w)}>Week of {longDate(w)}</button>)}</div>}
      {show === 'all' && summary && <div className="card"><div className="sub">{summary}</div></div>}
      {d && !weeks.length && <div className="card empty"><h2>No weekly update yet</h2><p className="sub">The first run is on Monday. Its file is added to <span className="mono">data/updates</span> in the code; after <span className="mono">git pull</span> and a restart it appears here.</p></div>}
      {d && weeks.length > 0 && !items.length && !posts.length && <div className="card empty"><p className="sub">{show === 'open' ? 'Nothing waiting. Earlier weeks are under By week.' : 'Nothing this week.'}</p></div>}

      {items.length > 0 && <div className="card" style={{ padding: 0 }}>
        <table className="t">
          <thead><tr><th>Update</th><th>Stream</th><th className="ctr">Published</th><th>What to do</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>{items.map((i) => {
            const screen = SCREENS.find(([re]) => re.test(i.whereTo))?.[1];
            const [sl, sc] = STATUS[i.status];
            return (
              <tr key={i.key}>
                <td style={{ maxWidth: 460 }}><b>{i.title}</b>{i.detail && <div className="small">{i.detail}</div>}
                  {i.impact && <div className="small muted" style={{ marginTop: 4 }}>Impact: {i.impact}</div>}
                  {i.sources.length > 0 && <div className="small" style={{ marginTop: 4 }}>{i.sources.map((s, n) => <span key={n}>{n > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></span>)}</div>}
                  {i.apply && <details className="small" style={{ marginTop: 4 }}><summary>{i.apply.rows.length} {i.apply.kind === 'fx' ? 'exchange rate' : 'index value'}{i.apply.rows.length === 1 ? '' : 's'}</summary>
                    <table className="t compact"><tbody>{i.apply.kind === 'fx'
                      ? i.apply.rows.map((r) => <tr key={`${r.currency}${r.month}`}><td>{r.currency}</td><td>{r.month}</td><td className="num">{r.perUsd} per USD</td></tr>)
                      : i.apply.rows.map((r) => <tr key={`${r.region}${r.year}`}><td>{r.region} CPI-U</td><td>{r.year}</td><td className="num">{r.value}</td></tr>)}</tbody></table>
                    <div className="muted">{i.apply.rows[0]?.source}</div></details>}
                </td>
                <td>{STREAM[i.stream]}<div className="small muted">week of {longDate(i.week)}</div></td>
                <td className="ctr">{i.published ? longDate(i.published) : '—'}</td>
                <td className="small" style={{ maxWidth: 220 }}>{i.apply ? 'Apply saves them as shared rates for every company' : i.whereTo || 'For information'}
                  {screen && !i.apply && <div><Link to={screen}>Open</Link></div>}</td>
                <td className="ctr"><span className={`chip ${sc}`}>{sl}</span>{i.decidedName && <div className="small muted">{i.decidedName}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{i.status === 'new'
                  ? <div className="row" style={{ gap: 6 }}>{i.apply
                    ? <button className="btn sm p" onClick={() => decide(i, 'apply')}>Apply</button>
                    : <button className="btn sm p" onClick={() => decide(i, 'done')}>Mark done</button>}
                    <button className="btn sm ghost" onClick={() => decide(i, 'dismiss')}>Dismiss</button></div>
                  : i.status !== 'applied' && <button className="btn sm ghost" onClick={() => decide(i, 'reopen')}>Reopen</button>}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>}

      {posts.length > 0 && <>
        <h2 style={{ margin: '20px 0 8px' }}>LinkedIn drafts</h2>
        <div className="grid2">{posts.map((p) => <PostCard key={p.key} p={p} onStatus={(s, body) => post(p, s, body)} />)}</div>
      </>}
    </div>
  );
}

function PostCard({ p, onStatus }: { p: UpdatePost; onStatus: (s: UpdatePost['status'], body?: string) => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState<string | null>(null);
  const [sl, sc] = POST[p.status];
  return (
    <div className="card">
      <div className="row"><h3 className="grow">{p.title}</h3><span className={`chip ${sc}`}>{sl}</span></div>
      {edit == null ? <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{p.body}</div>
        : <textarea value={edit} onChange={(e) => setEdit(e.target.value)} rows={10} style={{ width: '100%' }} />}
      <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {p.status === 'draft' && edit == null && <><button className="btn sm p" onClick={() => onStatus('approved')}>Approve</button>
          <button className="btn sm" onClick={() => setEdit(p.body)}>Edit</button><button className="btn sm ghost" onClick={() => onStatus('rejected')}>Reject</button></>}
        {edit != null && <><button className="btn sm p" onClick={() => { onStatus('draft', edit); setEdit(null); }}>Save</button><button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></>}
        {p.status === 'approved' && <><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(p.body).then(() => toast('Copied')).catch(() => {}); }}>Copy text</button>
          <button className="btn sm p" onClick={() => onStatus('posted')}>Mark posted</button></>}
        {p.status !== 'draft' && <button className="btn sm ghost" onClick={() => onStatus('draft')}>Back to draft</button>}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Week of {longDate(p.week)}{p.decidedName ? ` · ${p.decidedName}` : ''}. Posting is done on LinkedIn by you.</div>
    </div>
  );
}
