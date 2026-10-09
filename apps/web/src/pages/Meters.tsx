/**
 * Meters: the register, each meter's months (consumption, coverage, gaps, its entry)
 * and readings. Readings come from another system through the API, or are pasted here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, tco2e, unitLabel, type Facility, type Meter, type MeterDetail } from '../lib/api';
import { MeterForm, takeDraft, type MeterDraft } from '../components/MeterForm';
import { Icon } from '../components/Icon';

const FREQ: Record<string, string> = { hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly', irregular: 'irregular' };
/** 31/03/2026 14:00 (day first, as in the UAE) → 2026-03-31 14:00; ISO times unchanged. */
const isoTime = (s: string) => s.replace(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/, (_m, d, mo, y) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
const localTime = (iso: string, tz?: string) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Meters() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  useEffect(() => { api.facilities().then((r) => setFacilities(r.facilities)); }, []);
  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1>Meters</h1>
          <p className="sub">All meters across the company and how their readings are arriving. Each ended month becomes one entry, with its coverage and any gaps shown. A facility's own meters are also under Organisation → the facility → Meters.</p></div>
        <label className="field" style={{ alignSelf: 'flex-end', minWidth: 240 }}><span>Facility</span>
          <select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            <option value="">All facilities</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.parent_name ? `${f.parent_name} › ` : ''}{f.name}</option>)}</select></label>
      </div>
      <MeterRegister facilityId={facilityId || undefined} facilities={facilities} />
    </div>
  );
}

/**
 * The meter list with its add form and the open meter's panel. Used on Capture → Meters
 * (all facilities) and on the facility page (one facility, `embedded`).
 */
export function MeterRegister({ facilityId, facilities, embedded, canEditFacility = true, onCount }: { facilityId?: string; facilities: Facility[]; embedded?: boolean; canEditFacility?: boolean; onCount?: (n: number) => void }) {
  const { role, tenant } = useApp();
  const tz = tenant?.timezone ?? 'Asia/Dubai';
  const [params, setParams] = useSearchParams();
  const [meters, setMeters] = useState<Meter[]>([]);
  const [open, setOpen] = useState<string | null>(embedded ? null : params.get('id'));
  const [adding, setAdding] = useState<MeterDraft | null | false>(false);
  const canManage = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role) && canEditFacility;
  const load = () => api.meters(facilityId).then((r) => { setMeters(r.meters); onCount?.(r.meters.length); });
  useEffect(() => { load(); }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!embedded && params.get('new')) { setAdding(takeDraft()); setParams({}, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const formFacilities = (facilityId ? facilities.filter((f) => f.id === facilityId) : facilities).filter((f) => f.canEnter);

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {canManage && adding === false && <div className="row" style={{ justifyContent: embedded ? 'space-between' : 'flex-end' }}>
        {embedded && <span className="sub">Readings arrive through the API, from bills or pasted in the meter. To follow all meters at once: Capture → Meters.</span>}
        <button className="btn p sm" onClick={() => setAdding(null)}><Icon name="plus" />Add meter</button></div>}
      {adding !== false && <MeterForm draft={adding} facilities={formFacilities} onDone={(m) => { setAdding(false); load(); if (m) setOpen(m.id); }} />}
      <div className={embedded ? 'scrollx' : 'card flush'}>
        {meters.length ? (
          <table className="t">
            <thead><tr><th>Meter</th><th>Measures</th><th>Readings</th><th>Last reading</th>{!embedded && <th className="num">Count</th>}<th className="num">Entries</th><th /></tr></thead>
            <tbody>{meters.map((m) => (
              <tr key={m.id} className={`click ${open === m.id ? 'sel' : ''}`} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <td><b>{m.name}</b>{!m.active && <span className="chip grey" style={{ marginLeft: 6 }}>inactive</span>}<div className="muted small">{!embedded && <><Link to={`/organisation?open=${m.facility_id}&tab=meters`} onClick={(e) => e.stopPropagation()}>{m.facility}</Link> · </>}<span className="mono">{m.external_id}</span>{m.account_no ? ` · account ${m.account_no}` : ''}</div></td>
                <td>{m.item}<div className="muted small">{m.category_name}</div></td>
                <td>{FREQ[m.frequency]} · {m.reading_type === 'cumulative' ? 'register' : 'per period'}<div className="muted small">{unitLabel(m.unit)}{Number(m.multiplier) !== 1 ? ` × ${Number(m.multiplier)}` : ''}</div></td>
                <td>{m.last ? <>{num(Number(m.last.value))}<div className="muted small">{localTime(m.last.ts, tz)}</div></> : <span className="chip warn">none yet</span>}</td>
                {!embedded && <td className="num">{m.readings.toLocaleString('en')}</td>}
                <td className="num">{m.entries}</td>
                <td>{m.auto_entries ? <span className="chip">automatic</span> : <span className="chip grey">manual</span>}</td>
              </tr>))}</tbody>
          </table>
        ) : <div className="empty">No meters{facilityId ? ' for this facility' : ''} yet.{canManage ? ' Add one here, or from Add data (Month by month → “Set up a meter with these inputs”).' : ''}</div>}
      </div>
      {open && <div className={embedded ? 'scrollx' : undefined}><MeterPanel key={open} id={open} facilities={facilities} canManage={canManage} onChanged={load} onClose={() => setOpen(null)} /></div>}
    </div>
  );
}

function MeterPanel({ id, facilities, canManage, onChanged, onClose }: { id: string; facilities: Facility[]; canManage: boolean; onChanged: () => void; onClose: () => void }) {
  const { toast } = useApp();
  const [m, setM] = useState<MeterDetail | null>(null);
  const [tab, setTab] = useState<'months' | 'readings' | 'settings'>('months');
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.meter(id).then(setM).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "timestamp, value[, start]" per line; tab, comma or semicolon separated; header row skipped.
  const parsed = useMemo(() => {
    const rows: { timestamp: string; value: number; start?: string }[] = [], bad: string[] = [];
    for (const line of paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const c = line.split(/\t|;|,(?=\s*[-\d])/).map((x) => x.trim());
      if (c.length < 2 || /^[a-z]/i.test(c[0]!)) { if (!/^[a-z]/i.test(c[0] ?? '')) bad.push(line); continue; }
      const v = Number(c[1]!.replace(/[\s,]/g, ''));
      if (!Number.isFinite(v)) { bad.push(line); continue; }
      rows.push({ timestamp: isoTime(c[0]!), value: v, ...(c[2] ? { start: isoTime(c[2]) } : {}) });
    }
    return { rows, bad };
  }, [paste]);
  const sendPaste = async () => {
    setErr(null);
    try {
      const r = await api.addReadings(id, parsed.rows);
      toast(`${r.inserted} new, ${r.updated} corrected${r.rejected.length ? `, ${r.rejected.length} not accepted` : ''}${r.sync ? ` · entries: ${r.sync.created} created, ${r.sync.updated} updated` : ''}`);
      if (r.rejected.length) setErr(r.rejected.slice(0, 5).map((x) => `Line ${x.index + 1}: ${x.reason}`).join(' · '));
      else setPaste('');
      load(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const sync = async () => { const r = await api.syncMeter(id); toast(`Entries: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged${r.locked.length ? `, ${r.locked.length} approved (not changed)` : ''}`); if (r.problems.length || r.locked.length) setErr([...r.problems, ...r.locked].join(' · ')); load(); onChanged(); };

  if (!m) return <div className="card empty">{err ?? 'Loading…'}</div>;
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <div className="grow"><div className="eyebrow">Meter · {m.facility}</div><h2>{m.name}</h2>
          <div className="sub">{m.item} · {FREQ[m.frequency]} {m.reading_type === 'cumulative' ? 'register readings' : 'consumption per period'} in {unitLabel(m.unit)} · id <span className="mono">{m.external_id}</span>{m.account_no ? ` · account ${m.account_no}` : ''} · months in {m.timezone}</div></div>
        {m.canEdit && <button className="btn sm" onClick={sync}>Create / update entries now</button>}
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <div className="tabs">
        <button className={tab === 'months' ? 'on' : ''} onClick={() => setTab('months')}>Months</button>
        <button className={tab === 'readings' ? 'on' : ''} onClick={() => setTab('readings')}>Readings ({m.readings.toLocaleString('en')})</button>
        {canManage && m.canEdit && <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>Settings</button>}
      </div>
      {err && <div className="note bad">{err}</div>}
      {m.issues.map((i) => <div key={i} className="note warn">{i}</div>)}

      {tab === 'months' && (m.months.length ? (
        <table className="t">
          <thead><tr><th>Month</th><th className="num">Readings</th><th>Coverage</th><th className="num">Measured</th><th className="num">For the entry</th><th>Entry</th><th>Notes</th></tr></thead>
          <tbody>{m.months.map((mo) => {
            const e = mo.entry;
            const co2 = e ? Number(e.co2e_direct) + Number(e.co2e_scope2) + Number(e.co2e_scope3) : 0;
            return (
              <tr key={mo.month}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{mo.month}</td>
                <td className="num">{mo.readings.toLocaleString('en')}</td>
                <td style={{ minWidth: 120 }}><div className="cov"><i style={{ width: `${Math.round(mo.coverage * 100)}%` }} /></div><span className="muted small">{(mo.coverage * 100).toFixed(mo.coverage === 1 ? 0 : 1)}%</span></td>
                <td className="num">{num(mo.measured)}</td>
                <td className="num"><b>{num(mo.consumption)}</b> <span className="muted small">{unitLabel(m.unit)}</span>{mo.filled && <div><span className="chip warn">estimated</span></div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{e ? <><span className={`chip ${e.status === 'approved' ? '' : 'grey'}`}>{e.status}</span> {Number(e.co2e_scope2) || Number(e.co2e_scope2_market)
                    ? <span className="small">loc. {tco2e(Number(e.co2e_scope2))} · mkt. {tco2e(Number(e.co2e_scope2_market))} t</span> : <>{tco2e(co2)} t</>}</>
                  : !mo.closed ? <span className="muted small">month not ended</span> : m.auto_entries ? <span className="muted small">not created yet</span> : <span className="muted small">manual: use “Create / update”</span>}</td>
                <td className="small">{mo.issues.join('; ')}</td>
              </tr>);
          })}</tbody>
        </table>) : <div className="empty">No readings yet.</div>)}

      {tab === 'readings' && <>
        {m.canEdit && (
          <fieldset className="box"><legend>Paste readings (one per line: time, value{m.reading_type === 'interval' ? ', start (optional)' : ''})</legend>
            <textarea className="input" rows={5} style={{ width: '100%', height: 'auto', fontFamily: 'var(--mono, monospace)' }} value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder={`2026-03-01 00:00\t${m.reading_type === 'cumulative' ? '458120' : '1520'}\n2026-03-02 00:00\t${m.reading_type === 'cumulative' ? '459640' : '1488'}\n\nTimes without a zone are read in ${m.timezone}; with one (2026-03-01T00:00+04:00 or …Z) as given.`} />
            {paste && <div className="sub">{parsed.rows.length} readings{parsed.bad.length ? <span className="bad"> · not read: {parsed.bad.slice(0, 3).join('; ')}</span> : ''}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm p" disabled={!parsed.rows.length} onClick={sendPaste}>Save {parsed.rows.length || ''} readings</button></div>
          </fieldset>
        )}
        <table className="t">
          <thead><tr><th>Time ({m.timezone})</th>{m.reading_type === 'interval' && <th>From</th>}<th className="num">Value</th><th>Source</th><th>Received</th><th /></tr></thead>
          <tbody>{m.recent.map((r) => (
            <tr key={r.ts}><td className="mono">{localTime(r.ts, m.timezone)}</td>{m.reading_type === 'interval' && <td className="mono">{r.from_ts ? localTime(r.from_ts, m.timezone) : '—'}</td>}
              <td className="num">{num(Number(r.value))}</td><td><span className="chip grey">{r.source}</span></td><td className="muted small">{localTime(r.received_at, m.timezone)}</td>
              <td>{canManage && m.canEdit && r.source !== 'bill' && <button className="btn ghost sm" aria-label="Delete reading" onClick={async () => { await api.deleteReading(id, r.ts); load(); }}><Icon name="x" /></button>}</td></tr>))}</tbody>
        </table>
        {m.readings > m.recent.length && <div className="sub">Latest {m.recent.length} of {m.readings.toLocaleString('en')} readings shown.</div>}
      </>}

      {tab === 'settings' && <>
        <MeterForm meter={m} facilities={facilities} onDone={(x) => { if (x) { toast('Meter saved'); load(); onChanged(); } setTab('months'); }} />
        {m.entries === 0 && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm danger" onClick={async () => { try { await api.deleteMeter(id); onChanged(); onClose(); } catch (e) { setErr((e as Error).message); } }}>Delete meter</button></div>}
      </>}
    </div>
  );
}
