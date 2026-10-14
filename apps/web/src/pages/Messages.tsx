/**
 * Message centre (Help). Company people: conversations with the Ekotrace team and announcements from it.
 * Platform admin: the team inbox (every company's conversations) and the announcements composer.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, ROLE_LABEL, type Announcement, type Company, type Msg, type MsgThread } from '../lib/api';
import { FilePreview, FileTag, sizeOf } from '../components/FilePreview';
import { BRAND, productSlug } from '../lib/brand';

/** The parts of Ekotrace a question can be about (the page it was asked from is chosen by default). */
const PAGES: [string, string][] = [['', 'General'], ['/data', 'Add data'], ['/entries', 'Entries & results'], ['/approvals', 'Approvals'], ['/progress', 'Data progress'], ['/vault', 'Document vault'],
  ['/qr', 'QR & field app'], ['/suppliers', 'Suppliers'], ['/dashboards', 'Dashboards'], ['/kpis', 'KPI dashboard'], ['/targets', 'Targets & actions'], ['/reports', 'Reports'], ['/assurance', 'Audit & assurance'],
  ['/organisation', 'Organisation & groups'], ['/people', 'People & access'], ['/methodology', 'Methodology & boundaries'], ['/integrations', 'Integrations & API']];
const pageName = (p: string | null) => PAGES.find(([k]) => k && p?.startsWith(k))?.[1] ?? (p ? p : 'General');
const KIND: Record<Announcement['kind'], [string, string]> = { news: ['News', 'info'], feature: ['New feature', ''], factors: ['Emission factors', 'info'], maintenance: ['Maintenance', 'warn'], regulation: ['Regulation', 'grey'] };
const STATUS = (s: MsgThread['status'], team = false): [string, string] => s === 'closed' ? ['Closed', 'grey'] : s === 'answered' ? [team ? 'Answered' : 'Answered', ''] : [team ? 'Needs reply' : 'Waiting for the team', 'warn'];
const when = (x: string) => { const d = new Date(x); const today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const stamp = (x: string) => new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Messages() {
  const { role } = useApp();
  return role === 'platform_admin' ? <TeamInbox /> : <CompanyMessages />;
}

// ----------------------------------------------------------------------- company --
function CompanyMessages() {
  const { toast, me } = useApp();
  const [tab, setTab] = useState<'conv' | 'news'>('conv');
  const [filter, setFilter] = useState<'all' | 'open' | 'answered' | 'closed'>('all');
  const [d, setD] = useState<Awaited<ReturnType<typeof api.messages>> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { api.messages().then(setD).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (d?.threads ?? []).filter((t) => filter === 'all' || t.status === filter);
  const unreadNews = d?.announcements.filter((a) => !a.read).length ?? 0;
  const unreadConv = d?.threads.filter((t) => t.unread).length ?? 0;
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Help</span><h1>Message centre</h1>
          <div className="muted">Ask the {BRAND.name} team anything — how to enter something, a problem, an idea — and read the team's announcements. {d?.companyWide ? 'As super admin you see every conversation from your company.' : 'You see your own conversations.'}</div></div>
        <span className="grow" />
        <Link to="/help" className="btn">User manual</Link>
        <button className="btn p" onClick={() => { setTab('conv'); setCompose(true); setSel(null); }}>+ New message</button>
      </div>
      <div className="seg strong" role="tablist">
        <button role="tab" aria-selected={tab === 'conv'} className={tab === 'conv' ? 'on' : ''} onClick={() => setTab('conv')}>✉ Conversations{unreadConv ? <span className="segn">{unreadConv}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'news'} className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>📣 Announcements{unreadNews ? <span className="segn">{unreadNews}</span> : null}</button>
      </div>
      {!d ? <div className="card empty">Loading…</div> : tab === 'news' ? <News items={d.announcements} onRead={reload} /> : (
        <div className="msggrid">
          <section className="card mlist">
            <div className="seg mini">{([['all', 'All'], ['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
            {list.map((t) => <ThreadRow key={t.id} t={t} on={sel === t.id} showWho={d.companyWide && t.created_by !== me.user.id} onClick={() => { setSel(t.id); setCompose(false); }} topics={d.topics} />)}
            {!list.length && <div className="muted small" style={{ padding: 10 }}>{d.threads.length ? 'Nothing here.' : 'No conversations yet.'}</div>}
          </section>
          <section className="card mthread">
            {compose ? <Compose topics={d.topics} onCancel={() => setCompose(false)} onSent={(id) => { setCompose(false); setSel(id); reload(); }} />
              : sel ? <CompanyThread id={sel} onChange={reload} />
                : <div className="mempty"><div className="mbig">✉</div><b>Pick a conversation, or start a new one</b><span className="muted small">The team usually replies within one working day. You'll see a count on Message centre in the menu when they do.</span>
                  <button className="btn p" onClick={() => setCompose(true)}>+ New message</button></div>}
          </section>
        </div>)}
    </div>);
}

function ThreadRow({ t, on, onClick, topics, showWho, team }: { t: MsgThread; on: boolean; onClick: () => void; topics: Record<string, string>; showWho?: boolean; team?: boolean }) {
  const [s, c] = STATUS(t.status, team);
  return (
    <button type="button" className={`mrow${on ? ' on' : ''}`} onClick={onClick}>
      {t.unread ? <i className="udot" aria-label="Unread" /> : <i className="udot off" />}
      <span className="grow">
        {team && <span className="lbl">{t.company}</span>}
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><b className="grow">{t.subject}</b><span className="muted small nowrap">{when(t.last_at)}</span></span>
        <span className="muted small mprev">{t.last_body}</span>
        <span className="row" style={{ gap: 6, marginTop: 3 }}><span className={`chip ${c}`}>{s}</span><span className="chip grey">{topics[t.topic] ?? t.topic}</span>{(showWho || team) && <span className="muted small">{t.by_name}</span>}</span>
      </span>
    </button>);
}

function Bubbles({ messages, mineIsTeam, attachPath }: { messages: Msg[]; mineIsTeam: boolean; attachPath: (id: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  return (
    <div className="thread">
      {messages.map((m) => {
        const mine = m.from_team === mineIsTeam;
        return (
          <div key={m.id} className={`bub${mine ? ' mine' : ''}${m.from_team ? ' team' : ''}`}>
            <div className="row" style={{ gap: 6, fontSize: 11.5 }}><b>{m.author_name}</b>{m.from_team && <span className="chip teamchip">{BRAND.name} team</span>}<span className="muted">{stamp(m.created_at)}</span></div>
            <div className="mbody">{m.body}</div>
            {m.document_id && m.filename && <>
              <button type="button" className="mattach" onClick={() => setOpen(open === m.id ? null : m.id)}><FileTag name={m.filename} /><span><b>{m.filename}</b><span className="muted small">{m.size ? sizeOf(m.size) : ''} · {open === m.id ? 'hide' : 'show'}</span></span></button>
              {open === m.id && <FilePreview path={attachPath(m.document_id)} filename={m.filename} contentType={m.content_type ?? ''} height={320} />}
            </>}
          </div>);
      })}
      <div ref={end} />
    </div>);
}

function Attach({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  return file ? <span className="row small" style={{ gap: 6 }}><FileTag name={file.name} />{file.name} · {sizeOf(file.size)}<button type="button" className="btn ghost xs" onClick={() => setFile(null)}>Remove</button></span>
    : <label className="btn sm ghost">📎 Attach a screenshot or file<input type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.xlsx,.csv,.docx,.txt" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} /></label>;
}

function Compose({ topics, onCancel, onSent }: { topics: Record<string, string>; onCancel: () => void; onSent: (id: string) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ topic: 'question', subject: '', page: '', body: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const doc = file ? (await api.msgAttach(file)).documentId : undefined;
      const r = await api.newMessage({ ...f, page: f.page || undefined, documentId: doc });
      toast(`Sent to the ${BRAND.name} team`); onSent(r.id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="mcompose">
      <h2>New message to the {BRAND.name} team</h2>
      <div className="vform">
        <label className="field"><span>Topic</span><select className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>{Object.entries(topics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Which part of {BRAND.name}</span><select className="input" value={f.page} onChange={(e) => setF({ ...f, page: e.target.value })}>{PAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field span2"><span>Subject</span><input className="input" value={f.subject} maxLength={160} placeholder="e.g. How do I enter district cooling billed in TRh?" onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <label className="field span2"><span>Message</span><textarea className="input" rows={7} value={f.body} maxLength={5000} placeholder="What were you trying to do, and what happened? Facility, month and a screenshot help." onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      </div>
      <Attach file={file} setFile={setFile} />
      <div className="muted small">Please don't send passwords or access codes here.</div>
      <div className="row"><button className="btn p" disabled={busy || f.subject.trim().length < 3 || f.body.trim().length < 2} onClick={send}>{busy ? 'Sending…' : 'Send'}</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>);
}

function CompanyThread({ id, onChange }: { id: string; onChange: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.messageThread>> | null>(null);
  const [reply, setReply] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { setD(null); api.messageThread(id).then((x) => { setD(x); onChange(); window.dispatchEvent(new Event('eko-msg')); }).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="muted">Loading…</div>;
  const t = d.thread; const [s, c] = STATUS(t.status);
  const send = async () => {
    setBusy(true);
    try { const doc = file ? (await api.msgAttach(file)).documentId : undefined; await api.replyMessage(id, { body: reply, documentId: doc }); setReply(''); setFile(null); setTick((x) => x + 1); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div><span className="lbl">{pageName(t.page)}</span><h2>{t.subject}</h2>
        <div className="row" style={{ gap: 6, marginTop: 4 }}><span className={`chip ${c}`}>{s}</span><span className="muted small">started by {t.by_name} · {stamp(t.created_at)}</span></div></div>
      <Bubbles messages={d.messages} mineIsTeam={false} attachPath={(x) => `/api/messages/attachments/${x}`} />
      <div className="mreply">
        <textarea className="input" rows={3} value={reply} maxLength={5000} placeholder={t.status === 'closed' ? 'Write to reopen this conversation…' : 'Add a reply or more detail…'} onChange={(e) => setReply(e.target.value)} />
        <div className="row" style={{ gap: 8 }}><button className="btn p" disabled={busy || reply.trim().length < 2} onClick={send}>{busy ? 'Sending…' : t.status === 'closed' ? 'Send & reopen' : 'Send'}</button><Attach file={file} setFile={setFile} /><span className="grow" />
          {t.status !== 'closed' && <button className="btn ghost sm" onClick={async () => { try { await api.closeMessage(id); toast('Marked resolved'); setTick((x) => x + 1); } catch (e) { toast((e as Error).message); } }}>Mark resolved</button>}</div>
      </div>
    </>);
}

function News({ items, onRead }: { items: Announcement[]; onRead: () => void }) {
  const { toast } = useApp();
  const unread = items.filter((a) => !a.read).length;
  const read = async (fn: () => Promise<unknown>) => { try { await fn(); onRead(); window.dispatchEvent(new Event('eko-msg')); } catch (e) { toast((e as Error).message); } };
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row"><h2 className="grow">From the {BRAND.name} team</h2>{unread > 0 && <button className="btn sm" onClick={() => read(() => api.readAllAnnouncements())}>Mark all read</button>}</div>
      {!items.length && <div className="empty">No announcements.</div>}
      {items.map((a) => (
        <article key={a.id} className={`ann${a.read ? '' : ' new'}`}>
          <div className="row" style={{ gap: 8 }}><span className={`chip ${KIND[a.kind][1]}`}>{KIND[a.kind][0]}</span><b className="grow">{a.title}</b><span className="muted small">{stamp(a.published_at)}</span></div>
          <div className="mbody">{a.body}</div>
          {!a.read && <div><button className="btn ghost xs" onClick={() => read(() => api.readAnnouncement(a.id))}>Mark read</button></div>}
        </article>))}
    </section>);
}

// -------------------------------------------------------------------------- team --
function TeamInbox() {
  const { toast } = useApp();
  const [tab, setTab] = useState<'inbox' | 'news'>('inbox');
  const [status, setStatus] = useState<'waiting' | 'answered' | 'closed' | 'all'>('waiting');
  const [d, setD] = useState<Awaited<ReturnType<typeof api.teamMessages>> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { api.teamMessages(status).then(setD).catch((e) => toast((e as Error).message)); }, [status, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <div className="row tahead"><div><span className="lbl">Platform console</span><h1>Messages</h1><div className="muted">Questions from every company, newest waiting first, and announcements to companies.</div></div></div>
      <div className="seg strong" role="tablist">
        <button role="tab" aria-selected={tab === 'inbox'} className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>✉ Team inbox{d?.counts.waiting ? <span className="segn">{d.counts.waiting}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'news'} className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>📣 Announcements</button>
      </div>
      {tab === 'news' ? <Publisher /> : (
        <div className="msggrid">
          <section className="card mlist">
            <div className="seg mini">{([['waiting', 'Needs reply'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']] as const).map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}{d ? ` · ${d.counts[k] ?? 0}` : ''}</button>)}</div>
            {d?.threads.map((t) => <ThreadRow key={t.id} t={t} on={sel === t.id} team onClick={() => setSel(t.id)} topics={d.topics} />)}
            {d && !d.threads.length && <div className="muted small" style={{ padding: 10 }}>Nothing here.</div>}
          </section>
          <section className="card mthread">{sel ? <TeamThread id={sel} onChange={reload} topics={d?.topics ?? {}} /> : <div className="mempty"><div className="mbig">✉</div><b>Pick a conversation</b></div>}</section>
        </div>)}
    </div>);
}

function TeamThread({ id, onChange, topics }: { id: string; onChange: () => void; topics: Record<string, string> }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.teamThread>> | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { setD(null); api.teamThread(id).then((x) => { setD(x); onChange(); window.dispatchEvent(new Event('eko-msg')); }).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="muted">Loading…</div>;
  const t = d.thread; const [s, c] = STATUS(t.status, true);
  const send = async (close: boolean) => { setBusy(true); try { await api.teamReply(id, reply, close); setReply(''); toast(close ? 'Replied and closed' : 'Reply sent'); setTick((x) => x + 1); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  return (
    <>
      <div><span className="lbl">{t.company} · {topics[t.topic] ?? t.topic} · {pageName(t.page)}</span><h2>{t.subject}</h2>
        <div className="row" style={{ gap: 6, marginTop: 4 }}><span className={`chip ${c}`}>{s}</span><span className="muted small">{t.by_name} · {ROLE_LABEL[t.by_role]} · {t.by_email}{t.plan ? ` · ${t.plan} plan` : ''}</span></div></div>
      <Bubbles messages={d.messages} mineIsTeam attachPath={(x) => `/api/team/messages/attachments/${x}`} />
      <div className="mreply">
        <textarea className="input" rows={4} value={reply} maxLength={5000} placeholder={`Reply as the ${BRAND.name} team…`} onChange={(e) => setReply(e.target.value)} />
        <div className="row" style={{ gap: 8 }}>
          <button className="btn p" disabled={busy || reply.trim().length < 2} onClick={() => send(false)}>Send reply</button>
          <button className="btn" disabled={busy || reply.trim().length < 2} onClick={() => send(true)}>Send & close</button><span className="grow" />
          {t.status === 'closed' ? <button className="btn ghost sm" onClick={() => api.teamStatus(id, 'open').then(() => setTick((x) => x + 1))}>Reopen</button>
            : <button className="btn ghost sm" onClick={() => api.teamStatus(id, 'closed').then(() => setTick((x) => x + 1))}>Close without reply</button>}
        </div>
      </div>
    </>);
}

function Publisher() {
  const { toast } = useApp();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [cos, setCos] = useState<Company[]>([]);
  const [f, setF] = useState({ kind: 'news', title: '', body: '', expiresAt: '', to: 'all' as 'all' | 'some', ids: new Set<string>() });
  const [tick, setTick] = useState(0);
  useEffect(() => { api.teamAnnouncements().then((r) => setList(r.announcements)).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.companies().then((c) => setCos(c.companies)).catch(() => {}); }, []);
  const publish = async () => {
    try {
      await api.publishAnnouncement({ kind: f.kind, title: f.title, body: f.body, expiresAt: f.expiresAt || undefined, tenantIds: f.to === 'some' ? [...f.ids] : undefined });
      toast('Published'); setF({ ...f, title: '', body: '', expiresAt: '', ids: new Set() }); setTick((x) => x + 1);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="msggrid">
      <section className="card mcompose">
        <h2>New announcement</h2>
        <div className="vform">
          <label className="field"><span>Kind</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Show until (optional)</span><input className="input" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></label>
          <label className="field span2"><span>Title</span><input className="input" value={f.title} maxLength={160} placeholder="e.g. 2026 grid factors for the US, EU and Australia loaded" onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="field span2"><span>Message</span><textarea className="input" rows={6} value={f.body} maxLength={5000} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        </div>
        <div className="seg mini"><button className={f.to === 'all' ? 'on' : ''} onClick={() => setF({ ...f, to: 'all' })}>Every company</button><button className={f.to === 'some' ? 'on' : ''} onClick={() => setF({ ...f, to: 'some' })}>Chosen companies</button></div>
        {f.to === 'some' && <div className="vpicklist">{cos.map((c) => <label key={c.id} className="vpickrow"><input type="checkbox" checked={f.ids.has(c.id)} onChange={() => { const n = new Set(f.ids); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); setF({ ...f, ids: n }); }} /><span className="grow">{c.name}</span><span className="muted small">{c.country} · {c.plan}</span></label>)}</div>}
        <div className="row"><button className="btn p" disabled={f.title.trim().length < 3 || f.body.trim().length < 3 || (f.to === 'some' && !f.ids.size)} onClick={publish}>Publish{f.to === 'some' ? ` to ${f.ids.size}` : ' to everyone'}</button></div>
      </section>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2>Published</h2>
        {!list ? <div className="muted">Loading…</div> : !list.length ? <div className="empty">Nothing published yet.</div> : list.map((a) => (
          <article key={a.id} className={`ann${a.withdrawn_at ? ' dim' : ''}`}>
            <div className="row" style={{ gap: 8 }}><span className={`chip ${KIND[a.kind][1]}`}>{KIND[a.kind][0]}</span><b className="grow">{a.title}</b><span className="muted small">{stamp(a.published_at)}</span></div>
            <div className="mbody">{a.body}</div>
            <div className="row muted small" style={{ gap: 10 }}><span>To {a.companies?.length ? a.companies.join(', ') : 'every company'}</span><span>Read by {a.reads ?? 0}</span>{a.expires_at && <span>until {new Date(a.expires_at).toLocaleDateString('en-GB')}</span>}
              {a.withdrawn_at ? <span className="chip grey">Withdrawn</span> : <button className="btn ghost xs" onClick={() => api.withdrawAnnouncement(a.id).then(() => setTick((x) => x + 1))}>Withdraw</button>}</div>
          </article>))}
      </section>
    </div>);
}
