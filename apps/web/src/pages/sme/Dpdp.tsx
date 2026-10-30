/**
 * DPDP Act readiness: the company's data register, a 25-step checklist in seven areas with evidence,
 * breach and request logs (72-hour and 90-day clocks) and ready-to-use texts made from the register.
 * Everything is stored in the 'dpdp' module; the first version kept plain ticks ({ inv: true }), still read.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead, copyText } from './ui';
import { dmy, f0 } from '../../lib/sme';
import './comply.css';
import './dpdp.css';
import { Evidence, ProofCount, useProofCounts } from './Evidence';

interface Item { key: string; area: string; title: string; why?: string; evidence?: string }
interface Check { done?: boolean; owner?: string; date?: string; note?: string }
interface Row { id: string; category: string; what: string; purpose: string; basis: string; where: string; access: string; keep: string; vendors: string; children: boolean }
interface Breach { id: string; found: string; what: string; people: string; boardAt: string; peopleAt: string; steps: string; closed: boolean }
interface Req { id: string; received: string; kind: string; from: string; closed: string; note: string }
interface Dp { checks?: Record<string, Check>; register?: Row[]; breaches?: Breach[]; requests?: Req[]; contact?: { name?: string; email?: string; phone?: string }; [k: string]: any }

const CATS: [string, string, string][] = [
  ['employees', 'Employees and workers', 'कर्मचारी और श्रमिक'], ['customers', 'Customers', 'ग्राहक'], ['vendors', 'Vendors and suppliers', 'विक्रेता और आपूर्तिकर्ता'],
  ['cctv', 'CCTV and visitors', 'सीसीटीवी और आगंतुक'], ['other', 'Other', 'अन्य'],
];
const catName = (k: string, hi = false) => { const c = CATS.find((x) => x[0] === k); return c ? (hi ? c[2] : c[1]) : k; };
const BASIS: [string, string][] = [
  ['', 'Choose…'], ['consent', 'Consent of the person'], ['voluntary', 'Given by the person for this purpose (s.7(a))'],
  ['employment', 'Employment (s.7(i))'], ['law', 'Required by law (s.7)'],
];
const START: Record<string, Partial<Row>> = {
  employees: { what: 'Name, address, phone, bank account, PAN, Aadhaar (masked), attendance, salary, PF and ESI numbers', purpose: 'Employment, payroll, PF/ESI and statutory registers', basis: 'employment', keep: 'As labour and tax laws require (ask your CA)' },
  customers: { what: 'Contact names, phone, e-mail, GST and delivery addresses', purpose: 'Orders, invoices, delivery', basis: 'voluntary' },
  vendors: { what: 'Contact names, phone, e-mail, bank details', purpose: 'Purchases and payments', basis: 'voluntary' },
  cctv: { what: 'Video of people on the premises; visitor register', purpose: 'Safety and security of people and goods', keep: '30 days' },
  other: {},
};
const KINDS: [string, string][] = [['access', 'See their data'], ['correct', 'Correct or update'], ['erase', 'Erase'], ['withdraw', 'Withdraw consent'], ['complaint', 'Complaint']];
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const hoursSince = (iso: string) => (Date.now() - Date.parse(iso)) / 3600e3;
const daysSince = (iso: string) => (Date.now() - Date.parse(`${iso}T00:00:00`)) / 86400e3;
function monthsUntil(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`), t = new Date();
  let m = (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth();
  if (d.getDate() < t.getDate()) m--;
  return Math.max(0, m);
}

type Tab = 'overview' | 'register' | 'checklist' | 'logs' | 'texts';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['register', 'Data register'], ['checklist', 'Checklist'], ['logs', 'Breaches & requests'], ['texts', 'Ready texts']];

export function SmeDpdp() {
  const { d, setModule } = useSme();
  const [tab, setTab] = useState<Tab>('overview');
  if (!d) return <div className="card empty">Loading…</div>;
  const cfg = d.config.dpdp ?? {};
  const items = (cfg.items ?? []) as Item[];
  const areas = (cfg.areas ?? []) as { key: string; title: string }[];
  const raw = (d.data.dpdp ?? {}) as Dp;
  // the first version stored plain ticks at the top level
  const checks: Record<string, Check> = raw.checks ?? Object.fromEntries(items.filter((x) => raw[x.key] === true).map((x) => [x.key, { done: true }]));
  const dp: Dp = { ...raw, checks, register: raw.register ?? [], breaches: raw.breaches ?? [], requests: raw.requests ?? [], contact: raw.contact ?? {} };
  const save = (next: Partial<Dp>) => {
    const out: Dp = { checks: dp.checks, register: dp.register, breaches: dp.breaches, requests: dp.requests, contact: dp.contact, ...next };
    setModule('dpdp', out);
  };
  const can = d.canEdit;
  const done = items.filter((x) => checks[x.key]?.done).length;
  const pct = items.length ? (done / items.length) * 100 : 0;
  const lateBreaches = dp.breaches!.filter((b) => !b.boardAt && b.found && hoursSince(b.found) > 72).length;
  const openReq = dp.requests!.filter((r) => !r.closed);
  const lateReq = openReq.filter((r) => r.received && daysSince(r.received) > 90).length;
  const next = items.find((x) => !checks[x.key]?.done);

  return (
    <>
      <SmeHead lede="The Digital Personal Data Protection Act applies to every business that holds personal data: employees, customers, vendors, CCTV. Build your data register, work through the checklist, keep the two logs, and use the ready texts." />
      <div className="seg dp-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}{k === 'logs' && lateBreaches + lateReq > 0 && <span className="dp-dot" />}</button>)}</div>

      {tab === 'overview' && <>
        <Kpis>
          <Kpi label="Checklist done" value={`${f0(pct)}%`} unit={`${done} of ${items.length} steps`} good={pct >= 80} />
          <Kpi label="Data register" value={dp.register!.length} unit={dp.register!.length === 1 ? 'kind of data listed' : 'kinds of data listed'} />
          <Kpi label="Open requests" value={openReq.length} unit={lateReq ? `${lateReq} past 90 days` : 'none late'} />
          <Kpi label="Months left" value={cfg.deadline ? monthsUntil(cfg.deadline) : '—'} unit={cfg.deadline ? `to ${dmy(cfg.deadline)}` : ''} />
        </Kpis>
        {lateBreaches > 0 && <div className="note bad">{lateBreaches} breach{lateBreaches === 1 ? ' has' : 'es have'} not been reported to the Data Protection Board within 72 hours. <button type="button" className="linkbtn" onClick={() => setTab('logs')}>Open the breach log</button></div>}
        <div className="cmp-main">
          <div className="card">
            <h2>Where you stand</h2>
            <div className="dp-areas">{areas.map((a) => {
              const its = items.filter((x) => x.area === a.key), n = its.filter((x) => checks[x.key]?.done).length;
              return <button key={a.key} type="button" className="dp-area" onClick={() => setTab('checklist')}>
                <span className="t">{a.title}</span><span className="cmp-prog"><b style={{ width: `${its.length ? (n / its.length) * 100 : 0}%` }} /></span><span className="n num">{n}/{its.length}</span></button>;
            })}</div>
            {next && <div className="dp-next"><span className="lbl">Next step</span><b>{next.title}</b>{next.why && <p>{next.why}</p>}
              <button type="button" className="btn p sm" onClick={() => setTab(next.key === 'inv' ? 'register' : 'checklist')}>{next.key === 'inv' ? 'Start the data register' : 'Open the checklist'}</button></div>}
          </div>
          <div className="cmp-stack">
            <div className="card"><h2>Key dates</h2>
              <ul className="dp-dates">{(cfg.milestones ?? []).map((m: { date: string; title: string }) => <li key={m.date} className={m.date <= today() ? 'past' : ''}><b>{dmy(m.date)}</b><span>{m.title}</span></li>)}</ul>
              <p className="muted small" style={{ margin: '8px 0 0' }}>{cfg.note}</p>
            </div>
            <div className="card"><h2>What the law asks</h2>
              <ul className="cmp-time">
                <li><b>Notice</b><span>Tell people what you collect, why, and how to withdraw consent or complain.</span></li>
                <li><b>Lawful basis</b><span>Consent, or a legitimate use such as employment or a legal duty.</span></li>
                <li><b>Safeguards</b><span>Protect the data, keep access logs for a year, delete it when the purpose is over.</span></li>
                <li><b>Breaches</b><span>Tell the Board and the people affected without delay; a detailed report to the Board within 72 hours.</span></li>
                <li><b>Rights</b><span>Answer requests to see, correct or erase data within 90 days.</span></li>
              </ul>
              <p className="muted small" style={{ margin: '8px 0 0' }}>{cfg.penalty}</p>
            </div>
          </div>
        </div>
      </>}

      {tab === 'register' && <Register rows={dp.register!} can={can} onChange={(register) => save({ register })} />}
      {tab === 'checklist' && <Checklist items={items} areas={areas} checks={checks} can={can} onChange={(c) => save({ checks: c })} go={setTab} />}
      {tab === 'logs' && <Logs breaches={dp.breaches!} requests={dp.requests!} can={can} onBreaches={(breaches) => save({ breaches })} onRequests={(requests) => save({ requests })} />}
      {tab === 'texts' && <Texts dp={dp} company={d.company.name} state={d.company.state} can={can} onContact={(contact) => save({ contact })} />}
    </>);
}

// ------------------------------------------------------------------ data register --
function Register({ rows, can, onChange }: { rows: Row[]; can: boolean; onChange: (r: Row[]) => void }) {
  const add = (category: string) => onChange([...rows, { id: uid(), category, what: '', purpose: '', basis: '', where: '', access: '', keep: '', vendors: '', children: false, ...START[category] }]);
  const upd = (id: string, k: keyof Row, v: string | boolean) => onChange(rows.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const missing = (r: Row) => (['what', 'purpose', 'basis', 'keep'] as const).filter((k) => !r[k]);
  return (
    <>
      <div className="card">
        <h2>Your data register</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>One entry for each kind of personal data: what you hold, why, on what basis, where it is kept, who can see it, how long you keep it and which vendors handle it. The privacy notice and other texts are made from this.</p>
        {can && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span className="muted">Add:</span>{CATS.map(([k, t]) => <button key={k} type="button" className="btn sm" onClick={() => add(k)}>+ {t}</button>)}</div>}
      </div>
      {!rows.length && <div className="card empty">Nothing listed yet. Start with <b>Employees and workers</b>: every company has them.</div>}
      {rows.map((r) => {
        const miss = missing(r);
        return (
          <div key={r.id} className="card dp-row">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <select className="input dp-cat" value={r.category} disabled={!can} onChange={(e) => upd(r.id, 'category', e.target.value)} aria-label="Kind of data">{CATS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              <span className="grow" />
              {miss.length ? <Pill kind="soon">{miss.length} to fill</Pill> : <Pill kind="good">Complete</Pill>}
              {can && <button type="button" className="btn sm ghost danger" onClick={() => window.confirm('Remove this entry?') && onChange(rows.filter((x) => x.id !== r.id))}>Remove</button>}
            </div>
            <div className="dp-grid">
              <label className="wide"><span>What data</span><textarea className="input" rows={2} disabled={!can} value={r.what} onChange={(e) => upd(r.id, 'what', e.target.value)} /></label>
              <label className="wide"><span>Why you hold it (purpose)</span><input className="input" disabled={!can} value={r.purpose} onChange={(e) => upd(r.id, 'purpose', e.target.value)} /></label>
              <label><span>Basis</span><select className="input" disabled={!can} value={r.basis} onChange={(e) => upd(r.id, 'basis', e.target.value)}>{BASIS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label><span>How long you keep it</span><input className="input" disabled={!can} value={r.keep} placeholder="e.g. 30 days, 8 years" onChange={(e) => upd(r.id, 'keep', e.target.value)} /></label>
              <label><span>Where it is kept</span><input className="input" disabled={!can} value={r.where} placeholder="Software, files, phones" onChange={(e) => upd(r.id, 'where', e.target.value)} /></label>
              <label><span>Who can see it</span><input className="input" disabled={!can} value={r.access} onChange={(e) => upd(r.id, 'access', e.target.value)} /></label>
              <label className="wide"><span>Vendors who handle it</span><input className="input" disabled={!can} value={r.vendors} placeholder="Payroll software, cloud, CCTV company…" onChange={(e) => upd(r.id, 'vendors', e.target.value)} /></label>
              <label className="dp-chk"><input type="checkbox" disabled={!can} checked={r.children} onChange={(e) => upd(r.id, 'children', e.target.checked)} /> Includes children (under 18)</label>
            </div>
            {r.basis === 'consent' && <p className="muted small" style={{ margin: '8px 0 0' }}>Consent must be free, specific and clear, and you must keep proof. The <b>Ready texts</b> tab has a consent wording.</p>}
            {r.children && <p className="note warn small" style={{ margin: '8px 0 0' }}>Children’s data needs verifiable consent of a parent or guardian, and no tracking or targeted advertising.</p>}
          </div>);
      })}
    </>);
}

// ------------------------------------------------------------------ checklist --
function Checklist({ items, areas, checks, can, onChange, go }: { items: Item[]; areas: { key: string; title: string }[]; checks: Record<string, Check>; can: boolean; onChange: (c: Record<string, Check>) => void; go: (t: Tab) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const upd = (k: string, v: Partial<Check>) => onChange({ ...checks, [k]: { ...checks[k], ...v } });
  const proofs = useProofCounts('dpdp');
  const proven = items.filter((x) => (proofs?.[x.key] ?? 0) > 0).length;
  const link: Record<string, Tab> = { inv: 'register', legit: 'register', kids: 'register', retain: 'register', vendorlist: 'register', breachlog: 'logs', rights: 'logs', notice: 'texts', cctv: 'texts', vendors: 'texts', contact: 'texts', owner: 'texts' };
  return (
    <>
    {proofs && <div className="card sme-ev-head" style={{ marginBottom: 0 }}><p className="muted" style={{ flex: '1 1 260px', margin: 0 }}>Open a step to note who owns it and attach its evidence. Keep evidence here so it is ready if the Data Protection Board or a customer asks.</p>
      <ProofCount have={proven} of={items.length} what="steps have evidence attached" /></div>}
    {areas.map((a) => {
      const its = items.filter((x) => x.area === a.key), n = its.filter((x) => checks[x.key]?.done).length;
      return (
        <div key={a.key} className="card">
          <div className="cmp-h2row"><h2>{a.title}</h2><span className="muted">{n} of {its.length}</span></div>
          <div className="cmp-checks" style={{ marginTop: 6 }}>{its.map((x) => {
            const c = checks[x.key] ?? {}, on = !!c.done, isOpen = open === x.key;
            return (
              <div key={x.key} className={`dp-item${on ? ' on' : ''}`}>
                <div className="dp-item-h">
                  <input type="checkbox" aria-label={x.title} disabled={!can} checked={on} onChange={(e) => upd(x.key, { done: e.target.checked, date: e.target.checked ? c.date || today() : c.date })} />
                  <button type="button" className="dp-item-t" onClick={() => setOpen(isOpen ? null : x.key)} aria-expanded={isOpen}><b>{x.title}</b><small>{x.why}</small>
                    {(c.owner || c.note || (proofs?.[x.key] ?? 0) > 0) && <em>{[c.owner && `Owner: ${c.owner}`, c.date && on && `done ${dmy(c.date)}`, c.note, (proofs?.[x.key] ?? 0) > 0 && `${proofs![x.key]} evidence file${proofs![x.key] === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</em>}</button>
                  <span className="dp-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </div>
                {isOpen && <div className="dp-item-b">
                  {x.evidence && <p><span className="lbl">Evidence to keep</span> {x.evidence}{link[x.key] && <> · <button type="button" className="linkbtn" onClick={() => go(link[x.key]!)}>Open {TABS.find((t) => t[0] === link[x.key])![1]}</button></>}</p>}
                  <div className="dp-grid">
                    <label><span>Owner</span><input className="input" disabled={!can} value={c.owner ?? ''} onChange={(e) => upd(x.key, { owner: e.target.value })} /></label>
                    <label><span>Done on</span><input className="input" type="date" disabled={!can} value={c.date ?? ''} onChange={(e) => upd(x.key, { date: e.target.value })} /></label>
                    <label className="wide"><span>Note or where the evidence is</span><input className="input" disabled={!can} value={c.note ?? ''} onChange={(e) => upd(x.key, { note: e.target.value })} /></label>
                  </div>
                  <div className="sme-ev-row"><Evidence module="dpdp" item={x.key} label="Evidence" /></div>
                </div>}
              </div>);
          })}</div>
        </div>);
    })}</>);
}

// ------------------------------------------------------------------ breach and request logs --
function Logs({ breaches, requests, can, onBreaches, onRequests }: { breaches: Breach[]; requests: Req[]; can: boolean; onBreaches: (b: Breach[]) => void; onRequests: (r: Req[]) => void }) {
  const updB = (id: string, k: keyof Breach, v: string | boolean) => onBreaches(breaches.map((b) => (b.id === id ? { ...b, [k]: v } : b)));
  const updR = (id: string, k: keyof Req, v: string) => onRequests(requests.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <>
      <div className="card">
        <div className="cmp-h2row"><h2>Breach log</h2>{can && <button type="button" className="btn sm" onClick={() => onBreaches([{ id: uid(), found: now, what: '', people: '', boardAt: '', peopleAt: '', steps: '', closed: false }, ...breaches])}>+ Record a breach</button>}</div>
        <p className="muted" style={{ margin: '4px 0 10px' }}>A breach is any unauthorised use, sharing, loss or destruction of personal data: a lost phone or laptop, a hacked e-mail, a wrong file sent, files left in the open. Tell the Data Protection Board and the people affected without delay, and send the Board a detailed report within 72 hours.</p>
        {!breaches.length && <p className="muted" style={{ margin: 0 }}>No breaches recorded.</p>}
        {breaches.map((b) => {
          const h = b.found ? hoursSince(b.found) : 0, left = Math.max(0, 72 - h);
          const state = b.boardAt ? <Pill kind="good">Board told {dmy(b.boardAt)}</Pill> : h > 72 ? <Pill kind="overdue">Past 72 hours</Pill> : <Pill kind="soon">{f0(left)} h left to report</Pill>;
          return (
            <div key={b.id} className="dp-log">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{state}{b.closed && <Pill kind="done">Closed</Pill>}<span className="grow" />{can && <button type="button" className="btn sm ghost danger" onClick={() => window.confirm('Remove this breach from the log?') && onBreaches(breaches.filter((x) => x.id !== b.id))}>Remove</button>}</div>
              <div className="dp-grid">
                <label><span>Found on</span><input className="input" type="datetime-local" disabled={!can} value={b.found} onChange={(e) => updB(b.id, 'found', e.target.value)} /></label>
                <label><span>People affected (about)</span><input className="input num" inputMode="numeric" disabled={!can} value={b.people} onChange={(e) => updB(b.id, 'people', e.target.value)} /></label>
                <label className="wide"><span>What happened</span><textarea className="input" rows={2} disabled={!can} value={b.what} onChange={(e) => updB(b.id, 'what', e.target.value)} /></label>
                <label className="wide"><span>Steps taken to limit harm and stop it happening again</span><textarea className="input" rows={2} disabled={!can} value={b.steps} onChange={(e) => updB(b.id, 'steps', e.target.value)} /></label>
                <label><span>Board told on</span><input className="input" type="date" disabled={!can} value={b.boardAt} onChange={(e) => updB(b.id, 'boardAt', e.target.value)} /></label>
                <label><span>People told on</span><input className="input" type="date" disabled={!can} value={b.peopleAt} onChange={(e) => updB(b.id, 'peopleAt', e.target.value)} /></label>
                <label className="dp-chk"><input type="checkbox" disabled={!can} checked={b.closed} onChange={(e) => updB(b.id, 'closed', e.target.checked)} /> Closed</label>
              </div>
            </div>);
        })}
      </div>

      <div className="card">
        <div className="cmp-h2row"><h2>Request log</h2>{can && <button type="button" className="btn sm" onClick={() => onRequests([{ id: uid(), received: today(), kind: 'access', from: '', closed: '', note: '' }, ...requests])}>+ Record a request</button>}</div>
        <p className="muted" style={{ margin: '4px 0 10px' }}>Requests from people to see, correct or erase their data, to withdraw consent, or complaints. Answer within 90 days at most. Write only what you need to identify the request.</p>
        {!requests.length && <p className="muted" style={{ margin: 0 }}>No requests recorded.</p>}
        {!!requests.length && <div className="sme-scroll"><table className="sme-tbl dp-tbl"><thead><tr><th>Received</th><th>Request</th><th>From</th><th>Answer by</th><th>Closed on</th><th>Note</th><th /></tr></thead><tbody>
          {requests.map((r) => {
            const due = r.received ? new Date(Date.parse(`${r.received}T00:00:00`) + 90 * 86400e3).toISOString().slice(0, 10) : '';
            const late = !r.closed && due && due < today();
            return (
              <tr key={r.id}>
                <td><input className="input sm" type="date" disabled={!can} value={r.received} onChange={(e) => updR(r.id, 'received', e.target.value)} /></td>
                <td><select className="input sm" disabled={!can} value={r.kind} onChange={(e) => updR(r.id, 'kind', e.target.value)}>{KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                <td><input className="input sm" disabled={!can} value={r.from} placeholder="e.g. Former employee (R.)" onChange={(e) => updR(r.id, 'from', e.target.value)} /></td>
                <td>{r.closed ? <span className="muted">—</span> : late ? <Pill kind="overdue">{dmy(due)}</Pill> : dmy(due)}</td>
                <td><input className="input sm" type="date" disabled={!can} value={r.closed} onChange={(e) => updR(r.id, 'closed', e.target.value)} /></td>
                <td><input className="input sm" disabled={!can} value={r.note} onChange={(e) => updR(r.id, 'note', e.target.value)} /></td>
                <td>{can && <button type="button" className="btn sm ghost danger" aria-label="Remove" onClick={() => window.confirm('Remove this request from the log?') && onRequests(requests.filter((x) => x.id !== r.id))}>✕</button>}</td>
              </tr>);
          })}
        </tbody></table></div>}
      </div>
    </>);
}

// ------------------------------------------------------------------ ready texts --
type TextKey = 'notice' | 'notice_hi' | 'employee' | 'cctv' | 'consent' | 'vendor' | 'breach';
const TEXTS: [TextKey, string][] = [['notice', 'Privacy notice'], ['notice_hi', 'Privacy notice (Hindi)'], ['employee', 'Notice to employees'], ['cctv', 'CCTV signboard'], ['consent', 'Consent wording'], ['vendor', 'Vendor contract clause'], ['breach', 'Breach report to the Board']];

function Texts({ dp, company, state, can, onContact }: { dp: Dp; company: string; state: string; can: boolean; onContact: (c: NonNullable<Dp['contact']>) => void }) {
  const [k, setK] = useState<TextKey>('notice');
  const [copied, setCopied] = useState(false);
  const c = dp.contact ?? {};
  const contact = [c.name, c.email, c.phone].filter(Boolean).join(', ') || '[name, e-mail and phone of your data contact]';
  const rows = dp.register ?? [];
  const pick = (cat: string) => rows.filter((r) => r.category === cat);
  const date = dmy(today());
  const text = makeText(k, { company, state, contact, email: c.email || '[e-mail]', rows, emp: pick('employees'), cctv: pick('cctv'), breach: (dp.breaches ?? [])[0], date });
  const missing = !rows.length && k !== 'vendor' && k !== 'breach';
  return (
    <div className="cmp-main">
      <div className="card">
        <div className="seg dp-texts">{TEXTS.map(([t, l]) => <button key={t} type="button" className={k === t ? 'on' : ''} onClick={() => { setK(t); setCopied(false); }}>{l}</button>)}</div>
        {missing && <div className="note warn" style={{ marginTop: 12 }}>Fill the <b>Data register</b> first: the texts are made from it.</div>}
        <pre className="dp-text" id="dp-text">{text}</pre>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn p" onClick={async () => setCopied(await copyText(text, document.getElementById('dp-text')))}>{copied ? 'Copied' : 'Copy text'}</button>
          <button type="button" className="btn" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.title = TEXTS.find((t) => t[0] === k)![1]; const p = w.document.createElement('pre'); p.style.cssText = 'white-space:pre-wrap;font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:40px auto'; p.textContent = text; w.document.body.appendChild(p); w.print(); } }}>Print</button>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>A starting point made from your register. Review it with your lawyer or CA before you use it. Entries typed in English stay in English in the Hindi notice.</p>
      </div>
      <div className="cmp-stack">
        <div className="card"><h2>Your data contact</h2>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>The person people can ask about their data. Shown in every text.</p>
          {(['name', 'email', 'phone'] as const).map((f) => <label key={f} className="field" style={{ marginTop: 8 }}><span>{f === 'name' ? 'Name and role' : f === 'email' ? 'E-mail' : 'Phone'}</span>
            <input className="input" disabled={!can} type={f === 'email' ? 'email' : 'text'} value={c[f] ?? ''} onChange={(e) => onContact({ ...c, [f]: e.target.value })} /></label>)}
        </div>
        <div className="sme-callout">The privacy notice must stand on its own, list each kind of data and its purpose, and say how to withdraw consent, use your rights and complain to the Board (Rule 3). Show it where you collect data: forms, website, WhatsApp sign-ups, the notice board. See also <Link to="/sme/people">People &amp; safety</Link> for the workers’ grievance QR.</div>
      </div>
    </div>);
}

interface Ctx { company: string; state: string; contact: string; email: string; rows: Row[]; emp: Row[]; cctv: Row[]; breach: Breach | undefined; date: string }
function makeText(k: TextKey, x: Ctx): string {
  const list = (hi = false) => x.rows.length
    ? x.rows.map((r) => `• ${catName(r.category, hi)}: ${r.what || '[data]'}.\n  ${hi ? 'उद्देश्य' : 'Purpose'}: ${r.purpose || '[purpose]'}.${r.keep ? ` ${hi ? 'कितने समय तक रखा जाता है' : 'Kept for'}: ${r.keep}.` : ''}`).join('\n')
    : hi ? '• [डेटा रजिस्टर भरें]' : '• [fill the data register]';
  const vendors = [...new Set(x.rows.map((r) => r.vendors).filter(Boolean))].join('; ');
  const consentBased = x.rows.some((r) => r.basis === 'consent');
  switch (k) {
    case 'notice': return `PRIVACY NOTICE — ${x.company}

${x.company} collects and uses personal data only as described in this notice, under India's Digital Personal Data Protection Act, 2023.

What we collect and why
${list()}

Who we share it with
${vendors ? `Service providers who work for us: ${vendors}. They may use the data only on our instructions.` : 'We do not share it, except where the law requires.'}

Your rights
• You can ask for a summary of your personal data we hold and how we use it.
• You can ask us to correct, complete, update or erase it.${consentBased ? '\n• Where we rely on your consent, you can withdraw it at any time, as easily as you gave it. We will then stop using that data.' : ''}
• You can name someone to use these rights for you if you die or cannot act.
We will answer within 90 days.

Questions and complaints
${x.contact}
If you are not satisfied with our answer, you can complain to the Data Protection Board of India.

Last updated: ${x.date}`;
    case 'notice_hi': return `गोपनीयता सूचना — ${x.company}

${x.company} आपका व्यक्तिगत डेटा केवल इस सूचना में बताए गए कामों के लिए, डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 के अनुसार एकत्र और उपयोग करता है।

हम क्या एकत्र करते हैं और क्यों
${list(true)}

हम किसके साथ साझा करते हैं
${vendors ? `हमारे लिए काम करने वाले सेवा प्रदाता: ${vendors}। वे डेटा का उपयोग केवल हमारे निर्देश पर कर सकते हैं।` : 'हम इसे साझा नहीं करते, सिवाय वहाँ जहाँ कानून इसकी माँग करता है।'}

आपके अधिकार
• आप हमारे पास मौजूद अपने व्यक्तिगत डेटा और उसके उपयोग का सारांश माँग सकते हैं।
• आप उसे सुधारने, पूरा करने, अद्यतन करने या मिटाने का अनुरोध कर सकते हैं।${consentBased ? '\n• जहाँ हम आपकी सहमति पर निर्भर हैं, आप किसी भी समय उतनी ही आसानी से अपनी सहमति वापस ले सकते हैं जितनी आसानी से आपने दी थी।' : ''}
हम 90 दिनों के भीतर उत्तर देंगे।

प्रश्न और शिकायत
${x.contact}
यदि आप हमारे उत्तर से संतुष्ट नहीं हैं, तो आप भारतीय डेटा संरक्षण बोर्ड से शिकायत कर सकते हैं।

अंतिम अद्यतन: ${x.date}`;
    case 'employee': {
      const e = x.emp[0];
      return `NOTICE TO EMPLOYEES AND WORKERS — PERSONAL DATA

${x.company} holds the following personal data about you:
${e?.what || '[name, address, phone, bank account, PAN, attendance, salary, PF and ESI numbers]'}

We use it for: ${e?.purpose || '[employment, payroll, PF/ESI and statutory registers]'}.

We use this data for your employment, as the Digital Personal Data Protection Act, 2023 allows (section 7), so we do not ask for separate consent. We do not use it for anything else without telling you first.

Who can see it: ${e?.access || '[owner, HR, accountant]'}.
${e?.vendors ? `Service providers who handle it for us: ${e.vendors}.\n` : ''}How long we keep it: ${e?.keep || '[as labour and tax laws require]'}.

You can ask to see a summary of your data, and to correct or update it. We answer within 90 days.
Questions or complaints: ${x.contact}.

Date: ${x.date}`;
    }
    case 'cctv': {
      const keep = x.cctv[0]?.keep || '[30 days]';
      return `CCTV IN USE
This area is recorded on CCTV for the safety and security of people and goods.
Recordings are kept for ${keep} and seen only by authorised staff.
Questions: ${x.contact}
— ${x.company}

सीसीटीवी निगरानी में
लोगों और सामान की सुरक्षा के लिए इस क्षेत्र की सीसीटीवी रिकॉर्डिंग की जाती है।
रिकॉर्डिंग ${keep} तक रखी जाती है और केवल अधिकृत कर्मचारी ही इसे देख सकते हैं।
प्रश्न: ${x.contact}
— ${x.company}`;
    }
    case 'consent': {
      const r = x.rows.find((y) => y.basis === 'consent');
      return `CONSENT

${x.company} would like to use your ${r?.what || '[data]'} for ${r?.purpose || '[purpose]'}.

☐ I agree to ${x.company} using my data for this purpose.

You do not have to agree. If you agree, you can withdraw your consent at any time by writing to ${x.email}, as easily as you gave it; we will then stop using the data and delete it, unless a law requires us to keep it. Our privacy notice explains your rights and how to complain to the Data Protection Board of India.

Name: ____________________   Date: ____________   Signature: ____________`;
    }
    case 'vendor': return `DATA PROTECTION CLAUSE (for contracts with vendors who handle personal data for ${x.company})

1. The Vendor shall process personal data received from or collected for ${x.company} only on ${x.company}'s documented instructions and only to provide the services under this agreement.
2. The Vendor shall keep the personal data confidential and allow access only to its staff who need it for the services and are bound by confidentiality.
3. The Vendor shall keep reasonable security safeguards, including access control, encryption or masking where appropriate, backups, and logs of access kept for at least one year.
4. The Vendor shall inform ${x.company} without delay, and in any case within 24 hours, of any personal data breach, with the details ${x.company} needs to report it to the Data Protection Board of India and to the people affected.
5. The Vendor shall not engage another processor, or transfer the data outside India, without ${x.company}'s prior written approval.
6. The Vendor shall help ${x.company} answer requests from people to see, correct or erase their data.
7. At the end of the services, or on request, the Vendor shall delete or return all the personal data and confirm this in writing, unless a law requires it to keep a copy.
8. ${x.company} may check the Vendor's compliance with this clause on reasonable notice.`;
    case 'breach': {
      const b = x.breach;
      return `INTIMATION OF PERSONAL DATA BREACH
To: Data Protection Board of India

1. Data fiduciary: ${x.company}${x.state ? `, ${x.state}` : ''}
   Contact: ${x.contact}
2. When the breach became known: ${b?.found ? b.found.replace('T', ' ') : '[date and time]'}
3. Description of the breach (nature, extent, timing, location): ${b?.what || '[what happened]'}
4. Personal data and people affected: ${b?.people ? `about ${b.people} people` : '[number of people; kinds of data]'}
5. Likely impact on the people affected: [describe]
6. Steps taken to reduce the harm and to prevent it happening again: ${b?.steps || '[steps taken]'}
7. Cause, and the person responsible if known: [describe]
8. People affected informed on: ${b?.peopleAt ? dmy(b.peopleAt) : '[date]'}

Report date: ${x.date}
Send the Board a first intimation without delay, and this detailed report within 72 hours of becoming aware of the breach.`;
    }
  }
}
