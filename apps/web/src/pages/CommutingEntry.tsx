/**
 * Employee commuting (Scope 3.7): once a year per facility.
 *
 * Type in the employees per way of travelling with their average one-way distance and days at the
 * workplace (or the year's total, e.g. from a shuttle contract), or upload the answers of a
 * commuting survey, which are scaled up to the facility's employees. Check shows the distances and
 * tCO₂e; Save replaces the facility's commuting for the year with one entry per mode and month,
 * split by the working days of each month.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import {
  api, download, num, tco2e, type CommuteAnswer, type CommuteBody, type CommuteMode, type CommuteOptions, type CommuteRecord, type CommuteResult,
  type CommuteTypedRow, type Survey, type SurveyRead, type Weekend,
} from '../lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FRI_SAT = new Set(['SA', 'KW', 'QA', 'BH', 'OM', 'JO', 'EG', 'IQ', 'LY', 'DZ', 'SD', 'YE', 'SY', 'IL', 'BD']);
const WEEKENDS: [Weekend, string][] = [['sat_sun', 'Saturday–Sunday'], ['fri_sat', 'Friday–Saturday'], ['sun', 'Sunday only (6-day week)']];
const FIELDS: [string, string][] = [['mode', 'Main way to work *'], ['km', 'One-way distance'], ['days', 'Days at the workplace per week'], ['occupants', 'People in the car'],
  ['fuel', 'Car fuel'], ['mode2', 'Second way'], ['km2', 'Second distance'], ['site', 'Site']];
const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
type Row = { mode: CommuteMode; fuel: string; employees: string; km: string; days: string; occ: string; annual: string; itemCode: string };
const blankRow = (mode: CommuteMode = 'car'): Row => ({ mode, fuel: 'unknown', employees: '', km: '', days: '', occ: mode === 'carpool' ? '2' : '', annual: '', itemCode: '' });

export function CommutingEntry({ facilityId, year, onSaved }: { facilityId: string; year: number; onSaved?: () => void }) {
  const { toast } = useApp();
  const [opt, setOpt] = useState<CommuteOptions | null>(null);
  const [rec, setRec] = useState<CommuteRecord | null>(null);
  const [months, setMonths] = useState<{ m: number; t: number; n: number; approved: number }[]>([]);
  const [facName, setFacName] = useState('');
  const [method, setMethod] = useState<'typed' | 'survey'>('typed');
  const [headcount, setHeadcount] = useState('');
  // the usual weekend of the company's country (Friday–Saturday in much of the Middle East and North Africa)
  const [weekend, setWeekend] = useState<Weekend>(FRI_SAT.has(useApp().tenant?.country ?? '') ? 'fri_sat' : 'sat_sun');
  const [holidays, setHolidays] = useState('12');
  const [leave, setLeave] = useState('22');
  const [wdOverride, setWdOverride] = useState('');
  const [rows, setRows] = useState<Row[]>([blankRow('car')]);
  const [file, setFile] = useState<File | null>(null);
  const [sv, setSv] = useState<SurveyRead | null>(null);
  const [answers, setAnswers] = useState<CommuteAnswer[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [res, setRes] = useState<CommuteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [surveys, setSurveys] = useState<{ list: Survey[]; canCreate: boolean } | null>(null);
  useEffect(() => { api.surveys().then((r) => setSurveys({ list: r.surveys, canCreate: r.canCreate })).catch(() => setSurveys(null)); }, []);
  const mine = (surveys?.list ?? []).filter((x) => x.year === year && x.facility_ids.includes(facilityId));

  useEffect(() => { api.commuteOptions(year).then(setOpt).catch(() => {}); }, [year]);
  const load = () => {
    if (!facilityId) return;
    setRes(null); setErr(null); setSv(null); setFile(null);
    api.commuteRecord(facilityId, year).then((r) => {
      setRec(r.record); setMonths(r.months); setFacName(r.facility.name);
      const x = r.record;
      if (x) {
        setMethod(x.method); setHeadcount(String(x.headcount)); setWeekend(x.weekend);
        setHolidays(String(x.result.settings?.holidays ?? '')); setLeave(String(x.result.settings?.leave ?? ''));
        setWdOverride(x.result.settings?.holidays == null ? String(x.working_days) : '');
        setRows(x.rows.length ? x.rows.map((q) => ({ mode: q.mode, fuel: q.fuel ?? 'unknown', employees: String(q.employees), km: q.oneWayKm != null ? String(q.oneWayKm) : '', days: q.daysPerWeek != null ? String(q.daysPerWeek) : '',
          occ: q.occupants != null ? String(q.occupants) : '', annual: q.annualKm != null ? String(q.annualKm) : '', itemCode: q.itemCode ?? '' })) : [blankRow('car')]);
        setAnswers(r.answers); setMap(x.survey?.columns ?? {});
        setRes(x.result);
      } else {
        setMethod('typed'); setHeadcount(r.facility.employees ? String(r.facility.employees) : ''); setRows([blankRow('car')]); setAnswers([]); setMap({});
        setHolidays('12'); setLeave('22'); setWdOverride('');
      }
    }).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, [facilityId, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekdays = opt?.defaults[weekend]?.weekdays ?? 260;
  const computedWd = weekdays - (Number(holidays) || 0) - (Number(leave) || 0);
  const workingDays = wdOverride ? Number(wdOverride) : computedWd;
  const locked = (rec?.approved ?? 0) > 0;
  const modeOf = (k: CommuteMode) => opt?.modes.find((m) => m.key === k);

  const body = (): CommuteBody => ({
    facilityId, year, method, headcount: Number(headcount) || 0, workingDays, weekend,
    holidays: wdOverride ? undefined : Number(holidays) || 0, leave: wdOverride ? undefined : Number(leave) || 0,
    rows: method === 'typed' ? rows.filter((r) => r.employees.trim() !== '' || r.annual.trim() !== '').map((r): CommuteTypedRow => ({
      mode: r.mode, employees: Number(r.employees) || 0, fuel: modeOf(r.mode)?.perVehicle && r.mode !== 'motorbike' ? r.fuel : undefined, itemCode: r.itemCode || undefined,
      oneWayKm: n(r.km), daysPerWeek: n(r.days), occupants: n(r.occ), annualKm: n(r.annual),
    })) : [],
    answers: method === 'survey' ? answers : [],
    survey: method === 'survey' ? { file: sv?.file ?? rec?.survey?.file, columns: sv?.columns ?? rec?.survey?.columns, site: sv?.site ?? rec?.survey?.site ?? null, unrecognised: sv ? sv.unrecognised.reduce((a, u) => a + u.count, 0) : rec?.survey?.unrecognised } : undefined,
  });
  const check = async () => {
    setErr(null); setBusy(true);
    try { setRes(await api.commutePreview(body())); } catch (e) { setRes(null); setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setErr(null); setBusy(true);
    try { const r = await api.commuteSave(body()); toast(`Employee commuting ${year} saved: ${r.entries} monthly entries, ${tco2e(r.kg)} tCO₂e`); load(); onSaved?.(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!rec) return;
    setBusy(true);
    try { await api.commuteDelete(rec.id); toast('Commuting record removed'); load(); onSaved?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const read = async (f: File, q: { map?: Record<string, string>; site?: string } = {}) => {
    setErr(null); setBusy(true); setRes(null);
    try { const r = await api.readSurvey(facilityId, f, { ...q, weekend }); setSv(r); setAnswers(r.answers); setMap(r.columns); } catch (e) { setSv(null); setAnswers([]); setErr((e as Error).message); } finally { setBusy(false); }
  };

  const modeCount = useMemo(() => {
    const m = new Map<CommuteMode, number>(); for (const a of answers) m.set(a.mode, (m.get(a.mode) ?? 0) + 1); return m;
  }, [answers]);
  const typedTotal = rows.reduce((a, r) => a + (Number(r.employees) || 0), 0);

  if (!facilityId) return <div className="card empty">Choose a facility.</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <b>{facName} · {year}</b>
          {rec ? <span className="chip">{rec.survey_id ? `From survey “${rec.survey_name ?? 'Ekotrace survey'}” · ${rec.answers} answers` : rec.method === 'survey' ? `Survey file · ${rec.answers} answers` : 'Typed in'} · {tco2e(rec.result.kg)} tCO₂e · saved {rec.updated_at.slice(0, 10)}{rec.updated_by_name ? ` by ${rec.updated_by_name}` : ''}</span>
            : <span className="chip grey">Not entered for {year} yet</span>}
          {locked && <span className="chip warn">{rec!.approved} of {rec!.entries} monthly entries approved: locked</span>}
          <span className="grow" />
          <span className="muted small">Entered once a year per facility. Saving again replaces it.</span>
        </div>
        <div className="seg" role="group" aria-label="How">
          <button className={method === 'typed' ? 'on' : ''} disabled={locked} onClick={() => { setMethod('typed'); setRes(null); }}>Type in</button>
          <button className={method === 'survey' ? 'on' : ''} disabled={locked} onClick={() => { setMethod('survey'); setRes(null); }}>From a survey</button>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 150 }}><span>Employees at the facility</span><input className="input" inputMode="numeric" value={headcount} disabled={locked} onChange={(e) => setHeadcount(e.target.value)} /></label>
          <label className="field" style={{ width: 200 }}><span>Weekend</span>
            <select className="input" value={weekend} disabled={locked} onChange={(e) => setWeekend(e.target.value as Weekend)}>{WEEKENDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field" style={{ width: 120 }}><span>Public holidays</span><input className="input" inputMode="numeric" value={holidays} disabled={locked || !!wdOverride} onChange={(e) => setHolidays(e.target.value)} /></label>
          <label className="field" style={{ width: 120 }}><span>Annual leave (days)</span><input className="input" inputMode="numeric" value={leave} disabled={locked || !!wdOverride} onChange={(e) => setLeave(e.target.value)} /></label>
          <label className="field" style={{ width: 150 }}><span>Working days in {year}</span>
            <input className="input" inputMode="numeric" value={wdOverride || String(computedWd)} disabled={locked} onChange={(e) => setWdOverride(e.target.value === String(computedWd) ? '' : e.target.value)} /></label>
          <span className="muted small" style={{ maxWidth: 380, lineHeight: 1.4 }}>{weekdays} weekdays − holidays − leave{wdOverride ? ' (typed over)' : ''}. Holidays and leave come off the year's total; the year is then spread over the months by their working days.</span>
        </div>
      </div>

      {method === 'typed' ? (
        <div className="card flush">
          <div className="scrollx"><table className="t compact">
            <thead><tr><th>Way to work</th><th>Car fuel</th><th className="num">Employees</th><th className="num">One-way km</th><th className="num">Days / week</th><th className="num">People per car</th><th className="num">or year's total</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => {
              const m = modeOf(r.mode), car = m?.perVehicle && r.mode !== 'motorbike';
              const set = (o: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...o } : x)));
              const items = opt?.items.filter((it) => it.code.startsWith(r.mode === 'car' || r.mode === 'carpool' ? 'commute:car:' : r.mode === 'shuttle' ? 'commute:bus:' : r.mode === 'metro' || r.mode === 'train' ? 'commute:rail:' : `commute:${r.mode}:`)) ?? [];
              return (
                <tr key={i}>
                  <td><select className="input" value={r.mode} disabled={locked} onChange={(e) => set({ mode: e.target.value as CommuteMode, itemCode: '', occ: e.target.value === 'carpool' ? '2' : '' })}>{opt?.modes.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                    {items.length > 1 && r.mode !== 'car' && r.mode !== 'carpool' && <select className="input" style={{ marginTop: 4 }} value={r.itemCode} disabled={locked} onChange={(e) => set({ itemCode: e.target.value })}><option value="">Default factor</option>{items.map((it) => <option key={it.code} value={it.code}>{it.name}</option>)}</select>}</td>
                  <td>{car ? <select className="input" value={r.fuel} disabled={locked} onChange={(e) => set({ fuel: e.target.value })}>{opt?.fuels.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select> : <span className="muted">—</span>}</td>
                  <td className="num"><input className="input num" style={{ width: 90 }} value={r.employees} disabled={locked} onChange={(e) => set({ employees: e.target.value })} /></td>
                  <td className="num">{r.mode === 'wfh' ? '—' : <input className="input num" style={{ width: 80 }} value={r.km} disabled={locked || r.annual !== ''} onChange={(e) => set({ km: e.target.value })} />}</td>
                  <td className="num">{r.mode === 'wfh' ? '—' : <input className="input num" style={{ width: 70 }} placeholder={weekend === 'sun' ? '6' : '5'} value={r.days} disabled={locked || r.annual !== ''} onChange={(e) => set({ days: e.target.value })} />}</td>
                  <td className="num">{car ? <input className="input num" style={{ width: 70 }} placeholder="1" value={r.occ} disabled={locked} onChange={(e) => set({ occ: e.target.value })} /> : '—'}</td>
                  <td className="num">{r.mode === 'wfh' || r.mode === 'active' ? '—' : <input className="input num" style={{ width: 110 }} placeholder={m?.unit === 'pkm' ? 'passenger-km' : 'car-km'} value={r.annual} disabled={locked} onChange={(e) => set({ annual: e.target.value })} />}</td>
                  <td><button className="btn sm ghost" disabled={locked} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>
                </tr>);
            })}</tbody>
          </table></div>
          <div className="row" style={{ padding: '10px 16px', gap: 10 }}>
            <button className="btn sm" disabled={locked} onClick={() => setRows([...rows, blankRow(['car', 'carpool', 'shuttle', 'bus', 'metro', 'taxi', 'wfh'].find((k) => !rows.some((r) => r.mode === k)) as CommuteMode ?? 'car')])}>+ Way to work</button>
            <span className={`small ${headcount && typedTotal && Math.abs(typedTotal - Number(headcount)) > Number(headcount) * 0.05 ? 'bad' : 'muted'}`}>{typedTotal} of {headcount || '—'} employees placed{headcount && typedTotal < Number(headcount) ? ' · add "Works from home" for those who do not travel' : ''}</span>
          </div>
        </div>
      ) : (
        <>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}><b>Ekotrace surveys</b><span className="muted small">Employees answer with a personal code; results are scaled up to the headcount and published here.</span><span className="grow" />
            {surveys?.canCreate && <Link className="btn sm" to="/surveys?new=1">+ New survey</Link>}</div>
          {rec?.survey_id && <div className="note info" style={{ margin: 0 }}>{year} for {facName} was published from the survey <Link to={`/surveys/${rec.survey_id}?tab=results`}>{rec.survey_name ?? 'Ekotrace survey'}</Link>. To change it, reopen that survey and publish again — or save other data here, which replaces it.</div>}
          {mine.length ? mine.map((x) => { const inv = x.invited ?? 0, ans = x.answered ?? 0; return (
            <div key={x.id} className="row" style={{ gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <span className="gic">🚌</span><b>{x.name}</b>
              <span className={`chip ${x.status === 'published' ? '' : x.status === 'open' ? 'info' : x.status === 'closed' ? 'warn' : 'grey'}`}>{({ draft: 'Draft', open: 'Collecting answers', closed: 'Closed', published: 'Published to Scope 3' } as const)[x.status]}</span>
              <span className="muted small">{ans} / {inv} answered{x.close_at ? ` · answers by ${x.close_at.slice(0, 10)}` : ''}</span>
              <span className="grow" />
              <Link className="btn sm" to={`/surveys/${x.id}`}>Open</Link>
              {x.status !== 'published' && x.status !== 'draft' && <Link className="btn p sm" to={`/surveys/${x.id}?tab=results`}>Results & publish</Link>}
            </div>); })
            : <span className="muted small">{surveys ? `No Ekotrace survey covers ${facName} in ${year}.` : 'Surveys are run by admins and managers.'}</span>}
        </div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}><b>Or use answers collected elsewhere</b></div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => download('/api/commuting/survey-template', 'Ekotrace commuting survey.xlsx')}>Download the survey file</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); void read(f); } e.target.value = ''; }} />
            <button className="btn p sm" disabled={locked || busy} onClick={() => fileRef.current?.click()}>{answers.length ? 'Upload other answers' : 'Upload survey answers'}</button>
            <span className="muted small">Excel or CSV, one row per employee (also an export of Microsoft Forms or Google Forms).</span>
          </div>
          {sv && <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip">{sv.file}</span><span className="chip info">{sv.answers.length} answers used</span>
              {sv.otherSite > 0 && <span className="chip grey">{sv.otherSite} rows of other sites left out</span>}
              {sv.blank > 0 && <span className="chip grey">{sv.blank} rows without a way to work</span>}
              {sv.unrecognised.length > 0 && <span className="chip warn">{sv.unrecognised.reduce((a, u) => a + u.count, 0)} answers not recognised: {sv.unrecognised.slice(0, 4).map((u) => `“${u.value}” (${u.count})`).join(', ')}</span>}
            </div>
            {sv.sites.length > 0 && (
              <label className="field" style={{ maxWidth: 360 }}><span>Rows of this facility (site column)</span>
                <select className="input" value={sv.site ?? ''} onChange={(e) => file && void read(file, { map, site: e.target.value })}>
                  {!sv.site && <option value="">Choose the site value of {facName}</option>}
                  {sv.sites.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.count})</option>)}<option value="*">All rows</option>
                </select></label>)}
            <details><summary className="small">Columns ({Object.keys(sv.columns).length} recognised)</summary>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {FIELDS.map(([k, l]) => <label key={k} className="field" style={{ width: 200 }}><span>{l}</span>
                  <select className="input" value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value })}><option value="">—</option>{sv.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}
                <button className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={() => file && void read(file, { map: Object.fromEntries(Object.entries(map).filter(([, v]) => v)), site: sv.site ?? undefined })}>Read again</button>
              </div></details>
          </>}
          {!sv && rec?.method === 'survey' && !rec.survey_id && <span className="muted small">Saved from {rec.survey?.file ?? 'a survey file'}: {rec.answers} answers. Upload the file again to change them.</span>}
          {answers.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="small"><b>{answers.length}</b> answers for <b>{headcount || '—'}</b> employees{headcount ? ` · response rate ${Math.round((answers.length / Number(headcount)) * 100)}%` : ''}:</span>
              {opt?.modes.filter((m) => modeCount.get(m.key)).map((m) => <span key={m.key} className="chip grey">{m.label} {Math.round(((modeCount.get(m.key) ?? 0) / answers.length) * 100)}%</span>)}
            </div>)}
        </div>
        </>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={busy || locked || (method === 'survey' && !answers.length)} onClick={check}>Check</button>
        <button className="btn p" disabled={busy || locked || !res || (method === 'survey' && !answers.length)} onClick={save}>{rec ? `Save for ${year} (replaces)` : `Save for ${year}`}</button>
        {rec && <button className="btn ghost" disabled={busy || locked} onClick={remove}>Remove</button>}
        {err && <span className="note bad" style={{ margin: 0 }}>{err}</span>}
      </div>

      {res && (
        <div className="card flush">
          <div className="row" style={{ padding: '12px 16px', gap: 16, flexWrap: 'wrap' }}>
            <span><span className="muted small">Scope 3.7 · {year}</span><br /><b style={{ fontSize: 20 }}>{tco2e(res.kg)} tCO₂e</b></span>
            <span><span className="muted small">Person-km</span><br /><b>{num(Math.round(res.personKm))}</b></span>
            {res.respondents != null && <span><span className="muted small">Answers</span><br /><b>{res.respondents}</b> · each = {num(res.scale, 3)} employees</span>}
            <span><span className="muted small">Per employee</span><br /><b>{headcount && Number(headcount) ? `${num(res.kg / Number(headcount), 3)} kg` : '—'}</b></span>
            <span className="grow" />
            <span className="muted small">Factors: DESNZ land travel incl. well-to-tank · per car-km (shared cars divided) or passenger-km</span>
          </div>
          <div className="scrollx"><table className="t compact">
            <thead><tr><th>Way to work</th><th>Factor</th><th className="num">People</th><th className="num">Distance in {year}</th><th className="num">kg CO₂e / unit</th><th className="num">tCO₂e</th></tr></thead>
            <tbody>{[...res.lines].sort((a, b) => b.kg - a.kg).map((l) => (
              <tr key={l.item}><td>{l.item.startsWith('commute:car:') ? 'Car (alone or shared)' : modeOf(l.mode)?.label ?? l.mode}{l.measured && <span className="chip" style={{ marginLeft: 6 }}>year total</span>}</td><td className="muted small">{l.name}{l.source ? ` · ${l.source}` : ''}</td>
                <td className="num">{num(Math.round(l.people))}</td><td className="num">{num(Math.round(l.quantity))} {l.unit === 'pkm' ? 'passenger-km' : l.mode === 'motorbike' ? 'km' : l.mode === 'active' ? 'km' : 'car-km'}</td>
                <td className="num">{num(l.perUnit, 4)}</td><td className="num"><b>{tco2e(l.kg)}</b></td></tr>))}
              {res.byMode.filter((m) => m.mode === 'wfh').map((m) => <tr key="wfh"><td>Works from home</td><td className="muted small">no travel</td><td className="num">{num(Math.round(m.people))}</td><td /><td /><td className="num">0</td></tr>)}
            </tbody></table></div>
          {res.warnings.length > 0 && <div style={{ padding: '8px 16px' }}>{res.warnings.map((w) => <div key={w} className="note warn" style={{ marginBottom: 6 }}>{w}</div>)}</div>}
          <details style={{ padding: '6px 16px 12px' }}><summary className="small">How it was calculated</summary><ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{res.steps.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
        </div>
      )}

      {rec && months.length > 0 && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>Saved as monthly entries (by working days) · tCO₂e</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{MONTHS.map((m, i) => { const x = months.find((y) => y.m === i + 1); return (
            <div key={m} className="stat" style={{ minWidth: 70, padding: '6px 10px' }}><div className="lbl">{m}</div><b>{x ? num(x.t, 3) : '—'}</b>{x?.approved ? <div className="muted small">approved</div> : null}</div>); })}</div>
        </div>)}
    </div>
  );
}
