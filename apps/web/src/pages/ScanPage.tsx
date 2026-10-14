/**
 * Scan page — what the phone opens from a bin's QR label (/scan/<code>), after signing in.
 * Weigh (kg) · Fill level (% → estimated kg) · Collection (manifest, weighbridge kg). Location is sent only
 * when the person ticks it. Without a connection the scan waits on the phone and is sent when back online.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, ApiError, num, type Bin, type Scan } from '../lib/api';
import { methodName } from '../lib/waste';
import { BrandMark } from '../components/BrandMark';
import { BRAND } from '../lib/brand';

type Kind = Scan['kind'];
type Queued = { binId: string; body: Parameters<typeof api.addScan>[1] & { at: string } };
const QKEY = 'eko_scanq';
const readQ = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QKEY) ?? '[]') as Queued[]; } catch { return []; } };
const writeQ = (q: Queued[]) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* not kept */ } };

export function ScanPage() {
  const { code = '' } = useParams();
  const { me } = useApp();
  const [d, setD] = useState<{ bin: Bin; recent: Scan[]; canScan: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('weigh');
  const [kg, setKg] = useState(''); const [fill, setFill] = useState(50); const [manifest, setManifest] = useState(''); const [note, setNote] = useState('');
  const [geo, setGeo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Scan | 'queued' | null>(null);
  const [queued, setQueued] = useState(readQ().length);
  const load = useCallback(() => api.binByCode(code).then(setD).catch((e) => setErr((e as Error).message)), [code]);
  useEffect(() => { void load(); }, [load]);

  // send what waited offline
  const flush = useCallback(async () => {
    const q = readQ(); if (!q.length) return;
    const left: Queued[] = [];
    for (const x of q) { try { await api.addScan(x.binId, x.body); } catch (e) { if (!(e instanceof ApiError)) left.push(x); } }
    writeQ(left); setQueued(left.length); void load();
  }, [load]);
  useEffect(() => { void flush(); window.addEventListener('online', flush); return () => window.removeEventListener('online', flush); }, [flush]);

  const b = d?.bin;
  const est = b?.capacityL && b.density ? Math.round(b.capacityL * (fill / 100) * b.density) : null;
  const needManifest = kind === 'collection' && !!b?.hazardous && !manifest.trim();
  const ready = kind === 'weigh' ? Number(kg) > 0 : kind === 'fill' ? est != null : !needManifest;
  const submit = async () => {
    if (!b) return;
    setBusy(true);
    const body: Queued['body'] = { kind, at: new Date().toISOString(), ...(kind === 'weigh' || (kind === 'collection' && kg) ? { kg: Number(kg) } : {}), ...(kind === 'fill' ? { fillPct: fill } : {}),
      ...(manifest.trim() ? { manifest: manifest.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
    if (geo && navigator.geolocation) {
      await new Promise<void>((ok) => navigator.geolocation.getCurrentPosition((p) => { body.lat = p.coords.latitude; body.lon = p.coords.longitude; ok(); }, () => ok(), { timeout: 5000 }));
    }
    try { setDone(await api.addScan(b.id, body)); void load(); }
    catch (e) {
      if (e instanceof ApiError) setErr(e.message);
      else { const q = [...readQ(), { binId: b.id, body }]; writeQ(q); setQueued(q.length); setDone('queued'); }   // no connection: keep it on the phone
    } finally { setBusy(false); }
  };
  const again = () => { setDone(null); setKg(''); setManifest(''); setNote(''); setErr(null); };

  return (
    <div className="scanpage">
      <header><BrandMark /><b>{BRAND.name}</b><span className="grow" /><span className="muted small">{me.user.name}</span></header>
      {queued > 0 && <div className="note warn">{queued} scan{queued === 1 ? '' : 's'} waiting for a connection — sent automatically when online.</div>}
      {err && !d ? <div className="card"><h2>Cannot open this label</h2><p className="muted">{err}</p><Link className="btn" to="/qr">QR & field app</Link></div>
        : !d || !b ? <div className="card empty">Loading…</div> : <>
          <section className="card scanbin">
            <div className="muted small">{b.facility}{b.location ? ` · ${b.location}` : ''}</div>
            <h1>{b.name}</h1>
            <div>{b.material ?? b.item} · <span className="muted">{methodName(b.route, b.gri)}</span></div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>{b.hazardous && <span className="chip warn">Hazardous</span>}{b.contractor && <span className="chip grey">{b.contractor}</span>}{b.capacityL && <span className="chip grey">{num(b.capacityL)} L</span>}</div>
          </section>
          {!d.canScan ? <div className="note info">You can see this bin but not record scans for its facility.</div>
            : done ? (
              <section className="card scanok">
                {done === 'queued' ? <><h2>Saved on this phone</h2><p className="muted">No connection: it is sent as soon as the phone is online.</p></>
                  : <><h2>✓ Recorded · {num(done.kg)} kg{done.estimated ? ' (estimated)' : ''}</h2>
                    {done.flags.map((f) => <div key={f} className="note warn">⚠ {f} — your manager will check it.</div>)}</>}
                <button className="btn p big" onClick={again}>Record another for this bin</button>
                <p className="muted small">Next bin: scan its label with the phone camera.</p>
              </section>
            ) : (
              <section className="card scanform">
                <div className="seg strong full" role="tablist" aria-label="What are you recording">
                  {([['weigh', '⚖ Weigh'], ['fill', '% Fill level'], ['collection', '🚚 Collection']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setErr(null); }}>{l}</button>)}
                </div>
                {kind === 'weigh' && <label className="field"><span>Weight (kg)</span><input className="input big num" inputMode="decimal" autoFocus placeholder="0" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ''))} /></label>}
                {kind === 'fill' && <>
                  <label className="field"><span>How full is the bin? <b>{fill}%</b></span><input type="range" min={0} max={100} step={5} value={fill} onChange={(e) => setFill(Number(e.target.value))} /></label>
                  <div className="row" style={{ gap: 6 }}>{[25, 50, 75, 100].map((p) => <button key={p} className={`btn sm${fill === p ? ' p' : ''}`} onClick={() => setFill(p)}>{p}%</button>)}</div>
                  <div className="muted small">{est != null ? <>≈ <b>{num(est)} kg</b> (capacity × % full × density · estimated)</> : 'This bin has no capacity or density set: weigh it instead.'}</div>
                </>}
                {kind === 'collection' && <>
                  <label className="field"><span>Manifest / transfer note number{b.hazardous ? ' · required (hazardous)' : ''}</span><input className={`input big${needManifest ? ' need' : ''}`} value={manifest} maxLength={120} onChange={(e) => setManifest(e.target.value)} /></label>
                  <label className="field"><span>Weighbridge weight (kg), if on the ticket</span><input className="input big num" inputMode="decimal" placeholder="optional" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                  <div className="muted small">The weighbridge weight replaces the month’s field scans for this bin.</div>
                </>}
                <label className="field"><span>Note</span><input className="input" maxLength={500} placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={geo} onChange={(e) => setGeo(e.target.checked)} />Add my location to this scan</label>
                {err && <div className="note bad">{err}</div>}
                <button className="btn p big" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save'}</button>
              </section>)}
          {d.recent.length > 0 && <section className="card"><h2>Last scans</h2>
            {d.recent.map((s) => <div key={s.id} className="row small" style={{ gap: 8, padding: '4px 0' }}><span className="muted">{new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span>{s.kind === 'collection' ? `Collection${s.manifest ? ` · ${s.manifest}` : ''}` : s.kind === 'fill' ? 'Fill level' : 'Weighed'}</span><span className="grow" /><b>{num(s.kg)} kg</b></div>)}</section>}
          <Link className="muted small" to="/qr">← QR & field app</Link>
        </>}
    </div>);
}
