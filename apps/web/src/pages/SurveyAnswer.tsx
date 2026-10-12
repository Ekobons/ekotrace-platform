/**
 * Answering the employee commuting survey.
 *
 * SurveyAnswerPage: the public page (no sign-in) at /survey — enter the code from the invitation
 * (or follow the link with ?code=), answer, see your commute's kg CO₂e a year. Answers can be
 * changed with the same code until the survey closes.
 * SurveyForm: the questions, also used inside Ekotrace to enter answers on someone's behalf and
 * to preview the form.
 */
import { useEffect, useState } from 'react';
import { api, type SurveyAnswerBody } from '../lib/api';

export interface FormSetup { modes: { key: string; label: string }[]; fuels: { key: string; label: string }[]; facilities: { id: string; name: string }[]; wfh: boolean }
const blank = (): SurveyAnswerBody => ({ days: 5, wfh: 0, legs: [{ mode: '', km: 0 }], fuel: 'petrol', occ: 2 });
const CARS = ['car', 'carpool'];

export function SurveyForm({ setup, initial, facilityId, title, intro, submitLabel = 'Submit answers', onSubmit, onCancel }: {
  setup: FormSetup; initial?: SurveyAnswerBody | null; facilityId: string; title: string; intro?: string; submitLabel?: string;
  onSubmit: (facilityId: string, a: SurveyAnswerBody) => Promise<void>; onCancel?: () => void;
}) {
  const start = initial ?? blank();
  const [fac, setFac] = useState(facilityId);
  const [days, setDays] = useState(start.days);
  const [wfh, setWfh] = useState(start.wfh ?? 0);
  const [legs, setLegs] = useState<{ mode: string; km: string }[]>([0, 1].map((i) => ({ mode: start.legs[i]?.mode ?? '', km: start.legs[i]?.km ? String(start.legs[i]!.km) : '' })));
  const [fuel, setFuel] = useState(start.fuel ?? 'petrol');
  const [occ, setOcc] = useState(start.occ ?? 2);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const car = legs.some((l) => CARS.includes(l.mode)), pool = legs.some((l) => l.mode === 'carpool');
  const setLeg = (i: number, p: Partial<{ mode: string; km: string }>) => setLegs(legs.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const submit = async () => {
    setErr(null);
    const l0 = legs[0]!;
    if (!l0.mode) { setErr('Choose how you usually travel.'); return; }
    const km0 = Number(l0.km);
    if (!['walk', 'scooter'].includes(l0.mode) && days > 0 && !(km0 > 0)) { setErr('Enter the one-way distance in km.'); return; }
    if (km0 > 300 || Number(legs[1]!.km) > 300) { setErr('That distance looks too long for one way — check the km.'); return; }
    const a: SurveyAnswerBody = { days, wfh: setup.wfh ? wfh : 0, fuel: car ? fuel : 'unknown', occ: pool ? occ : 1,
      legs: legs.filter((l, i) => l.mode && (i === 0 || Number(l.km) > 0)).map((l) => ({ mode: l.mode, km: Number(l.km) || 0 })) };
    setBusy(true);
    try { await onSubmit(fac, a); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div><h1 style={{ fontSize: 26, margin: 0 }}>{title}</h1>{intro && <p className="sub" style={{ margin: '4px 0 0' }}>{intro}</p>}</div>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <label className="field"><span>1 · Where do you usually work?</span>
          <select className="input" value={fac} onChange={(e) => setFac(e.target.value)}>{setup.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 200px' }}><span>2 · Days a week you travel to work</span>
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d}>{d}</option>)}</select></label>
          {setup.wfh && <label className="field" style={{ flex: '1 1 200px' }}><span>Days a week you work from home</span>
            <select className="input" value={wfh} onChange={(e) => setWfh(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((d) => <option key={d}>{d}</option>)}</select></label>}
        </div>
        <div style={{ display: 'grid', gap: 10 }}><span className="lbl">3 · How you travel</span>
          {[0, 1].map((i) => (
            <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '2 1 220px' }}><span>{i ? 'Second way, if you change (e.g. bus then metro)' : 'Main way you travel'}</span>
                <select className="input" value={legs[i]!.mode} onChange={(e) => setLeg(i, { mode: e.target.value })}><option value="">{i ? 'No second way' : 'Choose…'}</option>{setup.modes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
              <label className="field" style={{ flex: '1 1 120px' }}><span>One-way km</span>
                <input className="input" inputMode="decimal" placeholder="e.g. 18" value={legs[i]!.km} disabled={!legs[i]!.mode} onChange={(e) => setLeg(i, { km: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
            </div>))}
        </div>
        {car && <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 200px' }}><span>Car fuel</span><select className="input" value={fuel} onChange={(e) => setFuel(e.target.value)}>{setup.fuels.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          {pool && <label className="field" style={{ flex: '1 1 200px' }}><span>People in the car, including you</span><select className="input" value={occ} onChange={(e) => setOcc(Number(e.target.value))}>{[2, 3, 4, 5, 6, 7].map((d) => <option key={d}>{d}</option>)}</select></label>}
        </div>}
        {err && <div className="note bad" style={{ margin: 0 }}>{err}</div>}
        <div className="row"><button className="btn p" style={{ height: 44 }} disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button>{onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}</div>
      </section>
    </div>
  );
}

export function SurveyAnswerPage() {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const [s, setS] = useState<Awaited<ReturnType<typeof api.surveyLookup>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async (c = code) => { setErr(null); setBusy(true); try { setS(await api.surveyLookup(c)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { if (code.replace(/[^A-Za-z0-9]/g, '').length === 8) void lookup(code); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (done !== null && s) return (
    <div className="survey-page"><section className="card" style={{ display: 'grid', gap: 12, textAlign: 'center', padding: 30, maxWidth: 560, margin: '60px auto' }}>
      <div style={{ fontSize: 40 }} aria-hidden="true">🌱</div><h1 style={{ fontSize: 24, margin: 0 }}>Thank you, {s.firstName}!</h1>
      <p className="sub" style={{ margin: 0 }}>Your answers are saved. Your commute is about <b>{done.toLocaleString('en')} kg CO₂e a year</b>.</p>
      <p className="sub" style={{ margin: 0, fontSize: 13 }}>You can change your answers with the same code until the survey closes.</p>
      <div><button className="btn" onClick={() => setDone(null)}>Change my answers</button></div>
    </section></div>);
  if (s) return (
    <div className="survey-page" style={{ maxWidth: 640, margin: '30px auto', padding: '0 16px' }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{s.company} · {s.survey.name}</div>
      <SurveyForm setup={{ modes: s.modes, fuels: s.fuels, facilities: s.facilities, wfh: s.survey.wfh }} initial={s.answers} facilityId={s.facilityId}
        title={`How do you usually get to work, ${s.firstName}?`} intro="Think of a normal week. Rough numbers are fine. Your answers are only reported as averages."
        onSubmit={async (fac, a) => { const r = await api.surveyAnswer(code, fac, a); setDone(r.kg); }} />
    </div>);
  return (
    <div className="loginwrap">
      <div className="loginbox card">
        <div><div className="eyebrow">Survey</div><h1 style={{ fontSize: 24, margin: '4px 0 0' }}>Two minutes on how you get to work</h1>
          <p className="sub" style={{ margin: '6px 0 0' }}>Your answers help your company measure and reduce the carbon footprint of commuting. Results are only reported as averages.</p></div>
        <form style={{ display: 'grid', gap: 10 }} onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
          <label className="field"><span>Code from your invitation</span>
            <input className="input mono" style={{ fontSize: 18, letterSpacing: '.1em', textTransform: 'uppercase' }} autoComplete="off" placeholder="e.g. K7Q2M9PA" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {err && <div className="note bad" style={{ margin: 0 }}>{err}</div>}
          <button className="btn p" style={{ height: 44 }} disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
          <a href="/" className="sub" style={{ textAlign: 'center' }}>Back to sign in</a>
        </form>
      </div>
    </div>);
}
