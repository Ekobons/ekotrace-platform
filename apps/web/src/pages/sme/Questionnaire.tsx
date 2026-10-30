/** Questionnaire: paste a buyer's or bank's questions, one per line; answers come from the company's stored data, gaps are flagged. */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { useSme } from './store';
import { Pill, Sample, SmeHead, copyText } from './ui';
import { smeApi } from '../../lib/sme';
import './share.css';
import { t, tn } from './i18n';

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
  if (!d || text === null) return <div className="card empty">{t('Loading…')}</div>;

  const edit = (v: string) => { setText(v); if (d.canEdit) set('questionnaire.text', v); };
  const filled = answers.filter((a) => a.filled).length, gaps = answers.length - filled;
  const all = answers.map((a) => `${a.question}\n${a.filled ? a.answer : t('[To answer]')}`).join('\n\n');
  const copy = async () => { const ok = await copyText(all, outRef.current); toast(ok ? `${answers.length} answers copied` : t('Answers selected. Press Ctrl+C to copy.')); };
  const copyOne = async (a: Ans) => { if (await copyText(a.answer)) toast(t('Answer copied')); };
  const nq = lines(text).length;

  return (
    <>
      <SmeHead lede={t('Paste the questions a buyer, bank or rating agency sent you. Each one is answered from the data you have already entered for this year, and anything we cannot answer is flagged for you.')} />
      <div className="sme-grid2">
        <div className="card">
          <div className="row"><h2 className="grow">{t('Questions')}</h2>
            {!text.trim() && <button className="btn sm" type="button" onClick={() => edit(EXAMPLE)}>{t('Try sample questions')}</button>}
            {!!text.trim() && <button className="btn sm ghost" type="button" onClick={() => edit('')}>{t('Clear')}</button>}
          </div>
          <label htmlFor="smq-text" className="muted" style={{ display: 'block', fontSize: 13, margin: '6px 0 8px' }}>{t('One question per line. Paste straight from an e-mail, Excel or a PDF.')}</label>
          <textarea id="smq-text" className="input smq-text" value={text} onChange={(e) => edit(e.target.value)} spellCheck={false}
            placeholder={'For example:\nTotal Scope 1 emissions (tCO2e)\nDo you have an anti-bribery policy?\nPercentage of women in the workforce'} />
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {nq ? t(nq === 1 ? '{n} question' : '{n} questions', { n: nq }) : t('No questions yet')}{nq >= 200 ? ` ${t('(the first 200 are answered)')}` : ''}
            {` · ${t(d.canEdit ? 'Kept for next time.' : 'You can view answers; only editors can keep questions.')}`}
          </p>
        </div>

        <div className="card">
          <div className="row"><h2 className="grow">{t('Answers')}{d.company.isExample && <Sample />}</h2>
            <button className="btn sm p" type="button" disabled={!answers.length} onClick={copy}><Icon name="paste" />{t('Copy all')}</button></div>
          {err && <div className="note bad" role="alert" style={{ marginTop: 10 }}>{err}</div>}
          {answers.length > 0 && <>
            <div className="smq-meter" aria-hidden="true"><b style={{ width: `${(filled / answers.length) * 100}%` }} /><i style={{ width: `${(gaps / answers.length) * 100}%` }} /></div>
            <p className="muted small" style={{ margin: 0 }} aria-live="polite">{tn('{a} from your data · {b}', { a: <b style={{ color: 'var(--ok)' }}>{t('{n} answered', { n: filled })}</b>, b: <b style={{ color: 'var(--warn)' }}>{t(gaps === 1 ? '{n} needs you' : '{n} need you', { n: gaps })}</b> })}{busy ? ` · ${t('updating…')}` : ''}</p>
          </>}
          <div className="smq-ans" style={{ marginTop: 6 }} ref={outRef}>
            {answers.map((a, i) => (
              <div key={i} className={`smq-a ${a.filled ? 'ok' : 'gap'}`}>
                <span className="qn">{i + 1}</span>
                <h3>{a.question}</h3>
                <Pill kind={a.filled ? 'good' : 'soon'}>{a.filled ? t('Answered') : t('Needs you')}</Pill>
                <p>{a.filled ? a.answer : t('We have no stored data for this. Answer it yourself before you send the questionnaire.')}</p>
                {a.filled && <button className="btn sm ghost go" type="button" onClick={() => copyOne(a)} aria-label={`Copy answer ${i + 1}`}>{t('Copy')}</button>}
              </div>))}
            {!answers.length && !err && <div className="empty" style={{ padding: '36px 12px' }}>{busy ? t('Answering…') : t('Paste questions on the left and the answers appear here.')}</div>}
          </div>
        </div>
      </div>
      <div className="sme-callout">{tn('Answers use the figures for {fy}. If a figure looks wrong, correct it at the source: {a}, {b}, {c} or {d}, and the answers update.', { fy: <b>{fy}</b>, a: <Link to="/sme/emissions">{t('Emissions')}</Link>, b: <Link to="/sme/esg">ESG</Link>, c: <Link to="/sme/people">{t('People & safety')}</Link>, d: <Link to="/sme/certs">{t('Certifications')}</Link> })}</div>
    </>);
}
