/**
 * SRMM: ICAI's Sustainability Reporting Maturity Model self-evaluation (v3.1 manufacturing, v3.2 services).
 * Every indicator with its scoring options; scores already backed by the company's own data are
 * suggested. Section totals, the 30% per-section rule and the level come from the server.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../App';
import { useSme } from './store';
import { Choice, Kpi, Kpis, Pill, Sample, SmeHead, copyText } from './ui';
import { f0, f1, LEVELS } from '../../lib/sme';
import './carbon.css';

type SecKey = 'A' | 'B' | 'C';
interface Item { id: string; s: SecKey; cat: string; q: string; c: string; note: string; max: number; o: [number, string][] | null; parts?: [string, string][] }
interface Sug { id: string; score: number; reason: string }
interface SecRes { max: number; min: number; got: number; pct: number; open: number; eligible: boolean }
interface SrmmRes { version: 'mfg' | 'svc'; versionLabel: string; sections: Record<SecKey, SecRes>; max: number; got: number; pct: number; open: number; indicators: number; eligible: boolean; level: number; label: string; suggestions: Sug[] }

const SECS: SecKey[] = ['A', 'B', 'C'];
const SEC_SHORT: Record<SecKey, string> = { A: 'General disclosures & management', B: 'Reporting & performance', C: 'Leadership & strategy' };
const SEC_LONG: Record<SecKey, string> = { A: 'General Disclosures and Management Procedures', B: 'Sustainability Reporting and Performance Assessment', C: 'Sustainability Leadership and Strategic Initiatives' };
const PART_OPTS: [number, string][] = [[2, 'Over 75% covered'], [1, '50–75% covered'], [0, 'Under 50% or none']];
/** The level bands of ICAI's summary sheet: width of each band and its colour. */
const BANDS: { from: number; to: number; label: string; color: string }[] = [
  { from: 0, to: 30, label: 'Not rated', color: '#DDE5E0' },
  { from: 30, to: 50, label: 'Formative', color: '#BFE3D4' },
  { from: 50, to: 65, label: 'Developing', color: '#7FC7AE' },
  { from: 65, to: 80, label: 'Emerging', color: '#2FA283' },
  { from: 80, to: 100, label: 'Established', color: '#0E7C66' },
];
const blank = (v: unknown) => v === '' || v === null || v === undefined;

function Band({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="cb-band" role="img" aria-label={`Overall ${f1(pct)}%`}>
      <div className="cb-band-m" style={{ left: `${p}%` }}><b>{f1(pct)}%</b><i /></div>
      <div className="cb-band-bar">{BANDS.map((b) => <div key={b.label} style={{ width: `${b.to - b.from}%`, background: b.color }} />)}</div>
      <div className="cb-band-l">{BANDS.map((b) => <span key={b.label} style={{ width: `${b.to - b.from}%` }}><em>{b.label}</em><i>{b.from ? `L${BANDS.indexOf(b)}` : '—'}</i><br />{b.from ? `>${b.from}%` : '0–30%'}</span>)}</div>
    </div>);
}

export function SmeSrmm() {
  const { d, fy, get, set, setModule, error } = useSme();
  const { toast } = useApp();
  const [sec, setSec] = useState<SecKey | 'all'>('A');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlySug, setOnlySug] = useState(false);
  const reportRef = useRef<HTMLPreElement>(null);

  const sm = (d?.data.srmm ?? {}) as { version?: string; scores?: Record<string, unknown>; multi?: Record<string, unknown>; remarks?: Record<string, string> };
  const r = d?.results.srmm as SrmmRes | undefined;
  const sector = d?.company.sector === 'svc' ? 'svc' : 'mfg';
  const ver: 'mfg' | 'svc' = sm.version === 'mfg' || sm.version === 'svc' ? sm.version : (r?.version ?? sector);
  const bank = (d?.config.srmm?.[ver] ?? { items: [], label: '', short: '' }) as { items: Item[]; label: string; short?: string };
  const items = bank.items;
  const key = (id: string) => `${ver}_${id}`;

  const score = useMemo(() => {
    const sc = sm.scores ?? {}, mu = sm.multi ?? {}, out: Record<string, number | null> = {};
    for (const q of items) {
      const k = `${ver}_${q.id}`;
      if (q.parts) {
        const vals = q.parts.map(([p]) => mu[`${k}_${p}`]);
        out[q.id] = vals.every(blank) ? null : vals.reduce<number>((a, x) => a + (Number(x) || 0), 0);
      } else out[q.id] = blank(sc[k]) ? null : Number(sc[k]) || 0;
    }
    return out;
  }, [sm.scores, sm.multi, items, ver]);

  if (error) return <div className="card empty">{error}</div>;
  if (!d || !r) return <div className="card empty">Loading your data…</div>;

  const sugs: Sug[] = r.version === ver ? r.suggestions ?? [] : [];
  const sugMap = Object.fromEntries(sugs.map((s) => [s.id, s])) as Record<string, Sug>;
  const secMax = { A: 0, B: 0, C: 0 } as Record<SecKey, number>, secN = { A: 0, B: 0, C: 0 } as Record<SecKey, number>, secOpen = { A: 0, B: 0, C: 0 } as Record<SecKey, number>;
  for (const q of items) { secMax[q.s] += q.max; secN[q.s]++; if (score[q.id] === null) secOpen[q.s]++; }
  const total = items.reduce((a, q) => a + q.max, 0);
  const scored = items.filter((q) => score[q.id] !== null).length;
  const shown = items.filter((q) => (sec === 'all' || q.s === sec) && (!onlyOpen || score[q.id] === null) && (!onlySug || !!sugMap[q.id]));
  const newSugs = sugs.filter((s) => score[s.id] === null && !items.find((q) => q.id === s.id)?.parts);
  const can = d.canEdit;

  const raw = (id: string) => { const v = (sm.scores ?? {})[key(id)]; return blank(v) ? '' : String(v); };
  const part = (id: string, p: string) => { const v = (sm.multi ?? {})[`${key(id)}_${p}`]; return blank(v) ? '' : String(v); };
  const remark = (id: string) => (sm.remarks ?? {})[key(id)] ?? '';
  const next = () => ({ ...sm, scores: { ...(sm.scores ?? {}) }, multi: { ...(sm.multi ?? {}) }, remarks: { ...(sm.remarks ?? {}) } });
  const acceptSug = (s: Sug) => {
    const n = next(), k = key(s.id);
    n.scores[k] = s.score;
    if (!n.remarks[k]) n.remarks[k] = s.reason;
    setModule('srmm', n);
  };
  const applyAll = () => {
    const n = next();
    for (const s of newSugs) { const k = key(s.id); n.scores[k] = s.score; if (!n.remarks[k]) n.remarks[k] = s.reason; }
    if (newSugs.length) setModule('srmm', n);
    toast(newSugs.length ? `${newSugs.length} score${newSugs.length === 1 ? '' : 's'} filled from your data. Check each one.` : 'No new suggestions.');
  };

  const report = () => {
    const secs = SECS.map((k) => { const x = r.sections[k]; return `Section ${k} — ${SEC_LONG[k]}: ${f0(x.got)} / ${x.max} (${f1(x.pct * 100)}%) · minimum ${f0(x.min)} · ${x.eligible ? 'Eligible' : 'Not eligible'}${x.open ? ` · ${x.open} not scored` : ''}`; }).join('\n');
    const rows = items.map((q) => { const v = score[q.id], rm = remark(q.id); return `${q.id}  ${v === null ? '–' : v}/${q.max}${rm ? `  — ${rm}` : ''}`; }).join('\n');
    return `SRMM ${String(bank.label).toUpperCase()} (SELF-EVALUATION)\n${d.company.name} · ${fy}\n\n${secs}\n\nGrand total: ${f0(r.got)} / ${r.max} (${f1(r.pct * 100)}%)\nLevel achieved: ${r.label}\n${r.eligible ? 'Eligible — minimum 30% achieved in every section' : 'Not eligible — minimum 30% not achieved in one or more sections'}\n\nScores\n${rows}\n\nSelf-assessed with EKOTRACE SME using ICAI's SRMM ${bank.short ?? ''} utility. Validation by a Chartered Accountant provides limited assurance. SRMM® is a registered trademark of ICAI.`;
  };
  const copy = async () => {
    const t = report();
    if (reportRef.current) reportRef.current.textContent = t;
    toast((await copyText(t, reportRef.current)) ? 'Report copied.' : 'Copy is blocked here. The report is selected: press Ctrl+C.');
  };

  return (
    <div className="cb-stack">
      <SmeHead lede={`ICAI Sustainability Reporting Maturity Model, ${bank.label}. ${items.length} indicators, ${total} points. Scores your EKOTRACE data already supports are suggested for you to accept.`}>
        <button type="button" className="btn" onClick={copy}>Copy report</button>
        <Link className="btn p" to="/sme/share">Request CA validation</Link>
      </SmeHead>

      <Kpis>
        <Kpi label="Overall" value={<>{f1(r.pct * 100)}%{d.company.isExample && <Sample />}</>} unit={`${f0(r.got)} of ${r.max} points`} good={r.eligible && r.level > 0} />
        <Kpi label="Level" value={r.level ? `Level ${r.level}` : 'Not rated'} unit={r.level ? LEVELS[r.level] : r.eligible ? 'Needs more than 30% overall' : 'A section is below 30%'} good={r.level > 0} />
        <Kpi label="Scored" value={`${scored} of ${items.length}`} unit={r.open ? `${r.open} still to score` : 'All indicators scored'} />
        <Kpi label="Suggestions" value={sugs.length} unit={newSugs.length ? `${newSugs.length} for indicators not yet scored` : 'from your data'} />
      </Kpis>

      <div className="sme-grid2">
        <div className="card">
          <div className="cb-h"><h2>Where you stand</h2><Pill kind={r.level ? 'good' : 'soon'}>{r.label}</Pill></div>
          <Band pct={r.pct * 100} />
          {r.eligible
            ? <p className="cb-muted-note">Every section has at least 30% of its points, so the overall score sets the level.</p>
            : <div className="sme-callout warn" style={{ marginTop: 10 }}>No level can be given yet: {SECS.filter((k) => !r.sections[k].eligible).map((k) => `Section ${k}`).join(', ')} {SECS.filter((k) => !r.sections[k].eligible).length === 1 ? 'is' : 'are'} below 30% of {SECS.filter((k) => !r.sections[k].eligible).length === 1 ? 'its' : 'their'} points. ICAI needs at least 30% in every section.</div>}
          <div style={{ marginTop: 10 }} />
          <Choice path="srmm.version" label="SRMM version" hint="Scores are kept separately for each version" options={[['auto', `Automatic (${sector === 'svc' ? 'services' : 'manufacturing'}, from your profile)`], ['mfg', 'Version 3.1 · Manufacturing'], ['svc', 'Version 3.2 · Services']]} />
        </div>
        <div className="card">
          <h2>By section</h2>
          <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Section</th><th className="r">Points</th><th className="r cb-hm">Min 30%</th><th className="r">%</th><th>Rated?</th></tr></thead>
            <tbody>
              {SECS.map((k) => { const x = r.sections[k]; return (
                <tr key={k}><td><b>{k}</b> · {SEC_SHORT[k]}<div className="cb-prog" title={`${secN[k] - secOpen[k]} of ${secN[k]} scored`}><b style={{ width: `${secN[k] ? ((secN[k] - secOpen[k]) / secN[k]) * 100 : 0}%` }} /></div><span className="muted" style={{ fontSize: 11.5 }}>{secN[k] - secOpen[k]} of {secN[k]} scored</span></td>
                  <td className="r">{f0(x.got)} / {x.max}</td><td className="r cb-hm">{f0(x.min)}</td><td className="r">{f1(x.pct * 100)}%</td>
                  <td><Pill kind={x.eligible ? 'good' : 'apply'}>{x.eligible ? 'Yes' : 'Below 30%'}</Pill></td></tr>); })}
              <tr className="tot"><td>Total</td><td className="r">{f0(r.got)} / {r.max}</td><td className="r cb-hm">{f0(r.max * 0.3)}</td><td className="r">{f1(r.pct * 100)}%</td><td><Pill kind={r.eligible ? 'good' : 'apply'}>{r.eligible ? 'Yes' : 'No'}</Pill></td></tr>
            </tbody></table></div>
        </div>
      </div>

      <div className="card">
        <div className="cb-tools">
          <div className="seg" role="group" aria-label="Section">
            {SECS.map((k) => <button key={k} type="button" className={sec === k ? 'on' : ''} aria-pressed={sec === k} onClick={() => setSec(k)}>Section {k}{secOpen[k] ? ` · ${secOpen[k]} open` : ' ✓'}</button>)}
            <button type="button" className={sec === 'all' ? 'on' : ''} aria-pressed={sec === 'all'} onClick={() => setSec('all')}>All</button>
          </div>
          <div className="row">
            <label className="cb-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Not scored only</label>
            <label className="cb-check"><input type="checkbox" checked={onlySug} onChange={(e) => setOnlySug(e.target.checked)} />With a suggestion</label>
            {can && <button type="button" className="btn sm" disabled={!newSugs.length} onClick={applyAll}>Accept {newSugs.length || ''} suggestion{newSugs.length === 1 ? '' : 's'}</button>}
          </div>
        </div>
        {sec !== 'all' && <p className="cb-sub" style={{ marginTop: 10 }}>Section {sec}: {SEC_LONG[sec]} · {secMax[sec]} points · at least {f0(secMax[sec] * 0.3)} needed</p>}
      </div>

      <div className="card">
        {shown.map((q) => {
          const v = score[q.id], sg = sugMap[q.id], name = `sr_${key(q.id)}`;
          return (
            <div className="srq" key={key(q.id)}>
              <div className="srq-h">
                <span className="srq-id">{q.id}</span><span className="srq-cat">{q.cat}</span>
                <Pill kind={v === null ? 'watch' : v === q.max ? 'good' : 'soon'}>{v === null ? `Not scored · max ${q.max}` : `${v} / ${q.max}`}</Pill>
              </div>
              <p className="srq-q">{q.q}</p>
              {!q.parts && (
                <div className="sro" role="radiogroup" aria-label={`${q.id} score`}>
                  {(q.o ?? []).map(([s, t]) => {
                    const on = raw(q.id) === String(s);
                    return (
                      <label key={s} className={`${on ? 'on' : ''}${can ? '' : ' dis'}`}>
                        <input type="radio" name={name} value={s} checked={on} disabled={!can} onChange={() => set(`srmm.scores.${key(q.id)}`, s)} />
                        <span className="sc">{s}</span><span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                      </label>);
                  })}
                  {can && v !== null && <button type="button" className="btn xs ghost sro-clear" onClick={() => set(`srmm.scores.${key(q.id)}`, '')}>Clear score</button>}
                </div>)}
              {q.parts && (
                <div>
                  {q.parts.map(([p, label]) => (
                    <div className="srp" key={p}>
                      <span>{label}</span>
                      <div className="seg" role="group" aria-label={`${q.id} ${label}`}>
                        {PART_OPTS.map(([s, t]) => <button key={s} type="button" title={t} disabled={!can} className={part(q.id, p) === String(s) ? 'on' : ''} aria-pressed={part(q.id, p) === String(s)} onClick={() => set(`srmm.multi.${key(q.id)}_${p}`, s)}>{s} · {t}</button>)}
                        {can && part(q.id, p) !== '' && <button type="button" onClick={() => set(`srmm.multi.${key(q.id)}_${p}`, '')} aria-label={`Clear ${label}`}>✕</button>}
                      </div>
                    </div>))}
                </div>)}
              {sg && (
                <div className={`srsug${raw(q.id) === String(sg.score) ? ' same' : ''}`}>
                  <span>Suggested from your data: <b>{sg.score}</b>. {sg.reason}{v !== null && v > sg.score ? ' Your score is higher than your data shows, so keep the evidence ready for your CA.' : ''}</span>
                  {can && !q.parts && raw(q.id) !== String(sg.score) && <button type="button" className="btn sm" onClick={() => acceptSug(sg)}>Use {sg.score}</button>}
                </div>)}
              <details><summary>Scoring criteria</summary><p>{q.c}</p>{q.note && <p><b>Note:</b> {q.note}</p>}</details>
              {(can || remark(q.id)) && <input type="text" className="input rm" aria-label={`${q.id} remarks`} placeholder="Basis for this score (for your CA)" disabled={!can} value={remark(q.id)} onChange={(e) => set(`srmm.remarks.${key(q.id)}`, e.target.value)} />}
            </div>);
        })}
        {!shown.length && <p className="muted" style={{ margin: 0 }}>{onlyOpen ? 'Every indicator in this view is scored.' : onlySug ? 'No suggestions in this view. Suggestions come from your Emissions, ESG and Certifications data.' : 'No indicators.'}</p>}
      </div>

      <div className="sme-callout">When you have scored every indicator, <Link to="/sme/share">ask a Chartered Accountant to validate</Link> it. A validated level can be shown on ICAI’s website with your consent.</div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>SRMM® is a registered trademark of the Institute of Chartered Accountants of India. This is a self-evaluation using ICAI’s published utility ({String(get('srmm.version') ?? 'auto') === 'auto' ? 'chosen from your sector' : 'chosen by you'}); the validated score is issued after review by a Chartered Accountant.</p>
      <pre ref={reportRef} aria-hidden="true" style={{ position: 'absolute', left: -9999, top: 0, width: 1, height: 1, overflow: 'hidden' }} />
    </div>);
}
