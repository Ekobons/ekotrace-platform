/**
 * Waste contractor portal (public page /contractor): sign in with the work email and the access code given by
 * the BEEAH contact. Collections (date, manifest, weighbridge weight, vehicle, ticket) for the bins assigned to the
 * contractor, and the monthly statement (tonnes per site, material and method, with the statement file).
 * Nothing sent here enters the emissions inventory without a BEEAH person's review.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { methodName } from '../lib/waste';
import { BrandMark } from '../components/BrandMark';
import { BRAND } from '../lib/brand';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TKEY = 'eko_contractor';
const getTok = () => { try { return sessionStorage.getItem(TKEY) ?? ''; } catch { return ''; } };
const setTok = (t: string) => { try { if (t) sessionStorage.setItem(TKEY, t); else sessionStorage.removeItem(TKEY); } catch { /* not kept */ } };
const fmt = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 2 });

async function call<T>(method: string, path: string, body?: unknown, file?: File): Promise<T> {
  const headers: Record<string, string> = { 'x-contractor-token': getTok() };
  if (file) { headers['content-type'] = 'application/octet-stream'; headers['x-filename'] = encodeURIComponent(file.name); }
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`/api/public/contractor${path}`, { method, headers, body: file ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { setTok(''); throw Object.assign(new Error(d.message ?? 'Sign in again'), { signOut: true }); }
  if (!r.ok) throw new Error(d.message ?? `Request failed (${r.status})`);
  return d as T;
}

type Bin = { id: string; code: string; name: string; location: string | null; facilityId: string; facility: string; itemId: number; item: string; material: string | null; route: string | null; gri: string | null; hazardous: boolean };
type Col = { id: string; bin: string; facility: string; at: string; kg: number; manifest: string | null; vehicle: string | null; note: string | null; status: string; documentId: string | null; byYou: boolean };
type Stmt = { id: string; year: number; month: number; lines: { facilityId: string; itemId: number; gri: string | null; tonnes: number }[]; note: string | null; status: string; reviewNote: string | null; submittedAt: string };
type Me = { contractor: string; company: string; bins: Bin[]; collections: Col[]; statements: Stmt[] };

export function ContractorPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!getTok()) { setMe(null); return; }
    try { setMe(await call<Me>('GET', '/me')); } catch (e) { setMe(null); if (!(e as { signOut?: boolean }).signOut) setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toast = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 4000); };
  const out = async () => { await call('POST', '/logout').catch(() => {}); setTok(''); setMe(null); };

  return (
    <div className="cportal">
      <header><BrandMark /><div><b>{BRAND.name}</b><small>Waste contractor portal</small></div><span className="grow" />
        {me && <><span className="small">{me.contractor} · for {me.company}</span><button className="btn sm ghost" onClick={() => void out()}>Sign out</button></>}</header>
      {!me ? <SignIn onDone={() => { setErr(null); void load(); }} err={err} /> : <Portal me={me} reload={load} toast={toast} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>);
}

function SignIn({ onDone, err }: { onDone: () => void; err: string | null }) {
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [e, setE] = useState<string | null>(err); const [busy, setBusy] = useState(false);
  const go = async (ev: React.FormEvent) => {
    ev.preventDefault(); setBusy(true); setE(null);
    try { const r = await call<{ token: string }>('POST', '/login', { email, code }); setTok(r.token); onDone(); } catch (x) { setE((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card csign" onSubmit={go}>
      <h1>Sign in</h1>
      <p className="muted">For waste collection and treatment companies. Use your work email and the access code your contact gave you. You see only the bins assigned to your company.</p>
      <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="email" value={email} onChange={(x) => setEmail(x.target.value)} /></label>
      <label className="field"><span>Access code</span><input className="input mono" autoComplete="one-time-code" style={{ letterSpacing: '.12em', textTransform: 'uppercase' }} value={code} onChange={(x) => setCode(x.target.value)} /></label>
      {e && <div className="note bad">{e}</div>}
      <button className="btn p" disabled={busy || !email || !code}>{busy ? 'Checking…' : 'Sign in'}</button>
      <a className="muted small" href="/">BEEAH staff: sign in here</a>
    </form>);
}

function Portal({ me, reload, toast }: { me: Me; reload: () => Promise<void>; toast: (m: string) => void }) {
  const [tab, setTab] = useState<'col' | 'stm' | 'bins'>('col');
  return <>
    <div className="seg strong" role="tablist">
      {([['col', '🚚 Collections'], ['stm', '🧾 Monthly statement'], ['bins', '▦ Your bins']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {!me.bins.length && <div className="note warn">No bins are assigned to your company yet. Ask your contact at {me.company} to set your company as the contractor of its bins.</div>}
    {tab === 'col' && <Collections me={me} reload={reload} toast={toast} />}
    {tab === 'stm' && <Statement me={me} reload={reload} toast={toast} />}
    {tab === 'bins' && <section className="card"><h2>Your bins · {me.bins.length}</h2>
      <table className="t"><thead><tr><th>Site</th><th>Bin</th><th>Material · method</th><th>Label code</th></tr></thead>
        <tbody>{me.bins.map((b) => <tr key={b.id}><td>{b.facility}</td><td><b>{b.name}</b><div className="muted small">{b.location ?? ''}</div></td>
          <td>{b.material ?? b.item}{b.hazardous && <> <span className="chip warn">Hazardous</span></>}<div className="muted small">{methodName(b.route, b.gri)}</div></td><td className="mono">{b.code}</td></tr>)}</tbody></table></section>}
  </>;
}

async function upload(file: File | null) {
  if (!file) return undefined;
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is over 10 MB');
  return (await call<{ documentId: string }>('POST', '/evidence', undefined, file)).documentId;
}

function Collections({ me, reload, toast }: { me: Me; reload: () => Promise<void>; toast: (m: string) => void }) {
  const pre = new URLSearchParams(window.location.search).get('bin')?.toUpperCase() ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const blank = { bin: me.bins.find((b) => b.code === pre)?.id ?? me.bins[0]?.id ?? '', date: today, manifest: '', kg: '', vehicle: '', note: '' };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const bin = me.bins.find((b) => b.id === f.bin);
  const ok = !!bin && Number(f.kg) > 0 && (!bin.hazardous || f.manifest.trim());
  const save = async () => {
    setBusy(true);
    try {
      const documentId = await upload(file);
      await call('POST', '/collections', { binId: f.bin, date: f.date, kg: Number(f.kg), manifest: f.manifest.trim() || undefined, vehicle: f.vehicle.trim() || undefined, note: f.note.trim() || undefined, documentId });
      toast('Collection recorded'); setF({ ...blank, bin: f.bin, date: f.date }); setFile(null); await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <section className="card cform">
      <h2>Record a collection</h2>
      <div className="formgrid">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Bin</span><select className="input" value={f.bin} onChange={(e) => setF({ ...f, bin: e.target.value })}>
          {[...new Set(me.bins.map((b) => b.facility))].map((fa) => <optgroup key={fa} label={fa}>{me.bins.filter((b) => b.facility === fa).map((b) => <option key={b.id} value={b.id}>{b.name} · {b.material ?? b.item}{b.hazardous ? ' · hazardous' : ''}</option>)}</optgroup>)}</select></label>
        <label className="field"><span>Collection date</span><input className="input" type="date" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="field"><span>Weighbridge weight (kg)</span><input className="input num" inputMode="decimal" value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        <label className="field"><span>Manifest / transfer note no.{bin?.hazardous ? ' · required' : ''}</span><input className={`input${bin?.hazardous && !f.manifest.trim() ? ' need' : ''}`} maxLength={120} value={f.manifest} onChange={(e) => setF({ ...f, manifest: e.target.value })} /></label>
        <label className="field"><span>Vehicle</span><input className="input" maxLength={40} placeholder="optional" value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Ticket or manifest (PDF or photo)</span><input className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Note</span><input className="input" maxLength={500} placeholder="optional" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      </div>
      <div className="row"><span className="muted small">The weighbridge weight replaces the site's own estimates for that bin in the month.</span><span className="grow" /><button className="btn p" disabled={!ok || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Record collection'}</button></div>
    </section>
    <section className="card"><h2>Collections · last 120 days</h2>
      {!me.collections.length ? <div className="muted">None yet.</div> : <table className="t"><thead><tr><th>Date</th><th>Site · bin</th><th className="num">kg</th><th>Manifest</th><th>Vehicle</th><th className="ctr">Status</th><th /></tr></thead>
        <tbody>{me.collections.map((c) => <tr key={c.id}><td className="small">{new Date(c.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{c.facility}<div className="muted small">{c.bin}</div></td>
          <td className="num"><b>{fmt(c.kg)}</b></td><td className="small mono">{c.manifest ?? ''}</td><td className="small">{c.vehicle ?? ''}</td>
          <td><span className={`chip ${c.status === 'rolled' ? '' : 'info'}`}>{c.status === 'rolled' ? 'In the site’s figures' : c.byYou ? 'Received' : 'Recorded by the site'}</span></td>
          <td>{c.byYou && c.status === 'open' && <button className="btn xs ghost" onClick={async () => { try { await call('POST', `/collections/${c.id}/void`); await reload(); } catch (e) { toast((e as Error).message); } }}>Withdraw</button>}</td></tr>)}</tbody></table>}
    </section>
  </>;
}

function Statement({ me, reload, toast }: { me: Me; reload: () => Promise<void>; toast: (m: string) => void }) {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [ym, setYm] = useState({ y: prev.getUTCFullYear(), m: prev.getUTCMonth() + 1 });
  // one line per site, material and method of the contractor's bins
  const lines = useMemo(() => {
    const m = new Map<string, { facilityId: string; facility: string; itemId: number; gri: string | null; label: string }>();
    for (const b of me.bins) { const k = `${b.facilityId}|${b.itemId}|${b.gri ?? ''}`; if (!m.has(k)) m.set(k, { facilityId: b.facilityId, facility: b.facility, itemId: b.itemId, gri: b.gri, label: `${b.material ?? b.item} · ${methodName(b.route, b.gri)}` }); }
    return [...m.entries()];
  }, [me.bins]);
  const existing = me.statements.find((s) => s.year === ym.y && s.month === ym.m);
  // suggested tonnes: the collections recorded in the month
  const suggest = (fid: string, itemId: number, gri: string | null) => {
    const names = new Set(me.bins.filter((b) => b.facilityId === fid && b.itemId === itemId && (b.gri ?? '') === (gri ?? '')).map((b) => `${b.facility}|${b.name}`));
    return me.collections.filter((c) => names.has(`${c.facility}|${c.bin}`) && new Date(c.at).getUTCFullYear() === ym.y && new Date(c.at).getUTCMonth() + 1 === ym.m).reduce((a, c) => a + c.kg, 0) / 1000;
  };
  const [t, setT] = useState<Record<string, string>>({});
  const [note, setNote] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const o: Record<string, string> = {};
    for (const [k, l] of lines) { const e = existing?.lines.find((x) => `${x.facilityId}|${x.itemId}|${x.gri ?? ''}` === k); o[k] = e ? String(e.tonnes) : (() => { const s = suggest(l.facilityId, l.itemId, l.gri); return s ? String(Math.round(s * 1000) / 1000) : ''; })(); }
    setT(o); setNote(existing?.note ?? '');
  }, [ym.y, ym.m, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try {
      const documentId = await upload(file);
      await call('PUT', '/statements', { year: ym.y, month: ym.m, note: note.trim() || undefined, documentId,
        lines: lines.filter(([k]) => t[k] !== '' && t[k] !== undefined).map(([k, l]) => ({ facilityId: l.facilityId, itemId: l.itemId, gri: l.gri, tonnes: Number(t[k]) })) });
      toast('Statement sent'); setFile(null); await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  return <>
    <section className="card cform">
      <div className="row"><h2>Monthly statement</h2><span className="grow" />
        <select className="input sm" style={{ width: 'auto' }} aria-label="Month" value={`${ym.y}-${ym.m}`} onChange={(e) => { const [y, m] = e.target.value.split('-').map(Number); setYm({ y: y!, m: m! }); }}>
          {months.map((d) => <option key={d.toISOString()} value={`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`}>{MN[d.getUTCMonth()]} {d.getUTCFullYear()}</option>)}</select></div>
      {existing && <div className={`note ${existing.status === 'accepted' ? 'ok' : existing.status === 'queried' ? 'bad' : 'info'}`}>
        {existing.status === 'accepted' ? 'Accepted by ' + me.company + '.' : existing.status === 'queried' ? <>Queried: {existing.reviewNote} — correct the figures and send again.</> : `Sent ${new Date(existing.submittedAt).toLocaleDateString('en-GB')}; waiting for review. You can still correct it.`}</div>}
      <p className="muted small">Tonnes you collected or treated in the month, per site, material and method. Filled in from the collections recorded; change them to match your records.</p>
      <table className="t"><thead><tr><th>Site</th><th>Material · method</th><th className="num">Tonnes</th></tr></thead>
        <tbody>{lines.map(([k, l]) => <tr key={k}><td>{l.facility}</td><td>{l.label}</td><td className="num"><input className="input num" style={{ width: 120 }} inputMode="decimal" disabled={existing?.status === 'accepted'}
          value={t[k] ?? ''} onChange={(e) => setT({ ...t, [k]: e.target.value.replace(/[^0-9.]/g, '') })} /></td></tr>)}</tbody></table>
      <div className="formgrid">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Statement or treatment certificate (PDF or photo)</span><input className="input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Note</span><input className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="row"><span className="grow" /><button className="btn p" disabled={busy || existing?.status === 'accepted' || !lines.some(([k]) => t[k])} onClick={() => void send()}>{busy ? 'Sending…' : existing ? 'Send again' : 'Send statement'}</button></div>
    </section>
  </>;
}
