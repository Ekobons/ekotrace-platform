/**
 * Document vault (Capture): every file of the company — uploaded here, attached to an entry, or kept by
 * Bills, Purchases, the waste contractor portal or Audit & assurance — filed by facility, type and period,
 * linked to the entries it supports, with expiry dates, versions, archive and the retention period.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, type Activity, type OrgNode, type VaultDoc, type VaultLink, type VaultList, type VaultMeta } from '../lib/api';
import { Icon } from '../components/Icon';
import { FilePreview, FileTag, sizeOf } from '../components/FilePreview';

type View = 'active' | 'expiring' | 'unlinked' | 'archived';
const VIEWS: [View, string][] = [['active', 'All files'], ['expiring', 'Expiring & expired'], ['unlinked', 'Not linked to entries'], ['archived', 'Archived']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d8 = (x: string | null) => (x ? new Date(x.length === 10 ? `${x}T00:00:00` : x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ym = (x: string) => `${MON[Number(x.slice(5, 7)) - 1]} ${x.slice(0, 4)}`;
function period(d: { periodFrom: string | null; periodTo: string | null }) {
  if (!d.periodFrom && !d.periodTo) return '—';
  const a = d.periodFrom ?? d.periodTo!, b = d.periodTo ?? d.periodFrom!;
  return a.slice(0, 7) === b.slice(0, 7) ? ym(a) : `${ym(a)} – ${ym(b)}`;
}
const lastDay = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(y!, mo!, 0).getDate()).padStart(2, '0')}`; };
const EXPIRY_CHIP = { expired: ['bad', 'Expired'], soon: ['warn', 'Expires soon'], valid: ['grey', 'Valid'] } as const;

export function Vault() {
  const { toast, role } = useApp();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<View>('active');
  const [f, setF] = useState({ facilityId: '', type: '', year: '', month: '', q: '' });
  const [d, setD] = useState<VaultList | null>(null);
  const [facs, setFacs] = useState<OrgNode[]>([]);
  const [cats, setCats] = useState<{ code: string; name: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(sp.get('doc'));
  const [upload, setUpload] = useState(false);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { api.org().then((o) => setFacs(o.nodes.filter((n) => n.kind === 'facility'))).catch(() => {}); api.catalogue().then((c) => setCats(c.categories.flatMap((x) => x.subcategories.map((s) => ({ code: s.code, name: `${x.name} · ${s.name}` }))))).catch(() => {}); }, []);
  // the search box waits for a pause in typing
  const [q, setQ] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => window.clearTimeout(t); }, [q]);
  useEffect(() => { api.vault({ view, ...f }).then(setD).catch((e) => toast((e as Error).message)); }, [view, f, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = d?.docs.find((x) => x.id === openId) ?? null;
  const show = (id: string | null) => { setOpenId(id); const n = new URLSearchParams(sp); if (id) n.set('doc', id); else n.delete('doc'); setSp(n, { replace: true }); };
  const years = useMemo(() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2, y - 3, y - 4]; }, []);
  const k = d?.kpis;
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>Document vault</h1>
          <div className="muted">Every bill, invoice, permit and certificate in one place, filed by facility and period and linked to the entries it supports. Files attached to an entry, and those kept by Bills, Purchases, the contractor portal and Audit & assurance, appear here by themselves.</div></div>
        <span className="grow" />
        {d?.canUpload && <button className="btn p" onClick={() => setUpload(true)}>+ Upload files</button>}
      </div>
      {k && (
        <div className="kgrid4">
          <button type="button" className={`card kpi vk${view === 'active' ? ' on' : ''}`} onClick={() => setView('active')}><span className="muted small">Files</span><b>{num(k.files)}</b><span className="muted small">{sizeOf(k.size)} in all</span></button>
          <button type="button" className={`card kpi vk${view === 'expiring' ? ' on' : ''}`} onClick={() => setView('expiring')}><span className="muted small">Expiring in 60 days · expired</span>
            <b style={{ color: k.expired ? 'var(--bad)' : k.expiring ? 'var(--warn)' : undefined }}>{k.expiring} · {k.expired}</b><span className="muted small">permits, certificates, calibration</span></button>
          <button type="button" className={`card kpi vk${view === 'unlinked' ? ' on' : ''}`} onClick={() => setView('unlinked')}><span className="muted small">Uploaded, not linked to an entry</span><b>{k.unlinked}</b><span className="muted small">invoices, bills, logs waiting for their entry</span></button>
          <Retention years={k.retentionYears} archived={k.archived} canSet={role === 'super_admin'} onSaved={reload} />
        </div>)}
      <div className="seg strong" role="tablist">{VIEWS.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}</div>
      <div className="card flush">
        <div className="row vfilters">
          <select className="input" aria-label="Facility" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">All facilities</option>{facs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className="input" aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{d && Object.entries(d.types).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input" aria-label="Year" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value, month: e.target.value ? f.month : '' })}><option value="">Any year</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
          <select className="input" aria-label="Month" value={f.month} disabled={!f.year} onChange={(e) => setF({ ...f, month: e.target.value })}><option value="">Any month</option>{MON.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <label className="vsearch grow"><span aria-hidden="true">⌕</span><input placeholder="Search name, title, tag, note…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
          <span className="muted small">{d ? `${d.total} file${d.total === 1 ? '' : 's'}` : ''}</span>
        </div>
        {!d ? <div className="empty">Loading…</div> : !d.docs.length ? (
          <div className="empty">{view === 'archived' ? 'Nothing archived.' : view === 'expiring' ? 'Nothing expires in the next 60 days.' : view === 'unlinked' ? 'Every uploaded bill and invoice is linked to an entry.' : 'No files match. Upload files here, or attach them to an entry in Entries & results or Approvals.'}</div>
        ) : (
          <div className="scroll">
            <table className="t vtable">
              <thead><tr><th>File</th><th>Type</th><th>Facility</th><th>Period</th><th>Supports</th><th>Valid until</th><th>From</th><th>Added</th></tr></thead>
              <tbody>{d.docs.map((x) => (
                <tr key={x.id} className={`click${x.archived ? ' dim' : ''}${openId === x.id ? ' sel' : ''}`} onClick={() => show(x.id)}>
                  <td><div className="vfile"><FileTag name={x.filename} /><span><b>{x.title || x.filename}</b>
                    <span className="muted small">{x.title ? `${x.filename} · ` : ''}{sizeOf(x.size)}{x.version > 1 ? ` · v${x.version}` : ''}{x.tags.length ? ' · ' : ''}{x.tags.map((t) => <span key={t} className="vtag">{t}</span>)}</span></span></div></td>
                  <td>{x.typeName}{x.categoryName && <div className="muted small">{x.categoryName}</div>}</td>
                  <td>{x.facility ?? <span className="muted">Company-wide</span>}</td>
                  <td className="nowrap">{period(x)}</td>
                  <td>{x.links ? <span className="chip">{x.links} entr{x.links === 1 ? 'y' : 'ies'}</span> : x.kind === 'bill' ? <span className="chip grey">via meter</span> : x.kind === 'purchases' ? <span className="chip grey">its entries</span> : x.kind === 'waste_evidence' ? <span className="chip grey">via scans</span> : <span className="muted small">—</span>}</td>
                  <td className="nowrap">{x.validUntil ? <><span className={`chip ${EXPIRY_CHIP[x.expiry!][0]}`}>{EXPIRY_CHIP[x.expiry!][1]}</span> <span className="small">{d8(x.validUntil)}</span></> : <span className="muted small">—</span>}</td>
                  <td className="small">{x.source}{x.archived && <div><span className="chip grey">Archived</span></div>}</td>
                  <td className="small nowrap">{d8(x.uploadedAt)}<div className="muted">{x.uploadedBy ?? ''}</div></td>
                </tr>))}</tbody>
            </table>
          </div>)}
      </div>
      {open && <DocDrawer doc={open} types={d!.types} facs={facs} cats={cats} wide={d!.canUploadCompanyWide} isSuper={role === 'super_admin'} onClose={() => show(null)} onChanged={reload} onOpen={show} />}
      {upload && d && <UploadDrawer types={d.types} facs={facs} cats={cats} wide={d.canUploadCompanyWide} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />}
    </div>);
}

function Retention({ years, archived, canSet, onSaved }: { years: number; archived: number; canSet: boolean; onSaved: () => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(false);
  const [y, setY] = useState(String(years));
  useEffect(() => setY(String(years)), [years]);
  return (
    <div className="card kpi"><span className="muted small">Kept for</span>
      {edit ? <div className="row" style={{ gap: 6 }}><input className="input sm" type="number" min={1} max={30} value={y} onChange={(e) => setY(e.target.value)} style={{ width: 70 }} aria-label="Years" /><span className="small">years</span>
        <button className="btn sm primary" onClick={async () => { try { await api.vaultSettings(Number(y)); toast('Retention period saved'); setEdit(false); onSaved(); } catch (e) { toast((e as Error).message); } }}>Save</button></div>
        : <b>{years} years</b>}
      <span className="muted small">after the period a file covers · {archived} archived{canSet && !edit ? <> · <button type="button" className="linkbtn small" onClick={() => setEdit(true)}><u>change</u></button></> : null}</span>
    </div>);
}

/** The details form, shared by upload and edit. */
function Details({ m, set, types, facs, cats, wide, multi }: { m: VaultMeta & { from?: string; to?: string; tagText?: string }; set: (x: Partial<VaultMeta & { from?: string; to?: string; tagText?: string }>) => void;
  types: Record<string, string>; facs: OrgNode[]; cats: { code: string; name: string }[]; wide: boolean; multi?: boolean }) {
  const dated = ['permit', 'certificate', 'contract', 'calibration', 'policy'].includes(m.type ?? '');
  return (
    <div className="vform">
      <label className="field"><span>Type</span><select className="input" value={m.type} onChange={(e) => set({ type: e.target.value })}>{Object.entries(types).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="field"><span>Facility</span><select className="input" value={m.facilityId ?? ''} onChange={(e) => set({ facilityId: e.target.value || null })}>
        {wide ? <option value="">Company-wide</option> : <option value="" disabled>Choose…</option>}{facs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {!multi && <label className="field span2"><span>Title (optional)</span><input className="input" value={m.title ?? ''} placeholder="e.g. Environmental permit — Plant 2" onChange={(e) => set({ title: e.target.value })} /></label>}
      <label className="field"><span>Period from</span><input className="input" type="month" value={m.from ?? ''} onChange={(e) => set({ from: e.target.value, to: m.to && m.to < e.target.value ? e.target.value : m.to ?? e.target.value })} /></label>
      <label className="field"><span>Period to</span><input className="input" type="month" value={m.to ?? ''} min={m.from} onChange={(e) => set({ to: e.target.value })} /></label>
      <label className="field"><span>Valid until{dated ? '' : ' (if it expires)'}</span><input className="input" type="date" value={m.validUntil ?? ''} onChange={(e) => set({ validUntil: e.target.value || null })} /></label>
      <label className="field"><span>Data category (optional)</span><select className="input" value={m.category ?? ''} onChange={(e) => set({ category: e.target.value || null })}><option value="">—</option>{cats.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label className="field span2"><span>Tags (comma between)</span><input className="input" value={m.tagText ?? ''} placeholder="e.g. diesel, generator" onChange={(e) => set({ tagText: e.target.value })} /></label>
      <label className="field span2"><span>Note</span><textarea className="input" rows={2} value={m.note ?? ''} onChange={(e) => set({ note: e.target.value })} /></label>
    </div>);
}
const toMeta = (m: VaultMeta & { from?: string; to?: string; tagText?: string }): VaultMeta => ({
  type: m.type, title: m.title || null, facilityId: m.facilityId || null, validUntil: m.validUntil || null, category: m.category || null, note: m.note || null,
  periodFrom: m.from ? `${m.from}-01` : null, periodTo: m.to ? lastDay(m.to) : m.from ? lastDay(m.from) : null,
  tags: (m.tagText ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12),
});

function UploadDrawer({ types, facs, cats, wide, onClose, onDone }: { types: Record<string, string>; facs: OrgNode[]; cats: { code: string; name: string }[]; wide: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [files, setFiles] = useState<File[]>([]);
  const [m, setM] = useState<VaultMeta & { from?: string; to?: string; tagText?: string }>({ type: 'invoice', facilityId: wide ? null : facs[0]?.id ?? null });
  const [res, setRes] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const add = (l: FileList | null) => { if (l) setFiles((f) => [...f, ...Array.from(l)].slice(0, 30)); };
  const go = async () => {
    setBusy(true); const out: typeof res = [];
    for (const file of files) {
      try { const r = await api.vaultUpload(file, toMeta(files.length > 1 ? { ...m, title: null } : m)); out.push({ name: file.name, ok: true, msg: r.message ?? 'Filed' }); }
      catch (e) { out.push({ name: file.name, ok: false, msg: (e as Error).message }); }
      setRes([...out]);
    }
    setBusy(false);
    if (out.every((r) => r.ok)) { toast(`${out.length} file${out.length === 1 ? '' : 's'} filed in the vault`); onDone(); }
  };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Document vault</div><h2>Upload files</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <label className={`vdrop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
          <Icon name="upload" /><b>Drop files here, or choose them</b><span className="muted small">PDF, images, Excel, Word, CSV, email · up to 25 MB each · up to 30 at a time</span>
          <input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.pptx,.txt,.eml,.msg" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </label>
        {files.length > 0 && <div className="vlist">{files.map((x, i) => { const r = res.find((y) => y.name === x.name); return (
          <div key={i} className="evrow"><FileTag name={x.name} /><span className="grow"><b>{x.name}</b><span className="muted small">{sizeOf(x.size)}{r ? ` · ${r.msg}` : ''}</span></span>
            {r ? <span className={`chip ${r.ok ? '' : 'bad'}`}>{r.ok ? 'Filed' : 'Not filed'}</span> : !busy && <button className="btn ghost sm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>}</div>); })}</div>}
        <div className="sub">The details apply to every file in this upload. Link them to entries afterwards, or attach files straight from an entry.</div>
        <Details m={m} set={(x) => setM({ ...m, ...x })} types={types} facs={facs} cats={cats} wide={wide} multi={files.length > 1} />
        <div className="row"><button className="btn p" disabled={!files.length || busy || (!wide && !m.facilityId)} onClick={go}>{busy ? 'Uploading…' : !files.length ? 'Choose files first' : `File ${files.length} ${files.length === 1 ? 'file' : 'files'} in the vault`}</button>
          {res.some((r) => !r.ok) && !busy && <button className="btn" onClick={onDone}>Done</button>}</div>
      </div>
    </dialog>);
}

function DocDrawer({ doc, types, facs, cats, wide, isSuper, onClose, onChanged, onOpen }: { doc: VaultDoc; types: Record<string, string>; facs: OrgNode[]; cats: { code: string; name: string }[]; wide: boolean; isSuper: boolean;
  onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dlg.current?.open) dlg.current?.showModal(); }, []);
  const [det, setDet] = useState<Awaited<ReturnType<typeof api.vaultDoc>> | null>(null);
  const [edit, setEdit] = useState(false);
  const [m, setM] = useState<VaultMeta & { from?: string; to?: string; tagText?: string }>({});
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { setDet(null); api.vaultDoc(doc.id).then(setDet).catch((e) => toast((e as Error).message)); }, [doc.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEdit(false); setPicking(false); setReason(''); setM({ type: doc.type, title: doc.title, facilityId: doc.facilityId, validUntil: doc.validUntil, category: doc.category, note: doc.note,
    from: doc.periodFrom?.slice(0, 7), to: doc.periodTo?.slice(0, 7), tagText: doc.tags.join(', ') }); }, [doc]);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); setTick((t) => t + 1); onChanged(); } catch (e) { toast((e as Error).message); } };
  const editable = doc.canEdit && !doc.archived;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><FileTag name={doc.filename} /><div className="grow"><div className="eyebrow">{doc.typeName}{doc.version > 1 ? ` · version ${doc.version}` : ''} · {doc.source}</div><h2>{doc.title || doc.filename}</h2></div>
          <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {doc.archived && <div className="note warn">Archived: {doc.archiveReason}</div>}
        {doc.replaced && <div className="note info">A newer version of this file exists (see Versions below).</div>}
        {doc.expiry && doc.expiry !== 'valid' && <div className={`note ${doc.expiry === 'expired' ? 'bad' : 'warn'}`}>{doc.expiry === 'expired' ? 'Expired' : 'Expires'} on {d8(doc.validUntil)}. Upload the renewed document as a new version.</div>}
        <div className="vsplit">
          <FilePreview path={`/api/vault/${doc.id}/file`} filename={doc.filename} contentType={doc.contentType} />
          <div className="vside">
            {edit ? <>
              <Details m={m} set={(x) => setM({ ...m, ...x })} types={types} facs={facs} cats={cats} wide={wide} />
              <div className="row"><button className="btn p sm" onClick={() => run(() => api.vaultEdit(doc.id, toMeta(m)), 'Details saved').then(() => setEdit(false))}>Save</button><button className="btn ghost sm" onClick={() => setEdit(false)}>Cancel</button></div>
            </> : <>
              <dl className="vdl">
                <dt>Facility</dt><dd>{doc.facility ?? 'Company-wide'}</dd>
                <dt>Period</dt><dd>{period(doc)}</dd>
                {doc.validUntil && <><dt>Valid until</dt><dd>{d8(doc.validUntil)}</dd></>}
                {doc.categoryName && <><dt>Data category</dt><dd>{doc.categoryName}</dd></>}
                {doc.tags.length > 0 && <><dt>Tags</dt><dd>{doc.tags.map((t) => <span key={t} className="vtag">{t}</span>)}</dd></>}
                {doc.note && <><dt>Note</dt><dd>{doc.note}</dd></>}
                <dt>Added</dt><dd>{d8(doc.uploadedAt)} · {doc.uploadedBy ?? '—'}</dd>
                <dt>File</dt><dd>{doc.filename} · {sizeOf(doc.size)}</dd>
                <dt>Kept until</dt><dd>{d8(doc.retainUntil)}</dd>
              </dl>
              {editable && <button className="btn sm" onClick={() => setEdit(true)}>Edit details</button>}
              {!doc.canEdit && doc.kind !== 'vault' && <div className="muted small">Kept by {doc.source}: change it there.</div>}
            </>}
          </div>
        </div>

        <section className="vsec">
          <div className="row"><h3 className="grow">Supports {det ? `${det.links.length} entr${det.links.length === 1 ? 'y' : 'ies'}` : '…'}</h3>
            {editable && !doc.replaced && <button className="btn sm" onClick={() => setPicking(!picking)}>{picking ? 'Close' : '+ Link entries'}</button>}</div>
          {doc.kind === 'bill' && <div className="muted small">A bill supports the entries made from its meter's readings (shown in each entry's Evidence).</div>}
          {det?.links.map((l) => <LinkRow key={l.id} l={l} onUnlink={() => run(() => api.vaultUnlink(doc.id, l.id), 'Link removed')} />)}
          {det && !det.links.length && doc.kind !== 'bill' && <div className="muted small">Not linked to any entry yet.</div>}
          {picking && <EntryPicker doc={doc} facs={facs} already={new Set(det?.links.map((l) => l.id))} onLink={(ids) => run(() => api.vaultLink(doc.id, ids), `${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} linked`).then(() => setPicking(false))} />}
        </section>

        {doc.kind === 'vault' && <section className="vsec">
          <div className="row"><h3 className="grow">Versions</h3>
            {editable && !doc.replaced && <label className="btn sm">Upload a new version<input type="file" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) run(async () => { const r = await api.vaultVersion(doc.id, x); onOpen(r.id); }, 'New version filed: the links moved with it'); }} /></label>}</div>
          {det?.versions.map((v) => <div key={v.id} className={`evrow${v.id === doc.id ? ' on' : ''}`}><span className="vnum">v{v.version}</span><span className="grow"><b>{v.filename}</b><span className="muted small">{d8(v.uploaded_at)} · {v.uploaded_by ?? '—'} · {sizeOf(v.size)}</span></span>
            {v.id !== doc.id && <button className="btn ghost sm" onClick={() => onOpen(v.id)}>Open</button>}</div>)}
        </section>}

        {doc.kind === 'vault' && doc.canEdit && det?.links.some((l) => l.status === 'approved') && !doc.archived && <section className="vsec"><h3>Archive</h3><div className="muted small">This file supports approved entries, so it stays as their evidence. If it was the wrong file, upload a new version.</div></section>}
        {doc.kind === 'vault' && doc.canEdit && !(det?.links.some((l) => l.status === 'approved') && !doc.archived) && <section className="vsec">
          <h3>{doc.archived ? 'Archived' : 'Archive'}</h3>
          {doc.archived ? <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => run(() => api.vaultRestore(doc.id), 'File restored')}>Restore</button>
            {isSuper && <button className="btn sm danger" disabled={doc.retainUntil > today || doc.links > 0} title={doc.retainUntil > today ? `Kept until ${d8(doc.retainUntil)}` : undefined}
              onClick={() => { if (window.confirm(`Delete ${doc.filename} for good? This cannot be undone.`)) run(async () => { await api.vaultDelete(doc.id); dlg.current?.close(); }, 'File deleted'); }}>Delete for good</button>}
            {isSuper && doc.retainUntil > today && <span className="muted small">Can be deleted for good from {d8(doc.retainUntil)} (retention period).</span>}
          </div> : <div className="row" style={{ gap: 8 }}>
            <input className="input sm grow" placeholder="Why (e.g. uploaded twice, wrong facility)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
            <button className="btn sm" disabled={reason.trim().length < 3} onClick={() => run(() => api.vaultArchive(doc.id, reason.trim()), 'File archived')}>Archive</button>
          </div>}
          <div className="muted small">Archived files are hidden but kept. A file supporting an approved entry stays as evidence: upload a new version if it was wrong.</div>
        </section>}
      </div>
    </dialog>);
}

function LinkRow({ l, onUnlink }: { l: VaultLink; onUnlink: () => void }) {
  const st: Record<string, string> = { approved: '', submitted: 'warn', draft: 'grey', rejected: 'bad' };
  return (
    <div className="evrow"><span className="grow"><b>{l.item}</b><span className="muted small">{l.facility} · {l.period_start.slice(0, 7) === l.period_end.slice(0, 7) ? ym(l.period_start) : `${ym(l.period_start)} – ${ym(l.period_end)}`} · {num(Number(l.quantity))} {l.unit}{l.linked_by ? ` · linked by ${l.linked_by}` : ''}</span></span>
      <span className={`chip ${st[l.status] ?? 'grey'}`}>{l.status === 'rejected' ? 'returned' : l.status}</span>{l.locked && <span className="chip grey" title="Locked for assurance">🔒</span>}
      {l.canUnlink && <button className="btn ghost sm" onClick={onUnlink}>Unlink</button>}</div>);
}

/** Entries of the file's facility around its period, to tick and link. */
function EntryPicker({ doc, facs, already, onLink }: { doc: VaultDoc; facs: OrgNode[]; already: Set<string>; onLink: (ids: string[]) => void }) {
  const [fac, setFac] = useState(doc.facilityId ?? facs[0]?.id ?? '');
  const [year, setYear] = useState(Number((doc.periodFrom ?? doc.uploadedAt).slice(0, 4)));
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { if (!fac) return; setRows(null); api.activities({ facilityId: fac, year, limit: 1000 }).then((r) => setRows(r.activities)).catch(() => setRows([])); }, [fac, year]);
  const inPeriod = (a: Activity) => !doc.periodFrom || !doc.periodTo || (a.period_start <= doc.periodTo && a.period_end >= doc.periodFrom);
  const list = (rows ?? []).filter((a) => !already.has(a.id)).sort((a, b) => Number(inPeriod(b)) - Number(inPeriod(a)) || a.period_start.localeCompare(b.period_start));
  return (
    <div className="vpick">
      <div className="row" style={{ gap: 8 }}>
        {!doc.facilityId && <select className="input sm" aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)} style={{ width: 'auto' }}>{facs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <select className="input sm" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>{[0, 1, 2, 3, 4].map((x) => new Date().getFullYear() - x).map((y) => <option key={y}>{y}</option>)}</select>
        <span className="muted small grow">{doc.periodFrom ? 'Entries in the file\'s period first.' : ''}</span>
        <button className="btn p sm" disabled={!sel.size} onClick={() => onLink([...sel])}>Link {sel.size || ''}</button>
      </div>
      {!rows ? <div className="muted small">Loading…</div> : !list.length ? <div className="muted small">No other entries for this facility in {year}.</div> : (
        <div className="vpicklist">{list.map((a) => (
          <label key={a.id} className={`vpickrow${inPeriod(a) ? '' : ' out'}`}><input type="checkbox" checked={sel.has(a.id)} onChange={() => { const n = new Set(sel); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); setSel(n); }} />
            <span className="nowrap">{ym(a.period_start)}</span><span className="grow">{a.category} · {a.item}</span><span className="num">{num(Number(a.quantity))} {a.unit}</span><span className="chip grey">{a.status}</span></label>))}</div>)}
    </div>);
}
