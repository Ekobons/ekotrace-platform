/**
 * Capture → Smart import: drop any spreadsheet of emissions data (fuel, electricity, refrigerants, water, waste,
 * vehicles), in the company's own layout. The layout of each sheet is read (by the company's AI when allowed, else
 * from the headings) and can be corrected; activities and facilities are matched and can be corrected (and
 * remembered); every row is checked and calculated; the ready rows become entries, submitted for approval, with
 * the file as their evidence.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, tco2e, num, type ImportDetail, type ImportJob, type ImportRow, type SheetMapping } from '../lib/api';
import { Icon } from '../components/Icon';

const ST: Record<ImportRow['status'], [string, string]> = { ready: ['Ready', 'c-ok'], check: ['Check', 'c-warn'], problem: ['Problem', 'c-bad'], excluded: ['Left out', 'c-n'], created: ['Created', 'c-info'] };
const METHOD: Record<string, [string, string]> = { manual: ['by you', 'c-ok'], rule: ['remembered', 'c-ok'], text: ['text match', 'c-n'], ai: ['AI — confirm', 'c-warn'] };
const ROLE_LABEL: [keyof SheetMapping['cols'], string][] = [['facility', 'Facility'], ['description', 'Activity / fuel'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['date', 'Date'], ['month', 'Month'], ['year', 'Year'], ['category', 'Category'], ['note', 'Note / reference'], ['dataType', 'Actual / estimated']];
const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);
const d8 = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ml = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

export function SmartImport() {
  const { id } = useParams();
  return id ? <ImportDetailPage id={id} /> : <ImportList />;
}

function ImportList() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<{ jobs: ImportJob[]; ai: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api.imports().then(setD).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (f: File) => {
    setBusy(true);
    try { const r = await api.importUpload(f); nav(`/import/${r.id}`); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Capture</div><h1>Smart import</h1>
        <p className="sub">Drop any spreadsheet of emissions data — fuel, electricity, refrigerants, water, waste, vehicles — in your own layout: several sheets, months across or down, totals and notes included. It is read, matched to your facilities and the catalogue, and checked; you review every row, then the entries are created and sent for approval with the file as their evidence.</p></div></div>
      <div className={`card dropzone${busy ? ' busy' : ''}`} style={{ display: 'grid', gap: 8, justifyItems: 'center', padding: 28, borderStyle: 'dashed', cursor: 'pointer' }}
        onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}>
        <Icon name="upload" /><b>{busy ? 'Reading the file…' : 'Drop an Excel (.xlsx) or CSV file here, or click to choose'}</b>
        <span className="muted small">Up to 20 MB · the first 5,000 rows of each sheet · {d?.ai ? 'the layout is read by your AI (Setup → AI), then checked' : 'the layout is worked out from the headings (AI is off for imports)'}</span>
        <input ref={file} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </div>
      <div className="card">
        <h2>Imported files</h2>
        <div className="scrollx"><table className="t">
          <thead><tr><th>File</th><th>By</th><th className="num">Rows</th><th className="num">Ready</th><th className="num">To check</th><th className="num">Problems</th><th className="num">Created</th><th className="ctr">Status</th></tr></thead>
          <tbody>{(d?.jobs ?? []).map((j) => <tr key={j.id} className="click" onClick={() => nav(`/import/${j.id}`)}>
            <td><b>{j.filename}</b>{j.ai_used && <span className="chip c-info" style={{ marginLeft: 6 }}>AI</span>}</td><td className="small">{j.created_name} · {d8(j.created_at)}</td>
            <td className="num">{j.rows}</td><td className="num">{j.ready}</td><td className="num">{j.check}</td><td className="num">{j.problem}</td><td className="num">{j.created}</td>
            <td className="ctr"><span className={`chip ${j.status === 'done' ? 'c-ok' : 'c-warn'}`}>{j.status === 'done' ? 'Done' : 'In review'}</span></td></tr>)}
            {d && !d.jobs.length && <tr><td colSpan={8} className="muted">Nothing imported yet.</td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}

function ImportDetailPage({ id }: { id: string }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<ImportDetail | null>(null);
  const [filter, setFilter] = useState<ImportRow['status'] | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const load = (f = filter) => api.importJob(id, f).then(setD).catch((e) => toast((e as Error).message));
  useEffect(() => { void load(); }, [id, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, msg?: string) => { setBusy(true); try { const r = await fn(); if (msg) toast(msg); await load(); return r; } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const catalogue = useMemo(() => {
    const m = new Map<string, ImportDetail['catalogue']>();
    for (const i of d?.catalogue ?? []) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m];
  }, [d?.catalogue]);
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const c = (k: ImportRow['status']) => d.counts[k]?.n ?? 0;
  const done = d.job.status === 'done';
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl"><Link to="/import">Smart import</Link></span><h1>{d.job.filename}</h1>
          <div className="muted small">{d.job.created_name} · {d8(d.job.created_at)} · {d.sheets.length} sheet{d.sheets.length === 1 ? '' : 's'}{d.job.ai_used ? ' · layout read by AI' : ''} · the file is kept in the Document vault as evidence</div></div>
        {!done && <button className="btn ghost" onClick={() => void act(async () => { await api.importDelete(id); nav('/import'); })}>Drop this import</button>}
        <button className="btn p" disabled={busy || !c('ready')} onClick={() => void act(async () => { const r = await api.importCreate(id); toast(`${r.created} entries created, ${r.submitted} sent for approval${r.failed ? ` · ${r.failed} could not be created` : ''}`); })}>
          Create and submit {c('ready')} entr{c('ready') === 1 ? 'y' : 'ies'}</button>
      </div>
      {d.job.ai_note && <div className="note warn small">{d.job.ai_note}</div>}
      {d.job.summary && <div className="note ok small">Created {d.job.summary.created} entries ({tco2e(d.job.summary.kg)} tCO₂e), {d.job.summary.submitted} sent for approval{d.job.summary.left ? ` · ${d.job.summary.left} rows still to resolve` : ''}.</div>}
      <div className="kgrid4">
        {(['ready', 'check', 'problem', 'excluded'] as const).map((k) => <div key={k} className="card kpi click" onClick={() => setFilter(k)}>
          <div className="lbl">{{ ready: 'Ready', check: 'To check', problem: 'Problems', excluded: 'Left out / already entered' }[k]}</div><div className="v">{c(k)}</div>
          <div className="muted small">{k === 'ready' ? `${tco2e(d.counts.ready?.kg ?? 0)} tCO₂e` : k === 'check' ? 'AI or unsure matches: confirm the activity' : k === 'problem' ? 'facility, activity, unit or month missing' : c('created') ? `${c('created')} created` : 'totals and zeros are skipped'}</div></div>)}
      </div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row"><h2 className="grow">Activities found</h2><label className="row small chkline" style={{ gap: 6 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember my choices for the next files</label></div>
        <div className="scrollx"><table className="t">
          <thead><tr><th>In the file</th><th className="num">Rows</th><th className="num">Quantity</th><th>Catalogue item</th><th className="ctr">Matched by</th><th className="num">tCO₂e</th><th /></tr></thead>
          <tbody>{d.activities.map((a, i) => <tr key={i}>
            <td><b>{a.description ?? '—'}</b><div className="muted small">{[a.unit_text, a.category].filter(Boolean).join(' · ')}</div></td>
            <td className="num">{a.rows}</td><td className="num">{num(a.quantity)}<div className="muted small">{a.unit ?? a.unit_text ?? ''}</div></td>
            <td style={{ minWidth: 280 }}><select className="input" disabled={busy || a.created === a.rows} value={a.item_id ?? ''} onChange={(e) => void act(() => api.importItem(id, { description: a.description, unitText: a.unit_text, itemId: e.target.value ? Number(e.target.value) : null, remember }), 'Activity set')}>
              <option value="">Choose the item…</option>{catalogue.map(([g, items]) => <optgroup key={g} label={g}>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}</select></td>
            <td className="ctr">{a.method ? <span className={`chip ${METHOD[a.method]?.[1] ?? 'c-n'}`}>{METHOD[a.method]?.[0] ?? a.method}{a.method === 'text' && a.conf != null ? ` ${Math.round(a.conf * 100)}%` : ''}</span> : '—'}</td>
            <td className="num">{a.kg != null ? tco2e(a.kg) : '—'}</td>
            <td>{a.check > 0 && a.item_id && <button className="btn sm" disabled={busy} onClick={() => void act(() => api.importItem(id, { description: a.description, unitText: a.unit_text, itemId: a.item_id, remember }), 'Confirmed')}>Confirm</button>}</td></tr>)}</tbody></table></div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2>Facilities found</h2>
        <div className="scrollx"><table className="t"><thead><tr><th>In the file</th><th className="num">Rows</th><th>Facility</th></tr></thead>
          <tbody>{d.facilities.map((f, i) => <tr key={i}>
            <td><b>{f.facility_text ?? '(none — the sheet has no facility)'}</b></td><td className="num">{f.rows}</td>
            <td style={{ minWidth: 260 }}><select className="input" disabled={busy} value={f.facility_id ?? ''} onChange={(e) => void act(() => api.importFacility(id, { text: f.facility_text, facilityId: e.target.value || null, remember }), 'Facility set')}>
              <option value="">Not recognised — choose…</option>{d.enterable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td></tr>)}</tbody></table></div>
      </div>

      {d.sheets.map((s) => <SheetCard key={s.id} id={id} s={s} enterable={d.enterable} busy={busy} act={act} />)}

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><h2 className="grow">Rows</h2>
          {(['all', 'ready', 'check', 'problem', 'excluded', 'created'] as const).map((k) => <button key={k} className={`btn xs ${filter === k ? 'p' : 'ghost'}`} onClick={() => setFilter(k)}>{k === 'all' ? 'All' : ST[k][0]}{k !== 'all' ? ` · ${c(k)}` : ''}</button>)}</div>
        <div className="scrollx"><table className="t">
          <thead><tr><th>Sheet · row</th><th>Facility</th><th>Month</th><th>Activity</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id}>
            <td className="small">{r.sheet} · {r.row_no}</td>
            <td className="small">{r.facility ?? <span className="bad">{r.facility_text ?? '—'}</span>}</td>
            <td className="small">{r.period_start && r.period_end && r.period_start.slice(0, 7) !== r.period_end.slice(0, 7) ? `${ml(r.period_start)} – ${ml(r.period_end)}` : ml(r.period_start)}</td>
            <td><b>{r.item ?? r.description ?? '—'}</b>{r.item && r.description && <div className="muted small">{r.description}</div>}
              {r.problems.length > 0 && <div className="small bad">{r.problems.join(' · ')}</div>}
              {!!r.warnings?.length && <div className="small" style={{ color: 'var(--warn)' }}>{r.warnings.join(' · ')}</div>}</td>
            <td className="num">{num(r.quantity)} <span className="muted small">{r.unit ?? r.unit_text ?? ''}</span></td>
            <td className="num">{r.co2e != null ? tco2e(r.co2e) : '—'}</td>
            <td className="ctr"><span className={`chip ${ST[r.status][1]}`}>{ST[r.status][0]}</span></td>
            <td>{r.status === 'excluded' ? <button className="btn xs ghost" disabled={busy} onClick={() => void act(() => api.importRows(id, [r.id], false))}>Bring back</button>
              : r.status !== 'created' ? <button className="btn xs ghost" disabled={busy} onClick={() => void act(() => api.importRows(id, [r.id], true))}>Leave out</button>
              : r.activity_id ? <span className="muted small">entry made</span> : null}</td></tr>)}
            {!d.rows.length && <tr><td colSpan={8} className="muted">No rows here.</td></tr>}</tbody></table></div>
        {d.rows.length === 300 && <div className="muted small">The first 300 rows are shown; filter by status to see the others.</div>}
      </div>
    </div>
  );
}

function SheetCard({ id, s, enterable, busy, act }: { id: string; s: ImportDetail['sheets'][number]; enterable: { id: string; name: string }[]; busy: boolean; act: (fn: () => Promise<unknown>, msg?: string) => Promise<unknown> }) {
  const [m, setM] = useState<SheetMapping>(s.mapping);
  const [open, setOpen] = useState(false);
  useEffect(() => setM(s.mapping), [s.mapping]);
  const head = s.head ?? [];
  const width = Math.max(0, ...head.map((r) => r.length));
  const headings = head[m.headerRow] ?? [];
  const label = (i: number) => `${colName(i)} · ${String(headings[i] ?? '').slice(0, 30) || '(no heading)'}`;
  const mappedCols = new Map<number, string>([...ROLE_LABEL.filter(([k]) => m.cols[k] != null).map(([k, l]) => [m.cols[k]!, l] as [number, string]), ...m.months.map((x) => [x.col, x.month] as [number, string])]);
  const by = { ai: ['read by AI', 'c-info'], auto: ['from the headings', 'c-n'], person: ['set by you', 'c-ok'] }[s.proposed_by];
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h2 className="grow">Sheet “{s.name}” <span className={`chip ${by[1]}`}>{by[0]}</span> {!m.use && <span className="chip c-n">not used</span>}</h2>
        <span className="muted small">{s.total_rows} rows · {m.layout === 'months' ? `one column per month (${m.months.length})` : 'one entry per row'} · headings in row {m.headerRow + 1}</span>
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Hide the layout' : 'Check or change the layout'}</button>
      </div>
      {s.note && <div className="muted small">{s.note}</div>}
      {open && <>
        <div className="scrollx" style={{ maxHeight: 280 }}><table className="t sheetprev">
          <thead><tr><th>#</th>{Array.from({ length: Math.min(width, 20) }, (_, i) => <th key={i} className={mappedCols.has(i) ? 'on' : ''}>{colName(i)}{mappedCols.has(i) && <div className="small">{mappedCols.get(i)}</div>}</th>)}</tr></thead>
          <tbody>{head.slice(0, 12).map((r, ri) => <tr key={ri} className={ri === m.headerRow ? 'hdr' : ''}><td className="muted small">{ri + 1}</td>
            {Array.from({ length: Math.min(width, 20) }, (_, i) => <td key={i} className={`small${mappedCols.has(i) ? ' on' : ''}`}>{String(r[i] ?? '').slice(0, 24)}</td>)}</tr>)}</tbody></table></div>
        <div className="vform">
          <label className="field"><span>Use this sheet</span><select className="input" value={m.use ? 'y' : 'n'} onChange={(e) => setM({ ...m, use: e.target.value === 'y' })}><option value="y">Yes</option><option value="n">No (notes, summary, factors…)</option></select></label>
          <label className="field"><span>Headings in row</span><input className="input num" value={m.headerRow + 1} onChange={(e) => setM({ ...m, headerRow: Math.max(0, (Number(e.target.value) || 1) - 1) })} /></label>
          <label className="field span2"><span>Layout</span><select className="input" value={m.layout} onChange={(e) => setM({ ...m, layout: e.target.value as SheetMapping['layout'] })}>
            <option value="rows">One entry per row (a quantity column, a date or month column)</option><option value="months">One column per month (Jan, Feb, … across)</option></select></label>
          {ROLE_LABEL.filter(([k]) => m.layout === 'rows' || !['quantity', 'date', 'month'].includes(k)).map(([k, l]) => <label key={k} className="field"><span>{l} column</span>
            <select className="input" value={m.cols[k] ?? ''} onChange={(e) => setM({ ...m, cols: { ...m.cols, [k]: e.target.value === '' ? null : Number(e.target.value) } })}>
              <option value="">—</option>{Array.from({ length: width }, (_, i) => <option key={i} value={i}>{label(i)}</option>)}</select></label>)}
          {m.layout === 'months' && <div className="field span2"><span>Month columns</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{Array.from({ length: width }, (_, i) => i).filter((i) => !Object.values(m.cols).includes(i)).map((i) => {
              const x = m.months.find((y) => y.col === i);
              return <label key={i} className="small row" style={{ gap: 4 }}>{colName(i)}<input className="input sm" style={{ width: 92 }} placeholder="YYYY-MM" value={x?.month ?? ''}
                onChange={(e) => { const v = e.target.value.trim(); setM({ ...m, months: [...m.months.filter((y) => y.col !== i), ...(/^\d{4}-\d{2}$/.test(v) ? [{ col: i, month: v }] : [])].sort((a, b) => a.col - b.col) }); }} /></label>;
            })}</div></div>}
          <label className="field"><span>Facility for the whole sheet</span><select className="input" value={m.constant.facility ?? ''} onChange={(e) => setM({ ...m, constant: { ...m.constant, facility: e.target.value || null } })}>
            <option value="">— (from the column)</option>{enterable.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}</select></label>
          <label className="field"><span>Year (when only months are given)</span><input className="input num" value={m.constant.year ?? ''} onChange={(e) => setM({ ...m, constant: { ...m.constant, year: Number(e.target.value) || null } })} /></label>
          <label className="field"><span>Unit for the whole sheet</span><input className="input" value={m.constant.unit ?? ''} placeholder="e.g. litres, kWh, kg" onChange={(e) => setM({ ...m, constant: { ...m.constant, unit: e.target.value || null } })} /></label>
          <label className="field"><span>Activity for the whole sheet</span><input className="input" value={m.constant.description ?? ''} placeholder="e.g. Diesel, Electricity" onChange={(e) => setM({ ...m, constant: { ...m.constant, description: e.target.value || null } })} /></label>
        </div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setM(s.mapping)}>Undo changes</button>
          <button className="btn p" disabled={busy} onClick={() => void act(() => api.importSheet(id, s.id, m), 'Layout applied')}>Apply this layout</button></div>
      </>}
    </div>
  );
}
