/**
 * Diagrams for the user manual, written as plain text inside the manual's Markdown:
 *
 *   ```flow                     one step per line:  [marker] Title | detail
 *   > Upload | drop PDFs        markers:  >  step (default)   *  a person acts
 *   ! Checks | PDF only                   !  safety check     ?  decision: Title | yes … | no …
 *   ```
 *   ```layers                   one layer per line: Title | what protects it
 *   ```diagram scopes           ready-made pictures: scopes, month-split
 */
import type { ReactNode } from 'react';
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

export function Diagram({ name }: { name: string }) {
  if (name === 'scopes') return <Scopes />;
  if (name === 'month-split') return <MonthSplit />;
  return <div className="note warn">Unknown diagram “{name}”.</div>;
}
