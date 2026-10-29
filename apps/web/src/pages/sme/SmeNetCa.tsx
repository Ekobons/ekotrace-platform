/** SME network, CA firm: SRMM validation requests assigned by the Ekobon team; review one and record the result. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { LEVELS, dmy, f0, f1, n, smeNetApi } from '../../lib/sme';
import { Kpi, Kpis, Pill } from './ui';
import { NetHead, errText, useLoad } from './netShared';

const STATUS: Record<string, [string, string]> = {
  requested: ['watch', 'Waiting for a CA firm'], assigned: ['soon', 'New'], in_review: ['soon', 'In review'], validated: ['good', 'Validated'], rejected: ['apply', 'Returned'],
};
export const CaStatus = ({ s }: { s: string }) => { const [k, l] = STATUS[s] ?? ['watch', s]; return <Pill kind={k}>{l}</Pill>; };

/** ICAI SRMM bands (same as the engine): every section ≥30%, then >30 / >50 / >65 / >80 %. */
const levelFor = (pct: number, all30: boolean) => (!all30 ? 0 : pct > 80 ? 4 : pct > 65 ? 3 : pct > 50 ? 2 : pct > 30 ? 1 : 0);

export function CaFirm({ o, eyebrow, reload }: { o: Record<string, any>; eyebrow: ReactNode; reload: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const R = (o.requests ?? []) as any[];
  if (open) return <CaReview id={open} onBack={() => { setOpen(null); reload(); }} />;
  const todo = R.filter((r) => r.status === 'assigned' || r.status === 'in_review').length;
  return (
    <>
      <NetHead icon="shield" eyebrow={eyebrow} title="SRMM validation requests" lede="Companies that asked for their ICAI SRMM self-assessment to be validated, assigned to your firm by the Ekobon team. Open one to see the answers and record your result." />
      <Kpis>
        <Kpi label="To review" value={f0(todo)} unit="new or in review" />
        <Kpi label="Validated" value={f0(R.filter((r) => r.status === 'validated').length)} unit="requests" good />
        <Kpi label="Returned" value={f0(R.filter((r) => r.status === 'rejected').length)} unit="sent back with notes" />
      </Kpis>
      <div className="card">
        <h2>Requests</h2>
        {!R.length ? <div className="empty">No requests assigned to your firm yet. The Ekobon team assigns them; you will see them here.</div> : (
          <div className="sme-scroll" style={{ marginTop: 8 }}>
            <table className="sme-tbl"><thead><tr><th>Company</th><th>Year</th><th>Model</th><th className="r">Self-assessed</th><th>Status</th><th className="r">Validated</th><th>Updated</th><th /></tr></thead>
              <tbody>{R.map((r) => (
                <tr key={r.id}>
                  <td className="net-name"><b>{r.company}</b><small>{[r.sector === 'svc' ? 'Services' : 'Manufacturing', r.state].filter(Boolean).join(' · ')}</small></td>
                  <td>{r.fy}</td>
                  <td>{r.srmm_version === 'svc' ? 'v3.2 Services' : 'v3.1 Manufacturing'}</td>
                  <td className="r">{r.self_pct == null ? '—' : `${f1(r.self_pct)}%`}</td>
                  <td><CaStatus s={r.status} /></td>
                  <td className="r">{r.validated_pct == null ? '—' : `${f1(r.validated_pct)}% · L${r.validated_level ?? 0}`}</td>
                  <td>{dmy(r.updated_at)}</td>
                  <td className="r"><button className="btn sm p" onClick={() => setOpen(r.id)}>Open</button></td>
                </tr>))}</tbody></table>
          </div>)}
      </div>
    </>);
}

function CaReview({ id, onBack }: { id: string; onBack: () => void }) {
  const { can, toast } = useApp();
  const { data, error, reload } = useLoad(() => smeNetApi.caRequest(id), [id]);
  const [pct, setPct] = useState('');
  const [all30, setAll30] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'suggest'>('all');
  if (error) return <><button className="btn ghost net-back" onClick={onBack}><Icon name="chevron" />All requests</button><div className="card empty">{error}</div></>;
  if (!data) return <div className="card empty">Loading the company’s answers…</div>;
  const q = data.request, sr = data.results.srmm, ver: 'mfg' | 'svc' = sr.version === 'svc' ? 'svc' : 'mfg';
  const bank = data.config.srmm[ver] as { label: string; items: { id: string; s: string; cat: string; q: string; c: string; max: number; o: [number, string][] | null; parts?: [string, string][] }[] };
  const sm = (data.data.srmm ?? {}) as { scores?: Record<string, unknown>; multi?: Record<string, unknown>; remarks?: Record<string, string> };
  const key = (qid: string) => `${ver}_${qid}`;
  const score = (it: (typeof bank.items)[number]): number | null => {
    if (it.parts) { const v = it.parts.map(([k]) => sm.multi?.[`${key(it.id)}_${k}`]); return v.every((x) => x === '' || x == null) ? null : v.reduce<number>((a, x) => a + n(x), 0); }
    const v = sm.scores?.[key(it.id)]; return v === '' || v == null ? null : n(v);
  };
  const sugg = new Map((sr.suggestions as { id: string; score: number; reason: string }[]).map((s) => [s.id, s]));
  const closed = q.status === 'validated' || q.status === 'rejected';
  const edit = can('super_admin', 'admin', 'manager') && !closed;
  const selfPct = n(sr.pct) * 100;
  const all = all30 ?? !!sr.eligible;
  const vp = pct === '' ? null : Number(pct);
  const preview = vp == null || Number.isNaN(vp) ? null : levelFor(vp, all);
  const act = async (status: 'in_review' | 'validated' | 'rejected') => {
    setErr(null);
    if (status === 'validated' && (vp == null || Number.isNaN(vp) || vp < 0 || vp > 100)) { setErr('Enter the validated score as a % between 0 and 100.'); return; }
    if (status === 'rejected' && !notes.trim()) { setErr('Add a note so the company knows what to fix.'); return; }
    setBusy(true);
    try {
      const r = await smeNetApi.caReview(id, { status, validatedPct: status === 'validated' ? vp! : undefined, allSections30: all, notes: notes.trim() || undefined });
      toast(status === 'validated' ? `Validated at Level ${r.validatedLevel ?? 0}` : status === 'rejected' ? 'Returned to the company' : 'Marked in review');
      reload();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const items = bank.items.filter((it) => filter === 'all' || (filter === 'open' ? score(it) === null : sugg.has(it.id)));
  return (
    <>
      <button className="btn ghost net-back" onClick={onBack}><span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" /></span>All requests</button>
      <NetHead icon="shield" eyebrow={<>SRMM validation · {q.fy} · requested {dmy(q.created_at)}</>} title={data.company.name}
        lede={`${[data.company.industry, data.company.state].filter(Boolean).join(' · ')} · ${bank.label}`}><CaStatus s={q.status} /></NetHead>
      <Kpis>
        <Kpi label="Self-assessed score" value={`${f1(selfPct)}%`} unit={`${f0(sr.got)} of ${f0(sr.max)} points`} />
        <Kpi label="Self-assessed level" value={sr.level ? `Level ${sr.level}` : 'Not rated'} unit={sr.level ? LEVELS[sr.level] : 'below the Level 1 bar'} />
        <Kpi label="Indicators answered" value={`${f0(n(sr.indicators) - n(sr.open))} of ${f0(sr.indicators)}`} unit={sr.open ? `${sr.open} still blank` : 'all answered'} good={!sr.open} />
        <Kpi label="Evidence differs" value={f0(sugg.size)} unit="where the company’s own data suggests another score" />
      </Kpis>
      <div className="net-split">
        <div className="net-sec">
          <div className="card"><h2>Score by section</h2>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              {(['A', 'B', 'C'] as const).map((s) => { const x = sr.sections[s]; return (
                <div key={s} className="sme-secbar net-secbar"><span>Section {s}</span><div className="sme-track"><b style={{ width: `${n(x.pct) * 100}%` }} /><em /></div>
                  <span className="num" style={{ textAlign: 'right' }}>{f0(x.got)}/{f0(x.max)} · {f0(n(x.pct) * 100)}%</span></div>); })}
            </div>
            <p className="muted small" style={{ margin: '10px 0 0' }}>Each section needs at least 30% (the marker) before any level is awarded. Levels: 1 above 30%, 2 above 50%, 3 above 65%, 4 above 80%.</p>
          </div>
          <div className="card">
            <div className="row"><h2 className="grow" style={{ minWidth: 140 }}>Answers</h2>
              <div className="seg">{([['all', 'All'], ['open', `Blank (${sr.open})`], ['suggest', `Evidence differs (${sugg.size})`]] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div></div>
            {!items.length && <p className="muted">Nothing in this view.</p>}
            {items.map((it, i) => {
              const sc = score(it), sg = sugg.get(it.id), rm = sm.remarks?.[key(it.id)], prev = items[i - 1];
              return (
                <Fragment key={it.id}>
                  {(!prev || prev.cat !== it.cat) && <div className="net-cat">{prev?.s !== it.s ? `Section ${it.s} — ` : ''}{it.cat}</div>}
                  <div className="net-q">
                    <span className="id">{it.id}</span>
                    <span className="qt">{it.q}</span>
                    <span className={`sc${sc === null ? ' open' : ''}`}>{sc === null ? 'Blank' : `${f0(sc)} / ${it.max}`}</span>
                    <div className="ex">
                      {it.parts && sc !== null && <div>{it.parts.map(([k, l]) => `${l}: ${sm.multi?.[`${key(it.id)}_${k}`] ?? '—'}`).join(' · ')}</div>}
                      {rm && <div><b>Company’s basis:</b> {rm}</div>}
                      {sg && <div style={{ color: 'var(--warn)' }}><b style={{ color: 'inherit' }}>Their data suggests {sg.score}:</b> {sg.reason}</div>}
                      <details><summary>Scoring rule</summary>{it.c}</details>
                    </div>
                  </div>
                </Fragment>);
            })}
          </div>
        </div>

        <div className="card net-review net-sec">
          <h2>Your review</h2>
          {closed ? (
            <>
              {q.status === 'validated'
                ? <div className="note" style={{ background: 'var(--primary-soft)' }}>Validated at <b>{f1(q.validated_pct)}%</b> · <b>{q.validated_level ? `Level ${q.validated_level} · ${LEVELS[q.validated_level]}` : 'Not rated'}</b></div>
                : <div className="note bad">Returned to the company.</div>}
              {q.notes && <div><span className="lbl">Notes</span><p style={{ margin: '4px 0 0', fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{q.notes}</p></div>}
              <p className="muted small" style={{ margin: 0 }}>{q.reviewer_name ? `By ${q.reviewer_name} · ` : ''}{dmy(q.updated_at)}. This request is closed.</p>
            </>
          ) : !edit ? (
            <p className="muted">Only managers and admins of your firm can record a result.</p>
          ) : (
            <>
              {q.status === 'assigned' && <div className="row"><span className="muted small grow">Let the company know you have started.</span><button className="btn sm" disabled={busy} onClick={() => act('in_review')}>Mark in review</button></div>}
              <label className="field"><span>Validated score (%)</span>
                <input className="input num" type="number" min={0} max={100} step="0.1" inputMode="decimal" value={pct} placeholder={f1(selfPct)} onChange={(e) => setPct(e.target.value)} /></label>
              <label className="net-check"><input type="checkbox" checked={all} onChange={(e) => setAll30(e.target.checked)} /><span>Every section (A, B and C) scores at least 30% after your review</span></label>
              <div className="sme-callout">{preview === null ? 'Enter a score to see the level it gives.' : <>This gives <b>{preview ? `Level ${preview} · ${LEVELS[preview]}` : 'no level (Not rated)'}</b>{!all && ' because a section is below 30%'}.</>}</div>
              <label className="field"><span>Notes to the company</span><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you checked, and anything to fix" /></label>
              <div className="row">
                <button className="btn p grow" disabled={busy} onClick={() => act('validated')}><Icon name="check" />Validate</button>
                <button className="btn danger" disabled={busy} onClick={() => act('rejected')}>Return</button>
              </div>
              {err && <div className="note bad">{err}</div>}
              <p className="muted small" style={{ margin: 0 }}>Returning needs a note. Once validated or returned, the request closes.</p>
            </>)}
        </div>
      </div>
    </>);
}
