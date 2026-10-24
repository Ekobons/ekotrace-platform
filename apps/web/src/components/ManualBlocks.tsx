/**
 * Diagrams for the user manual, written as plain text inside the manual's Markdown:
 *
 *   ```flow                     one step per line:  [marker] Title | detail
 *   > Upload | drop PDFs        markers:  >  step (default)   *  a person acts
 *   ! Checks | PDF only                   !  safety check     ?  decision: Title | yes … | no …
 *   ```
 *   ```layers                   one layer per line: Title | what protects it
 *   ```diagram scopes           ready-made pictures: scopes, month-split, entry-life
 *   ```video data-entry-months  a short help video (public/help/<name>.mp4, .jpg poster):
 *   Title | length              the next line: its title and length
 */
import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type Step = { kind: 'step' | 'person' | 'check' | 'decision'; title: string; detail: string; no?: string };

export function parseFlow(src: string): Step[] {
  return src.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^([>*!?])\s*/.exec(l);
    const mark = m?.[1] ?? '>';
    const [title = '', detail = '', no] = l.slice(m ? m[0].length : 0).split('|').map((x) => x.trim());
    return { kind: mark === '*' ? 'person' : mark === '!' ? 'check' : mark === '?' ? 'decision' : 'step', title, detail, ...(no ? { no } : {}) } as Step;
  });
}

const TAG: Record<Step['kind'], ReactNode> = {
  step: null,
  person: <span className="mf-tag person"><Icon name="users" />a person</span>,
  check: <span className="mf-tag check"><Icon name="shield" />safety check</span>,
  decision: <span className="mf-tag decision">decision</span>,
};

/** Split "Yes: …" into a label and the rest. */
const branch = (s: string, fallback: string) => {
  const m = /^([^:]{1,40}):\s*(.*)$/.exec(s);
  return m ? { label: m[1]!, text: m[2]! } : { label: fallback, text: s };
};

export function Flow({ src }: { src: string }) {
  const steps = parseFlow(src);
  return (
    <div className="mflow" role="list">
      {steps.map((s, i) => (
        <div key={i} className={`mf-step ${s.kind}`} role="listitem">
          <div className="mf-dot">{s.kind === 'check' ? <Icon name="shield" /> : s.kind === 'person' ? <Icon name="users" /> : s.kind === 'decision' ? '?' : i + 1}</div>
          <div className="mf-body">
            <div className="mf-title">{s.title}{TAG[s.kind]}</div>
            {s.kind === 'decision' && s.no !== undefined ? (
              <div className="mf-branches">
                {[branch(s.detail, 'Yes'), branch(s.no, 'No')].map((b, k) => (
                  <div key={k} className={`mf-branch ${k === 0 ? 'yes' : 'no'}`}><b>{b.label}</b><span>{b.text}</span></div>
                ))}
              </div>
            ) : s.detail && <div className="mf-detail">{s.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Layers({ src }: { src: string }) {
  const rows = src.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [t = '', d = ''] = l.split('|').map((x) => x.trim()); return { t, d }; });
  return (
    <div className="mlayers">
      {rows.map((r, i) => (
        <div key={i} className="ml-row" style={{ ['--i' as string]: i, ['--n' as string]: rows.length }}>
          <div className="ml-name"><Icon name="lock" />{r.t}</div>
          <div className="ml-detail">{r.d}</div>
        </div>
      ))}
      <div className="ml-core">Company data</div>
    </div>
  );
}

function Scopes() {
  const col = (cls: string, head: string, sub: string, items: string[]) => (
    <div className={`ms-col ${cls}`}>
      <div className="ms-head">{head}</div><div className="ms-sub">{sub}</div>
      <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  return (
    <div className="mscopes">
      {col('s3', 'Scope 3.3 · upstream', 'before it reaches us', ['producing and delivering fuels', 'generating electricity, heat', 'grid losses (T&D)'])}
      <div className="ms-arrow">→</div>
      {col('s2', 'Scope 2 · bought energy', 'location- and market-based', ['electricity', 'heat & steam', 'district cooling'])}
      <div className="ms-arrow">→</div>
      {col('s1', 'Scope 1 · our operations', 'sources we own or control', ['fuel in boilers, generators', 'vehicles and machinery', 'refrigerant leaks', 'our landfills, WtE, compost, wastewater'])}
      <div className="ms-arrow">→</div>
      {col('s3', 'Scope 3.5 · waste sent out', 'treated by other companies', ['landfill', 'combustion', 'recycling, composting, digestion'])}
      <div className="ms-note">Biogenic CO₂ (biomass, biogas, the organic part of waste) is reported separately, outside the scopes.</div>
    </div>
  );
}

/** A bill (or reading) from 15 Feb to 14 Mar split over the two months by days. */
function MonthSplit() {
  const W = 640, x0 = 20, day = (W - 40) / 59; // Feb (28) + Mar (31)
  const feb = 28 * day;
  const bx = x0 + 14 * day, bw = 28 * day;
  return (
    <figure className="msplit">
      <svg viewBox={`0 0 ${W} 170`} role="img" aria-label="A bill from 15 February to 14 March: 14 days fall in February, 14 in March">
        <text x={x0} y={18} className="lbl">Billing period 15 Feb – 14 Mar · 28 days · 45,500 kWh</text>
        <rect x={bx} y={30} width={bw} height={30} rx={6} className="bill" />
        <text x={bx + bw / 2} y={50} textAnchor="middle" className="billtxt">one bill = one reading</text>
        <line x1={x0 + feb} y1={24} x2={x0 + feb} y2={130} className="cut" />
        <rect x={x0} y={80} width={feb - 3} height={26} rx={6} className="mon" />
        <rect x={x0 + feb + 3} y={80} width={31 * day - 3} height={26} rx={6} className="mon" />
        <rect x={bx} y={80} width={feb - 14 * day - 3} height={26} rx={6} className="cov" />
        <rect x={x0 + feb + 3} y={80} width={14 * day - 3} height={26} rx={6} className="cov" />
        <text x={x0 + 8} y={98} className="montxt">February (28 days)</text>
        <text x={x0 + feb + 11} y={98} className="montxt">March (31 days)</text>
        <text x={x0 + feb / 2} y={128} textAnchor="middle" className="lbl">14 days → 22,750 kWh · covered 50%</text>
        <text x={x0 + feb + (31 * day) / 2} y={128} textAnchor="middle" className="lbl">14 days → 22,750 kWh · covered 45%</text>
        <text x={x0} y={158} className="hint">The rest of each month comes from the previous / next bill; until it arrives the month is scaled up and marked estimated.</text>
      </svg>
    </figure>
  );
}


/** The life of an entry: its statuses and who moves it from one to the next. */
function EntryLife() {
  const box = (x: number, y: number, w: number, cls: string, t: string, sub: string, dashed = false) => (
    <g>
      <rect x={x} y={y} width={w} height={56} rx={12} className={`el-box ${cls}`} strokeDasharray={dashed ? '6 5' : undefined} />
      <text x={x + w / 2} y={y + 24} textAnchor="middle" className="el-t">{t}</text>
      <text x={x + w / 2} y={y + 42} textAnchor="middle" className="el-s">{sub}</text>
    </g>);
  return (
    <figure className="mentry">
      <svg viewBox="0 0 800 312" role="img" aria-label="Draft, then submit to waiting approval, then approve (optionally a level-2 approval) to approved; send back returns it to the person who entered it, withdraw takes it back to draft">
        <defs>
          <marker id="el-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="el-head" /></marker>
          <marker id="el-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="el-headb" /></marker>
        </defs>
        {box(10, 92, 140, 'draft', 'Draft', 'editable · not counted')}
        {box(215, 92, 160, 'wait', 'Waiting approval', 'in approvers\' lists')}
        {box(440, 92, 140, 'l2', 'Level 2', 'optional: large entries', true)}
        {box(645, 92, 145, 'ok', 'Approved', 'counts in dashboards')}
        {box(300, 222, 200, 'back', 'Sent back', 'with the approver\'s note')}
        {/* forward */}
        <path d="M150 120 H213" className="el-line" markerEnd="url(#el-a)" /><text x={182} y={112} textAnchor="middle" className="el-l">Submit</text>
        <path d="M375 120 H438" className="el-line" markerEnd="url(#el-a)" /><text x={407} y={112} textAnchor="middle" className="el-l">Approve</text>
        <path d="M580 120 H643" className="el-line" markerEnd="url(#el-a)" /><text x={612} y={112} textAnchor="middle" className="el-l">Approve</text>
        <path d="M295 92 C 295 30, 717 30, 717 90" className="el-line" markerEnd="url(#el-a)" /><text x={506} y={40} textAnchor="middle" className="el-l">Approve — no level 2 needed (most entries)</text>
        {/* back */}
        <path d="M260 148 C 260 200, 150 205, 90 150" className="el-lineb" markerEnd="url(#el-b)" /><text x={150} y={196} textAnchor="middle" className="el-lb">Withdraw</text>
        <path d="M330 148 V220" className="el-lineb" markerEnd="url(#el-b)" /><text x={322} y={190} textAnchor="end" className="el-lb">Send back</text>
        <path d="M717 148 C 717 250, 600 252, 502 250" className="el-lineb" markerEnd="url(#el-b)" /><text x={610} y={274} textAnchor="middle" className="el-lb">Send back (a correction)</text>
        <path d="M400 220 C 400 185, 372 170, 360 150" className="el-line" markerEnd="url(#el-a)" /><text x={412} y={192} className="el-l">Fix, submit again</text>
        <text x={10} y={304} className="el-n">Only Approved counts in dashboards and reports (tick “Include waiting” there to preview). A month locked for audit cannot change in any status.</text>
      </svg>
    </figure>);
}

export function Diagram({ name }: { name: string }) {
  if (name === 'scopes') return <Scopes />;
  if (name === 'month-split') return <MonthSplit />;
  if (name === 'entry-life') return <EntryLife />;
  return <div className="note warn">Unknown diagram “{name}”.</div>;
}

/** A short help video: a poster with a play button; plays in place (MP4, else WebM, from /help — recorded by tools/help-videos). */
export function Video({ name, src }: { name: string; src: string }) {
  const [title = 'Watch', length = ''] = src.trim().split('|').map((x) => x.trim());
  const [on, setOn] = useState(false);
  const file = `/help/${encodeURIComponent(name)}`;
  return (
    <figure className="mvideo">
      {on
        ? <video poster={`${file}.jpg`} controls autoPlay playsInline preload="metadata" aria-label={title}>
            <source src={`${file}.mp4`} type="video/mp4" /><source src={`${file}.webm`} type="video/webm" /></video>
        : <button type="button" className="mvideo-poster" onClick={() => setOn(true)} aria-label={`Play the video: ${title}`}>
            <img src={`${file}.jpg`} alt="" loading="lazy" /><span className="mvideo-play">▶</span></button>}
      <figcaption><b>▶ {title}</b>{length && <span className="muted"> · {length}</span>} <span className="muted small">— no sound; captions on screen</span></figcaption>
    </figure>
  );
}
