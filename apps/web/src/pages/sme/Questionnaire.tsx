/** Questionnaire: paste a buyer's or bank's questions, one per line; answers come from the company's stored data, gaps are flagged. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { useSme } from './store';
import { Pill, Sample, SmeHead, copyText } from './ui';
import { smeApi } from '../../lib/sme';
import './share.css';

interface Ans { question: string; answer: string; filled: boolean }

const EXAMPLE = [
  'Total Scope 1 emissions (tCO2e)',
  'Total Scope 2 emissions (tCO2e)',
  'Do you track Scope 3 emissions?',
  'Share of renewable electricity',
  'Total water withdrawal',
  'Waste generated and recycled',
  'Percentage of women in the workforce',
  'Lost-time injuries in the year',
  'Do you have an anti-bribery policy?',
  'Is your site ISO 14001 certified?',
  'Do you have a grievance mechanism for workers?',
  'Have you set an emission reduction target?',
  'Do you publish a sustainability report?',
].join('\n');

const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 200);

export function SmeQuestionnaire() {
  const { d, fy, get, set, error } = useSme();
  const { toast } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Ans[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0), timer = useRef<number | undefined>(undefined),outRef = useRef<HTMLDivElement>(null);

  // the last pasted questions are kept with the company's data
  const stored: string = get('questionnaire.text') ?? '';
  useEffect(() => { if (d && text === null) setText(stored); }, [d, stored, text]);

  const fetchAnswers = async (t: string) => {
    const qs = lines(t), my = ++seq.current;
    if (!qs.length) { setAnswers([]); setErr(''); setBusy(false); return; }
    setBusy(true);
    try {
      const r = await smeApi.answer(fy, qs);
      if (my === seq.current) { setAnswers(r.answers); setErr(''); }
    } catch (e) { if (my === seq.current) setErr((e as Error).message); }
    finally { if (my === seq.current) setBusy(false); }
  };
  useEffect(() => {
    if (text === null) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => fetchAnswers(text), 450);
    return () => window.clearTimeout(timer.current);
  }, [text, fy]);// eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="card empty">{error}</div>;
  if (!d || text === null) return <div className="card empty">Loading…</div>;

  const edit = (v: string) => { setText(v); if (d.canEdit) set('questionnaire.text', v); };
  const filled = answers.filter((a) => a.filled).length, gaps = answers.length - filled;
  const all = answers.map((a) => `${a.question}\n${a.filled ? a.answer : '[To answer]'}`).join('\n\n');
  const copy = async () => { const ok = await copyText(all, outRef.current); toast(ok ? `${answers.length} answers copied` : 'Answers selected. Press Ctrl+C to copy.'); };
  const copyOne = async (a: Ans) => { if (await copyText(a.answer)) toast('Answer copied'); };
  const nq = lines(text).length;

  return (
    <>
      <SmeHead lede="Paste the questions a buyer, bank or rating agency sent you. Each one is answered from the data you have already entered for this year, and anything we cannot answer is flagged for you." />
      <div className="sme-grid2">
        <div className="card">
          <div className="row"><h2 className="grow">Questions</h2>
            {!text.trim() && <button className="btn sm" type="button" onClick={() => edit(EXAMPLE)}>Try sample questions</button>}
            {!!text.trim() && <button className="btn sm ghost" type="button" onClick={() => edit('')}>Clear</button>}
          </div>
          <label htmlFor="smq-text" className="muted" style={{ display: 'block', fontSize: 13, margin: '6px 0 8px' }}>One question per line. Paste straight from an e-mail, Excel or a PDF.</label>
          <textarea id="smq-text" className="input smq-text" value={text} onChange={(e) => edit(e.target.value)} spellCheck={false}
            placeholder={'For example:\nTotal Scope 1 emissions (tCO2e)\nDo you have an anti-bribery policy?\nPercentage of women in the workforce'} />
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {nq ? `${nq} question${nq === 1 ? '' : 's'}` : 'No questions yet'}{nq >= 200 ? ' (the first 200 are answered)' : ''}
            {d.canEdit ? ' · Kept for next time.' : ' · You can view answers; only editors can keep questions.'}
          </p>
        </div>

        <div className="card">
          <div className="row"><h2 className="grow">Answers{d.company.isExample && <Sample />}</h2>
            <button className="btn sm p" type="button" disabled={!answers.length} onClick={copy}><Icon name="paste" />Copy all</button></div>
          {err && <div className="note bad" role="alert" style={{ marginTop: 10 }}>{err}</div>}
          {answers.length > 0 && <>
            <div className="smq-meter" aria-hidden="true"><b style={{ width: `${(filled / answers.length) * 100}%` }} /><i style={{ width: `${(gaps / answers.length) * 100}%` }} /></div>
            <p className="muted small" style={{ margin: 0 }} aria-live="polite"><b style={{ color: 'var(--ok)' }}>{filled} answered</b> from your data · <b style={{ color: 'var(--warn)' }}>{gaps} need{gaps === 1 ? 's' : ''} you</b>{busy ? ' · updating…' : ''}</p>
          </>}
          <div className="smq-ans" style={{ marginTop: 6 }} ref={outRef}>
            {answers.map((a, i) => (
              <div key={i} className={`smq-a ${a.filled ? 'ok' : 'gap'}`}>
                <span className="qn">{i + 1}</span>
                <h3>{a.question}</h3>
                <Pill kind={a.filled ? 'good' : 'soon'}>{a.filled ? 'Answered' : 'Needs you'}</Pill>
                <p>{a.filled ? a.answer : 'We have no stored data for this. Answer it yourself before you send the questionnaire.'}</p>
                {a.filled && <button className="btn sm ghost go" type="button" onClick={() => copyOne(a)} aria-label={`Copy answer ${i + 1}`}>Copy</button>}
              </div>))}
            {!answers.length && !err && <div className="empty" style={{ padding: '36px 12px' }}>{busy ? 'Answering…' : 'Paste questions on the left and the answers appear here.'}</div>}
          </div>
        </div>
      </div>
      <div className="sme-callout">Answers use the figures for <b>{fy}</b>. If a figure looks wrong, correct it at the source: <Link to="/sme/emissions">Emissions</Link>, <Link to="/sme/esg">ESG</Link>, <Link to="/sme/people">People & safety</Link> or <Link to="/sme/certs">Certifications</Link>, and the answers update.</div>
    </>);
}
