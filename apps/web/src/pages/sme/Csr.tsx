/**
 * CSR (Companies Act s.135): does the 2% rule apply, the spending register (project, Schedule VII area, implementing
 * agency with CSR-1 number, budget, spent, ongoing or not, proof), totals against the obligation, what happens to an
 * unspent amount and by when, and the annual action plan the board approves. Stored in the 'csr' module; amounts in
 * the register are ₹ lakh, the threshold figures ₹ crore. `spent` (₹ crore) is kept equal to the register's total.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Sample, SmeHead, copyText } from './ui';
import { Evidence } from './Evidence';
import { f1, f2, lakh, n } from '../../lib/sme';
import './comply.css';
import './rules.css';

interface Project { id: string; project: string; area: string; mode: 'own' | 'agency'; agency: string; csr1: string; budget: number | ''; spent: number | ''; date: string; ongoing: boolean; local: boolean }
const uid = () => Math.random().toString(36).slice(2, 9);
const cr = (v: number) => `₹${f2(v)} Cr`;
const L = (crore: number) => lakh(crore * 1e7);
const CSR1 = /^CSR\d{8}$/i;

const CHECKS: [string, string, string][] = [
  ['policy', 'CSR policy approved by the board and put on the website', 's.135(4), rule 9'],
  ['committee', 'CSR committee formed (needed above ₹50 lakh obligation)', 's.135(1), (9)'],
  ['plan', 'Annual action plan approved by the board', 'rule 5(2)'],
  ['agencies', 'CSR-1 registration of each implementing agency checked', 'rule 4(1)'],
  ['cfo', 'CFO certificate that the money was used as approved', 'rule 4(5)'],
  ['report', 'Annual report on CSR in the board’s report (Annexure II)', 'rule 8(1)'],
  ['csr2', 'Form CSR-2 filed with the MCA', 'rule 12(1A)'],
];
type Tab = 'overview' | 'spend' | 'plan';

/** "FY 2025-26" → year in which it ends (2026). */
const endYear = (fy: string) => Number(/^FY (\d{4})/.exec(fy)?.[1] ?? new Date().getFullYear() - 1) + 1;

export function SmeCsr() {
  const { d, get, fy, setModule } = useSme();
  const [tab, setTab] = useState<Tab>('overview');
  if (!d) return <div className="card empty">Loading…</div>;
  const c = d.results.csr as any;
  const raw = (d.data.csr ?? {}) as any;
  const projects: Project[] = Array.isArray(raw.projects) ? raw.projects : [];
  const can = d.canEdit;
  const areas = ((d.config.rules?.csr?.areas ?? []) as [string, string][]);
  const areaName = (k: string) => areas.find((a) => a[0] === k)?.[1] ?? '';
  const save = (next: Record<string, any>) => {
    const out = { ...raw, ...next };
    if (Array.isArray(out.projects) && out.projects.length) out.spent = out.projects.reduce((a: number, x: Project) => a + n(x.spent), 0) / 100;
    setModule('csr', out);
  };
  const setProjects = (list: Project[]) => save({ projects: list });

  const nw = n(get('csr.netWorth')), to = n(get('profile.turnover')), p3 = n(get('csr.profit3'));
  const filled = ['csr.netWorth', 'csr.profit1', 'csr.profit2', 'csr.profit3'].some((k) => get(k) !== undefined && get(k) !== '');
  const tests: [string, string, boolean][] = [
    ['Net worth ₹500 crore or more', nw ? `Yours: ${cr(nw)}` : 'Add net worth', nw >= 500],
    ['Turnover ₹1,000 crore or more', to ? `Yours: ${cr(to)} (from Profile)` : 'Add turnover in Profile', to >= 1000],
    ['Net profit ₹5 crore or more last year', p3 ? `Yours: ${cr(p3)}` : 'Add last year’s profit', p3 >= 5],
  ];
  const pct = c.obligation > 0 ? Math.min(100, (c.spent / c.obligation) * 100) : 0;
  const y = endYear(fy);
  const checks = (raw.checks ?? {}) as Record<string, boolean>;

  return (
    <>
      <SmeHead lede="Section 135 of the Companies Act: once any one threshold is crossed, the company spends 2% of its average net profit of the last three years on activities in Schedule VII, and reports it." />
      <div className="seg ru-tabs" role="tablist">
        {([['overview', 'Overview'], ['spend', 'Spending'], ['plan', 'Board & action plan']] as [Tab, string][]).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}{k === 'spend' && projects.length > 0 && <span className="ru-ct">{projects.length}</span>}</button>))}
      </div>

      {tab === 'overview' && <>
        <Kpis>
          <Kpi label="Does CSR apply?" value={filled || to ? (c.applies ? 'Yes' : 'No') : '—'} unit={c.applies ? 'a threshold is crossed' : filled ? 'no threshold crossed' : 'add your figures'} />
          <Kpi label="2% obligation" value={c.applies ? L(c.obligation) : '—'} unit={c.applies ? 'this year' : ''} />
          <Kpi label="Spent so far" value={c.applies ? L(c.spent) : '—'} unit={projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : ''} />
          <Kpi label="Still to spend" value={c.applies ? L(c.left) : '—'} good={c.applies && c.left <= 0} />
        </Kpis>
        {d.company.isExample && <p className="muted small" style={{ margin: 0 }}><Sample /> Figures of the demo company.</p>}

        <div className="sme-grid2">
          <div className="card"><h2>Your figures</h2>
            <p className="cmp-sub">From your audited accounts, in ₹ crore. Net profit is as worked out under section 198.</p>
            <Num path="csr.netWorth" label="Net worth" unit="₹ Cr" />
            <Num path="csr.profit1" label="Net profit, three years ago" unit="₹ Cr" />
            <Num path="csr.profit2" label="Net profit, two years ago" unit="₹ Cr" />
            <Num path="csr.profit3" label="Net profit, last year" unit="₹ Cr" />
            {!projects.length && <Num path="csr.spent" label="CSR spent so far this year" hint="Or list each project under Spending" unit="₹ Cr" />}
            <div style={{ marginTop: 10 }}><Evidence module="csr" item="accounts" label="Audited accounts" /></div>
          </div>

          <div className="cmp-stack">
            <div className="card"><h2>The three tests</h2>
              <p className="cmp-sub">Crossing any one of them in the previous year brings in CSR.</p>
              <div className="cmp-tests">
                {tests.map(([t, sub, ok]) => (
                  <div key={t} className="cmp-test"><span>{t}</span><Pill kind={ok ? 'likely' : 'watch'}>{ok ? 'Crossed' : 'Not crossed'}</Pill><small>{sub}</small></div>))}
              </div>
            </div>
            {!c.applies && <div className="sme-callout">{filled || to ? 'CSR does not apply at your current figures. Check again each year after the accounts are audited.' : 'Add your net worth and the last three years’ net profit to check whether CSR applies.'}</div>}
          </div>
        </div>

        {c.applies && (
          <div className="sme-grid2">
            <div className="card"><h2>Spent against the obligation</h2>
              <div className={`cmp-prog${c.left > 0 ? ' warn' : ''}`} style={{ marginTop: 12 }}><b style={{ width: `${pct}%` }} /></div>
              <div className="cmp-progl"><span>{L(c.spent)} spent</span><span>{L(c.obligation)} to spend</span></div>
              <dl className="ru-sums">
                <dt>Average net profit, last three years</dt><dd>{cr(c.avgProfit)}</dd>
                <dt>2% obligation for {fy}</dt><dd>{L(c.obligation)}</dd>
                <dt>Planned in projects</dt><dd>{L(c.planned)}</dd>
                <dt>Spent</dt><dd>{L(c.spent)}</dd>
                <dt className="tot">{c.excess > 0 ? 'Spent above the obligation' : 'Unspent'}</dt><dd className="tot">{L(c.excess > 0 ? c.excess : c.left)}</dd>
              </dl>
              {!projects.length && <p className="cmp-sub" style={{ marginTop: 10 }}>List each project under <button type="button" className="ru-link" onClick={() => setTab('spend')}>Spending</button> to split the unspent amount correctly and keep proof.</p>}
            </div>

            <div className="card"><h2>What to do and by when</h2>
              <ul className="cmp-time" style={{ marginTop: 10 }}>
                <li><b>By 31 Mar {y}</b><span>Spend {L(c.obligation)} on Schedule VII activities. Administrative overheads may be at most 5% of the spend{c.overheads > 0 ? ` (yours: ${f1(c.overheadsPct)}%${c.overheadsOk ? '' : ', above the limit'})` : ''}.</span></li>
                {c.left > 0 && c.toUnspentAccount > 0 && <li className="now"><b>By 30 Apr {y}</b><span>Move {L(c.toUnspentAccount)} for ongoing projects to an Unspent CSR Account in a scheduled bank, and spend it within the next three financial years (by 31 Mar {y + 3}). Whatever is still unspent then goes to a Schedule VII fund within 30 days.</span></li>}
                {c.left > 0 && c.toFund > 0 && <li className="now"><b>By 30 Sep {y}</b><span>Transfer {L(c.toFund)} not tied to an ongoing project to a Schedule VII fund (for example PM CARES or the PM National Relief Fund), within six months of the year end.</span></li>}
                {c.left <= 0 && <li><b>Unspent</b><span>Nothing is unspent.{c.excess > 0 ? ` The extra ${L(c.excess)} can be set off against the next three years’ obligations if the board passes a resolution.` : ''}</span></li>}
                <li><b>Committee</b><span>{c.committeeNeeded ? 'The obligation is above ₹50 lakh, so the board must have a CSR committee.' : 'Up to ₹50 lakh the board itself can do the CSR committee’s work.'}</span></li>
                {c.impactAssessment && <li><b>Impact assessment</b><span>With an obligation of ₹10 crore or more, projects of ₹1 crore or more need an independent impact assessment.</span></li>}
                <li><b>Report</b><span>Annual report on CSR in the board’s report, and Form CSR-2 with the MCA. Penalty for not following the unspent rules: twice the unspent amount or ₹1 crore, whichever is less.</span></li>
              </ul>
            </div>
          </div>)}
      </>}

      {tab === 'spend' && <Spending projects={projects} areas={areas} can={can} overheads={raw.overheads ?? ''} obligation={c.obligation} applies={c.applies}
        onChange={setProjects} onOverheads={(v) => save({ overheads: v })} />}

      {tab === 'plan' && <>
        <div className="card">
          <h2>For the board</h2>
          <p className="cmp-sub">Tick each step when done. Attach the signed papers as proof.</p>
          <div className="ru-checks">{CHECKS.filter(([k]) => k !== 'committee' || c.committeeNeeded).map(([k, t, ref]) => (
            <label key={k} className={`ru-check${checks[k] ? ' on' : ''}`}>
              <input type="checkbox" disabled={!can} checked={!!checks[k]} onChange={(e) => save({ checks: { ...checks, [k]: e.target.checked } })} />
              <span>{t} <small className="muted">· {ref}</small></span>
            </label>))}</div>
          <div style={{ marginTop: 10 }}><Evidence module="csr" item="board" label="Board papers" /></div>
        </div>
        <ActionPlan projects={projects} company={d.company.name} fy={fy} obligation={c.obligation} areaName={areaName} committee={c.committeeNeeded} />
      </>}
    </>);
}

// ------------------------------------------------------------------ spending register --
function Spending({ projects, areas, can, overheads, obligation, applies, onChange, onOverheads }: {
  projects: Project[]; areas: [string, string][]; can: boolean; overheads: number | ''; obligation: number; applies: boolean;
  onChange: (p: Project[]) => void; onOverheads: (v: number | '') => void;
}) {
  const upd = (id: string, k: keyof Project, v: any) => onChange(projects.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  const num = (v: string): number | '' => (v === '' ? '' : Number(v));
  const budget = projects.reduce((a, x) => a + n(x.budget), 0), spent = projects.reduce((a, x) => a + n(x.spent), 0);
  return (
    <>
      <div className="card">
        <div className="ru-h2row"><h2>CSR projects</h2>{can && <button type="button" className="btn sm p" onClick={() => onChange([...projects, { id: uid(), project: '', area: '', mode: 'agency', agency: '', csr1: '', budget: '', spent: '', date: '', ongoing: false, local: true }])}>+ Add a project</button>}</div>
        <p className="cmp-sub">One entry for each project or contribution, in ₹ lakh. A project through an implementing agency (trust, society or section 8 company) needs the agency’s CSR-1 registration number (CSR followed by 8 digits). An ongoing project runs over more than one year (up to three), approved as such by the board.</p>
        {!projects.length && <p className="muted" style={{ margin: '8px 0 0' }}>No projects listed yet.{applies ? ` Your obligation this year is ${L(obligation)}.` : ''}{can ? ' Add the first one.' : ''}</p>}
        {projects.length > 0 && (
          <dl className="ru-sums">
            <dt>Planned (budgets)</dt><dd>₹{f1(budget)} L</dd>
            <dt>Spent</dt><dd>₹{f1(spent)} L</dd>
            {applies && <><dt className="tot">Obligation</dt><dd className="tot">{L(obligation)}</dd></>}
          </dl>)}
      </div>
      {projects.map((p) => {
        const badCsr1 = p.mode === 'agency' && !CSR1.test(p.csr1.trim());
        return (
          <div key={p.id} className="card">
            <div className="ru-h2row">
              <h2 style={{ fontSize: 15.5 }}>{p.project || 'New project'}</h2>
              {p.ongoing && <Pill kind="watch">Ongoing</Pill>}
              {!p.area ? <Pill kind="soon">Choose the area</Pill> : badCsr1 ? <Pill kind="soon">CSR-1 number</Pill> : <Pill kind="good">Complete</Pill>}
              {can && <button type="button" className="btn sm ghost" onClick={() => window.confirm('Remove this project?') && onChange(projects.filter((x) => x.id !== p.id))}>Remove</button>}
            </div>
            <div className="ru-grid">
              <label className="wide"><span>Project</span><input className="input" disabled={!can} value={p.project} placeholder="e.g. Drinking water ATM in Chakan village" onChange={(e) => upd(p.id, 'project', e.target.value)} /></label>
              <label className="wide"><span>Schedule VII area</span>
                <select className="input" disabled={!can} value={p.area} onChange={(e) => upd(p.id, 'area', e.target.value)}>
                  <option value="">Choose…</option>{areas.map(([k, t]) => <option key={k} value={k}>({k}) {t}</option>)}
                </select></label>
              <label><span>Carried out</span>
                <select className="input" disabled={!can} value={p.mode} onChange={(e) => upd(p.id, 'mode', e.target.value)}>
                  <option value="agency">Through an implementing agency</option><option value="own">By the company itself</option>
                </select></label>
              {p.mode === 'agency' && <>
                <label><span>Implementing agency</span><input className="input" disabled={!can} value={p.agency} onChange={(e) => upd(p.id, 'agency', e.target.value)} /></label>
                <label><span>CSR-1 registration no.</span><input className="input" disabled={!can} value={p.csr1} placeholder="CSR00012345" onChange={(e) => upd(p.id, 'csr1', e.target.value.toUpperCase())} />
                  {can && p.csr1 && badCsr1 && <small className="ru-err">CSR followed by 8 digits.</small>}</label>
              </>}
              <label><span>Budget for the year (₹ lakh)</span><input className="input num" type="number" min={0} step="any" inputMode="decimal" disabled={!can} value={p.budget} onChange={(e) => upd(p.id, 'budget', num(e.target.value))} /></label>
              <label><span>Spent so far (₹ lakh)</span><input className="input num" type="number" min={0} step="any" inputMode="decimal" disabled={!can} value={p.spent} onChange={(e) => upd(p.id, 'spent', num(e.target.value))} /></label>
              <label><span>Last payment on</span><input className="input" type="date" disabled={!can} value={p.date} onChange={(e) => upd(p.id, 'date', e.target.value)} /></label>
              <label className="ru-chk"><input type="checkbox" disabled={!can} checked={p.ongoing} onChange={(e) => upd(p.id, 'ongoing', e.target.checked)} /> Ongoing project (more than one year)</label>
              <label className="ru-chk"><input type="checkbox" disabled={!can} checked={p.local} onChange={(e) => upd(p.id, 'local', e.target.checked)} /> Near our plant (local area)</label>
            </div>
            {p.area && <p className="muted small" style={{ margin: '8px 0 0' }}>Schedule VII ({p.area}): {areas.find((a) => a[0] === p.area)?.[1]}</p>}
            <div style={{ marginTop: 10 }}><Evidence module="csr" item={`project-${p.id}`} label="Proof (receipts, utilisation certificate, photos)" /></div>
          </div>);
      })}
      <div className="card">
        <h2>Administrative overheads</h2>
        <p className="cmp-sub">Running costs of your CSR work (staff time, travel, monitoring). Counted in the spend, at most 5% of the total.</p>
        <div className="ru-grid"><label><span>Overheads this year (₹ lakh)</span><input className="input num" type="number" min={0} step="any" inputMode="decimal" disabled={!can} value={overheads} onChange={(e) => onOverheads(e.target.value === '' ? '' : Number(e.target.value))} /></label>
          <div className="ru-note">{spent > 0 && n(overheads) > 0 ? <>That is <b>{f1((n(overheads) / spent) * 100)}%</b> of the spend{n(overheads) > spent * 0.05 ? <span className="chip warn" style={{ marginLeft: 8 }}>Above 5%</span> : ''}</> : <span className="muted">Limit: 5% of the spend.</span>}</div></div>
      </div>
    </>);
}

// ------------------------------------------------------------------ annual action plan --
function ActionPlan({ projects, company, fy, obligation, areaName, committee }: { projects: Project[]; company: string; fy: string; obligation: number; areaName: (k: string) => string; committee: boolean }) {
  const [copied, setCopied] = useState(false);
  const total = projects.reduce((a, x) => a + n(x.budget), 0);
  const lines = projects.map((p, i) => [
    `${i + 1}. ${p.project || 'Project'}`,
    `   Schedule VII: (${p.area || '—'}) ${areaName(p.area) || 'area to be chosen'}`,
    `   Carried out: ${p.mode === 'own' ? 'by the company itself' : `through ${p.agency || 'an implementing agency'} (CSR-1: ${p.csr1 || 'to be added'})`}`,
    `   Budget for ${fy}: ₹${f1(p.budget)} lakh${p.ongoing ? ' · ongoing project (multi-year)' : ' · to be completed this year'}${p.local ? ' · local area' : ''}`,
  ].join('\n'));
  const text = [
    `${company}`,
    `Annual action plan for CSR, ${fy}`,
    `(Rule 5(2), Companies (CSR Policy) Rules, 2014 — ${committee ? 'recommended by the CSR committee to the board' : 'approved by the board'})`,
    '',
    `CSR obligation for the year: ₹${f1(obligation * 100)} lakh (2% of average net profit of the last three years).`,
    `Total of the budgets below: ₹${f1(total)} lakh.`,
    '',
    'A. Projects and programmes',
    lines.length ? lines.join('\n\n') : '   (no projects listed yet)',
    '',
    'B. Use of funds and schedule: money is released to each project against its budget and milestones; ongoing projects run for up to three years with yearly budgets.',
    'C. Monitoring and reporting: the CFO (or the person responsible for finance) certifies each year that the money was used for the approved purposes; implementing agencies send utilisation certificates and progress reports at least every six months.',
    'D. Impact assessment: required where the average CSR obligation of the last three years is ₹10 crore or more, for projects of ₹1 crore or more completed at least a year ago.',
    'E. Unspent amount: for ongoing projects, moved to the Unspent CSR Account within 30 days of the year end; otherwise transferred to a Schedule VII fund within six months.',
  ].join('\n');
  return (
    <div className="card">
      <div className="ru-h2row"><h2>Annual action plan</h2><button type="button" className="btn sm p" onClick={async () => setCopied(await copyText(text, document.getElementById('ru-plan')))}>{copied ? 'Copied' : 'Copy text'}</button></div>
      <p className="cmp-sub">Made from your Spending list. Copy it into the board or committee papers and adjust the wording.</p>
      <pre id="ru-plan" className="ru-plan">{text}</pre>
      {!projects.length && <p className="muted small" style={{ margin: 0 }}>Add projects under Spending to fill section A. <Link to="/sme/esg">Water, skilling and renewable energy</Link> projects near your plant also lift your ESG score.</p>}
    </div>);
}
