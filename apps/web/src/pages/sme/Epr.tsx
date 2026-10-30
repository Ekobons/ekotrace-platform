/**
 * EPR: plastic packaging (categories I–IV, target, recycling share, certificates per category), e-waste (target % of
 * estimated e-waste) and batteries (collection target by battery type and basis year): what is needed, what is bought,
 * the gap, and the annual return with its due date, checklist and acknowledgement. Stored in the 'epr' module, stamped
 * with the financial year so the engine applies that year's targets.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type ReactNode } from 'react';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead, Toggle } from './ui';
import { Evidence } from './Evidence';
import { dmy, f0, f1, n } from '../../lib/sme';
import './comply.css';
import './rules.css';

type Stream = 'plastic' | 'ewaste' | 'battery';
const ROLES: [string, string][] = [['', 'Choose'], ['Brand owner', 'Brand owner: our brand is on the pack'], ['Producer', 'Producer: we make the packaging'], ['Importer', 'Importer: we import packaging or packed goods']];
const CHECKS: Record<Stream, [string, string][]> = {
  plastic: [['sales', 'Plastic placed on the market entered on the portal, by category and state'], ['certs', 'EPR certificates transferred to your account'], ['recycled', 'Recycled content used and reuse reported (brand owners and producers)'], ['filed', 'Annual return filed'], ['ack', 'Acknowledgement downloaded and attached below']],
  ewaste: [['sales', 'Sales of each listed item entered, with weights'], ['quarterly', 'Quarterly returns filed'], ['certs', 'EPR certificates bought and set off'], ['filed', 'Annual return filed'], ['ack', 'Acknowledgement downloaded and attached below']],
  battery: [['sales', 'Batteries placed on the market entered, by type and chemistry'], ['certs', 'EPR certificates bought from registered recyclers or refurbishers'], ['filed', 'Annual return filed'], ['ack', 'Acknowledgement downloaded and attached below']],
};
const NAME: Record<Stream, string> = { plastic: 'Plastic packaging', ewaste: 'E-waste', battery: 'Batteries' };
const uid = () => Math.random().toString(36).slice(2, 9);
const numIn = (v: string): number | '' => (v === '' ? '' : Number(v));

export function SmeEpr() {
  const { d, fy, get, setModule } = useSme();
  const [tab, setTab] = useState<Stream | null>(null);
  if (!d) return <div className="card empty">Loading…</div>;
  const e = d.results.epr as any;
  const raw = (d.data.epr ?? {}) as any;
  const X = d.config.rules?.epr ?? {};
  const can = d.canEdit;
  const save = (next: Record<string, any>) => setModule('epr', { ...raw, ...next, fy });
  const on: Record<Stream, boolean> = { plastic: !!get('profile.plastics'), ewaste: !!get('profile.ewaste'), battery: !!get('profile.battery') };
  const streams = (['plastic', 'ewaste', 'battery'] as Stream[]).filter((s) => on[s]);
  const cur: Stream | null = tab && on[tab] ? tab : streams[0] ?? null;
  const pos = (s: Stream) => (s === 'plastic' ? e.plastic : s === 'ewaste' ? e.ewaste : e.battery);
  const state = (s: Stream) => { const x = pos(s); return !x.registered ? ['overdue', 'Not registered'] : x.need <= 0 ? ['watch', 'Add figures'] : x.gap > 0 ? ['soon', 'Gap open'] : ['done', 'Covered']; };
  const unit = (s: Stream) => (s === 'plastic' ? 't' : 'kg');
  const fmt = (s: Stream, v: number) => (s === 'plastic' ? f1(v) : f0(v));

  return (
    <>
      <SmeHead lede="Extended Producer Responsibility: if you put plastic packaging, electrical goods or batteries on the Indian market, you register with CPCB, cover a yearly target with EPR certificates and file an annual return." />

      <div className="card">
        <h2>What you put on the market</h2>
        <p className="cmp-sub">Saved to your profile too. Turn on each that applies to you.</p>
        <Toggle path="profile.plastics" label="Goods in plastic packaging, as brand owner, producer or importer" />
        <Toggle path="profile.ewaste" label="Electrical or electronic goods we make or import" hint="Items listed in Schedule I of the E-Waste Rules, 2022" />
        <Toggle path="profile.battery" label="Batteries, or goods with batteries, we make or import" />
        {!streams.length && <p className="muted" style={{ margin: '10px 0 0' }}>None applies at the moment, so you have no EPR duties. Tyre and used-oil EPR apply only to producers and importers of those goods.</p>}
      </div>

      {streams.length > 0 && <>
        <Kpis>{streams.map((s) => {
          const x = pos(s), [k, t] = state(s);
          return <Kpi key={s} label={NAME[s]} value={x.need > 0 ? `${fmt(s, x.gap)} ${unit(s)}` : '—'} unit={<><Pill kind={k!}>{t}</Pill> {x.need > 0 ? 'gap to close' : ''}</>} good={k === 'done'} />;
        })}</Kpis>
        {streams.length > 1 && <div className="seg ru-tabs" role="tablist">{streams.map((s) => <button key={s} type="button" role="tab" aria-selected={cur === s} className={cur === s ? 'on' : ''} onClick={() => setTab(s)}>{NAME[s]}</button>)}</div>}
        <p className="muted small" style={{ margin: 0 }}>Targets for {e.fy}. {X.note ?? ''}</p>
      </>}

      {cur === 'plastic' && <Plastic e={e} raw={raw} can={can} save={save} />}
      {cur === 'ewaste' && <Ewaste e={e} raw={raw} can={can} save={save} />}
      {cur === 'battery' && <Battery e={e} raw={raw} can={can} save={save} types={(X.battery?.types ?? []) as [string, string][]} />}
      {cur && <ReturnCard stream={cur} r={pos(cur).return} fy={fy} portal={X.returns?.[cur]?.portal} checks={(raw.checks ?? {})[cur] ?? {}} can={can}
        onCheck={(k, v) => save({ checks: { ...(raw.checks ?? {}), [cur]: { ...((raw.checks ?? {})[cur] ?? {}), [k]: v } } })} />}
    </>);
}

/** A labelled field in the ru-grid. */
const F = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => <label className={wide ? 'wide' : ''}><span>{label}</span>{children}</label>;
const Reg = ({ on, can, onChange, label }: { on: boolean; can: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="ru-chk"><input type="checkbox" disabled={!can} checked={on} onChange={(ev) => onChange(ev.target.checked)} /> {label}</label>);

function Position({ need, bought, gap, unit, fmt, children }: { need: number; bought: number; gap: number; unit: string; fmt: (v: number) => string; children?: ReactNode }) {
  const pct = need > 0 ? Math.min(100, (bought / need) * 100) : 0;
  return (
    <div className="card"><h2>Your position</h2>
      {need > 0 ? <>
        <div className={`cmp-prog${gap > 0 ? ' warn' : ''}`} style={{ marginTop: 12 }}><b style={{ width: `${pct}%` }} /></div>
        <div className="cmp-progl"><span>{fmt(bought)} {unit} bought</span><span>{fmt(need)} {unit} needed</span></div>
      </> : <p className="cmp-sub">Enter your quantities to see what you need to cover.</p>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>);
}

// ------------------------------------------------------------------ plastic --
function Plastic({ e, raw, can, save }: { e: any; raw: any; can: boolean; save: (x: Record<string, any>) => void }) {
  const P = e.plastic, legacy = !P.perCategory && n(raw.bought) > 0;
  return (
    <div className="sme-grid2">
      <div className="card">
        <div className="cmp-h2row"><h2>Plastic packaging</h2></div>
        <div className="ru-grid">
          <F label="Your role"><select className="input" disabled={!can} value={raw.role ?? ''} onChange={(ev) => save({ role: ev.target.value })}>{ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></F>
          <F label="EPR target (% of the quantity)"><input className="input num" type="number" min={0} max={100} disabled={!can} value={raw.target ?? ''} placeholder={String(e.target)} onChange={(ev) => save({ target: numIn(ev.target.value) })} /></F>
          <div className="wide"><Reg on={!!raw.registered} can={can} label="Registered on the CPCB EPR portal (plastic packaging)" onChange={(v) => save({ registered: v })} /></div>
        </div>
        <p className="cmp-sub" style={{ marginTop: 12 }}>Quantity: the plastic packaging your EPR target is based on, in tonnes, as on the CPCB portal (it works this out from what you placed on the market). Certificates: bought from registered plastic waste processors.</p>
        <div className="sme-scroll"><table className="sme-tbl ru-tbl">
          <thead><tr><th>Category</th><th className="r">Quantity (t)</th><th className="r">Target (t)</th><th className="r">From recycling</th><th className="r">Certificates (t)</th><th className="r">Gap (t)</th></tr></thead>
          <tbody>{P.cats.map((c: any, i: number) => (
            <tr key={c.key}>
              <td className="wide"><b>{c.label.split(':')[0]}</b><br /><small className="muted">{c.label.split(': ')[1]}</small></td>
              <td><input className="input num" type="number" min={0} step="any" aria-label={`${c.label} quantity`} disabled={!can} value={raw[c.key] ?? ''} onChange={(ev) => save({ [c.key]: numIn(ev.target.value) })} /></td>
              <td className="r">{f1(c.need)}</td>
              <td className="r">{c.recyclingPct ? <>{f1(c.recyclingMin)} <small className="muted">({c.recyclingPct}%)</small></> : '—'}</td>
              <td><input className="input num" type="number" min={0} step="any" aria-label={`${c.label} certificates`} disabled={!can} value={raw[`b${i + 1}`] ?? ''} onChange={(ev) => save({ [`b${i + 1}`]: numIn(ev.target.value) })} /></td>
              <td className="r">{P.perCategory ? (c.gap > 0 ? <b>{f1(c.gap)}</b> : '0.0') : '—'}</td>
            </tr>))}</tbody>
          <tfoot><tr><td>Total</td><td className="r">{f1(P.total)}</td><td className="r">{f1(P.need)}</td><td className="r">{f1(P.recyclingMin)}</td><td className="r">{f1(P.bought)}</td><td className="r">{f1(P.gap)}</td></tr></tfoot>
        </table></div>
        {legacy && <p className="note warn small" style={{ marginTop: 10 }}>You entered {f1(raw.bought)} t of certificates in total earlier. Enter them per category: a surplus in one category does not cover another.</p>}
        <p className="muted small" style={{ margin: '10px 0 0' }}>“From recycling” is the least part of the target that must be met with recycling certificates this year; the rest can come from end-of-life processing. Recycled-content and reuse targets also apply to brand owners and producers.</p>
      </div>
      <div className="cmp-stack">
        <Position need={P.need} bought={P.bought} gap={P.gap} unit="t" fmt={f1}>
          {!P.registered ? <div className="sme-callout warn">Register on the CPCB centralised EPR portal before you file the annual return. Selling without registration can attract environmental compensation.</div>
            : P.gap > 0 ? <div className="sme-callout warn">Buy <b>{f1(P.gap)} t</b> of EPR certificates{P.perCategory ? ' in the categories with a gap' : ''} before the annual return.</div>
            : P.need > 0 ? <div className="sme-callout">Your plastic EPR target is covered for this year.</div> : null}
        </Position>
        <div className="card"><h2>Certificates</h2><p className="cmp-sub">Attach the certificate transfer statements from the portal.</p><Evidence module="epr" item="plastic-certs" label="Statements" /></div>
      </div>
    </div>);
}

// ------------------------------------------------------------------ e-waste --
function Ewaste({ e, raw, can, save }: { e: any; raw: any; can: boolean; save: (x: Record<string, any>) => void }) {
  const W = e.ewaste, ew = raw.ewaste ?? {};
  const up = (k: string, v: unknown) => save({ ewaste: { ...ew, [k]: v } });
  return (
    <div className="sme-grid2">
      <div className="card">
        <h2>E-waste</h2>
        <div className="ru-grid">
          <div className="wide"><Reg on={!!ew.registered} can={can} label="Registered on the CPCB e-waste EPR portal" onChange={(v) => up('registered', v)} /></div>
          <F label="Estimated e-waste for the year (kg)"><input className="input num" type="number" min={0} step="any" disabled={!can} value={ew.basis ?? ''} onChange={(ev) => up('basis', numIn(ev.target.value))} /></F>
          <F label="EPR certificates bought (kg)"><input className="input num" type="number" min={0} step="any" disabled={!can} value={ew.bought ?? ''} onChange={(ev) => up('bought', numIn(ev.target.value))} /></F>
        </div>
        <p className="cmp-sub" style={{ marginTop: 10 }}>The estimated e-waste is worked out on the CPCB portal from what you sold in earlier years and each item’s average life. Copy it from your EPR target there.</p>
        <dl className="ru-sums">
          <dt>Target for the year</dt><dd>{W.rate}% of the estimate</dd>
          <dt>Certificates needed</dt><dd>{f0(W.need)} kg</dd>
          <dt>Bought</dt><dd>{f0(W.bought)} kg</dd>
          <dt className="tot">Gap</dt><dd className="tot">{f0(W.gap)} kg</dd>
        </dl>
      </div>
      <div className="cmp-stack">
        <Position need={W.need} bought={W.bought} gap={W.gap} unit="kg" fmt={f0}>
          {!W.registered ? <div className="sme-callout warn">Register on the CPCB e-waste EPR portal. Producers must be registered before selling listed items.</div>
            : W.gap > 0 ? <div className="sme-callout warn">Buy <b>{f0(W.gap)} kg</b> of EPR certificates from registered recyclers. CPCB sets a minimum price for them (about ₹22 a kg for most consumer electronics; under challenge in court).</div>
            : W.need > 0 ? <div className="sme-callout">Your e-waste target is covered for this year.</div> : null}
        </Position>
        <div className="card"><h2>Certificates</h2><Evidence module="epr" item="ewaste-certs" label="Statements" /></div>
      </div>
    </div>);
}

// ------------------------------------------------------------------ batteries --
function Battery({ e, raw, can, save, types }: { e: any; raw: any; can: boolean; save: (x: Record<string, any>) => void; types: [string, string][] }) {
  const B = e.battery, bt = raw.battery ?? {};
  const rows: { id: string; type: string; basis: number | ''; bought: number | '' }[] = Array.isArray(bt.rows) ? bt.rows : [];
  const put = (next: Record<string, any>) => save({ battery: { ...bt, ...next } });
  const upd = (id: string, k: string, v: unknown) => put({ rows: rows.map((r) => (r.id === id ? { ...r, [k]: v } : r)) });
  return (
    <div className="sme-grid2">
      <div className="card">
        <div className="cmp-h2row"><h2>Batteries</h2>{can && <button type="button" className="btn sm" onClick={() => put({ rows: [...rows, { id: uid(), type: types[0]?.[0] ?? 'portable', basis: '', bought: '' }] })}>+ Add a battery type</button>}</div>
        <Reg on={!!bt.registered} can={can} label="Registered on the CPCB battery EPR portal" onChange={(v) => put({ registered: v })} />
        <p className="cmp-sub">One row for each battery type. The target is a share of what you placed on the market in an earlier year the rules name (the basis year).</p>
        {!rows.length ? <p className="muted" style={{ margin: '8px 0 0' }}>No battery types added yet.</p> : (
          <div className="sme-scroll"><table className="sme-tbl ru-tbl">
            <thead><tr><th>Type</th><th className="r">Sold in basis year (kg)</th><th className="r">Target</th><th className="r">Needed (kg)</th><th className="r">Certificates (kg)</th><th className="r">Gap (kg)</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => {
              const x = B.rows[i] ?? {};
              return (
                <tr key={r.id}>
                  <td className="wide"><select className="input" aria-label="Battery type" disabled={!can} value={r.type} onChange={(ev) => upd(r.id, 'type', ev.target.value)}>{types.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></td>
                  <td><input className="input num" type="number" min={0} step="any" aria-label="Sold in basis year" disabled={!can} value={r.basis} onChange={(ev) => upd(r.id, 'basis', numIn(ev.target.value))} /></td>
                  <td className="r">{x.noTarget ? <small className="muted">No target this year</small> : x.pct === undefined ? '…' : <>{x.pct}%<br /><small className="muted">of {x.basisYear}</small></>}</td>
                  <td className="r">{f0(x.need)}</td>
                  <td><input className="input num" type="number" min={0} step="any" aria-label="Certificates bought" disabled={!can} value={r.bought} onChange={(ev) => upd(r.id, 'bought', numIn(ev.target.value))} /></td>
                  <td className="r">{x.gap > 0 ? <b>{f0(x.gap)}</b> : '0'}</td>
                  <td>{can && <button type="button" className="ru-x" aria-label="Remove" onClick={() => put({ rows: rows.filter((y) => y.id !== r.id) })}>✕</button>}</td>
                </tr>);
            })}</tbody>
            <tfoot><tr><td>Total</td><td /><td /><td className="r">{f0(B.need)}</td><td className="r">{f0(B.bought)}</td><td className="r">{f0(B.gap)}</td><td /></tr></tfoot>
          </table></div>)}
      </div>
      <div className="cmp-stack">
        <Position need={B.need} bought={B.bought} gap={B.gap} unit="kg" fmt={f0}>
          {!B.registered ? <div className="sme-callout warn">Register on the CPCB battery EPR portal before you sell batteries or goods with batteries.</div>
            : B.gap > 0 ? <div className="sme-callout warn">Buy <b>{f0(B.gap)} kg</b> of EPR certificates from registered recyclers or refurbishers.</div>
            : B.need > 0 ? <div className="sme-callout">Your battery collection target is covered for this year.</div> : null}
        </Position>
        <div className="card"><h2>Certificates</h2><Evidence module="epr" item="battery-certs" label="Statements" /></div>
      </div>
    </div>);
}

// ------------------------------------------------------------------ annual return --
function ReturnCard({ stream, r, fy, portal, checks, can, onCheck }: { stream: Stream; r: { due: string; usual: string; extended: boolean }; fy: string; portal?: string; checks: Record<string, boolean>; can: boolean; onCheck: (k: string, v: boolean) => void }) {
  const list = CHECKS[stream], done = list.filter(([k]) => checks[k]).length;
  const days = Math.round((Date.parse(`${r.due}T00:00:00`) - Date.now()) / 864e5);
  const filed = !!checks.filed;
  return (
    <div className="card">
      <div className="cmp-h2row"><h2>{NAME[stream]}: annual return for {fy}</h2><span className="muted">{done} of {list.length}</span></div>
      <div className="ru-due">
        <span>Due</span><b>{dmy(r.due)}</b>
        {r.extended && <span className="muted">extended from {dmy(r.usual)}</span>}
        {filed ? <Pill kind="done">Filed</Pill> : days < 0 ? <Pill kind="overdue">Overdue</Pill> : days <= 45 ? <Pill kind="soon">{days} days left</Pill> : null}
        {portal && <a className="small" href={portal} target="_blank" rel="noopener noreferrer">CPCB portal ↗</a>}
      </div>
      <div className="ru-checks">{list.map(([k, t]) => (
        <label key={k} className={`ru-check${checks[k] ? ' on' : ''}`}><input type="checkbox" disabled={!can} checked={!!checks[k]} onChange={(ev) => onCheck(k, ev.target.checked)} /><span>{t}</span></label>))}</div>
      <div style={{ marginTop: 10 }}><Evidence module="epr" item={`${stream}-return`} label="Acknowledgement" /></div>
    </div>);
}
