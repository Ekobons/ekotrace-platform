/**
 * Building blocks of the SME screens: page heading, figure tiles, status pills and form fields
 * bound to the SME store. Built on the platform's own classes (card, field, input, btn, pill…).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useId, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { SME_PAGES, groupOf } from './nav';

/** Heading of an SME page: icon, section, financial year, save state. */
export function SmeHead({ title, lede, children }: { title?: string; lede?: string; children?: ReactNode }) {
  const { fy, saving } = useSme();
  const key = useLocation().pathname.split('/')[2] ?? 'home';
  const p = SME_PAGES[key] ?? { title: 'EKOTRACE SME', icon: 'leaf' };
  return (
    <div className="sme-head">
      <div className="sme-picon"><Icon name={p.icon} /></div>
      <div className="grow">
        <span className="lbl">{groupOf(key).title} · {fy}{saving === 'saving' ? ' · Saving…' : saving === 'saved' ? ' · Saved' : saving === 'error' ? ' · Not saved' : ''}</span>
        <h1>{title ?? p.title}</h1>
        {lede && <p className="muted sme-lede">{lede}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>);
}

export function Kpi({ label, value, unit, good }: { label: string; value: ReactNode; unit?: ReactNode; good?: boolean }) {
  return <div className={`sme-kpi${good ? ' good' : ''}`}><span className="lbl">{label}</span><b className="num">{value}</b>{unit && <small>{unit}</small>}</div>;
}
export function Kpis({ children }: { children: ReactNode }) { return <div className="sme-kpis">{children}</div>; }

/** Status pill. apply / overdue = act now · likely / soon = check · watch / later = for information · good / done = fine */
export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  const cls = ['apply', 'overdue'].includes(kind) ? 'bad' : ['likely', 'soon'].includes(kind) ? 'warn' : ['good', 'done'].includes(kind) ? 'ok' : 'grey';
  return <span className={`chip ${cls === "ok" ? "" : cls}`}>{children}</span>;
}

/** Marks figures that are examples, never the user's own. */
export const Sample = () => <span className="chip warn sme-sample">Sample</span>;

/** Number bound to a store path. */
export function Num({ path, label, unit, hint, out, placeholder, min = 0 }: { path: string; label: string; unit?: string; hint?: string; out?: string; placeholder?: string; min?: number }) {
  const { get, set, d } = useSme(); const id = useId();
  const v = get(path);
  return (
    <div className="sme-field">
      <label htmlFor={id}>{label}{hint && <small>{hint}</small>}</label>
      <div className="sme-unit">
        <input id={id} className="input num" type="number" inputMode="decimal" step="any" min={min} disabled={!d?.canEdit} placeholder={placeholder}
          value={v === undefined || v === null ? '' : v} onChange={(e) => set(path, e.target.value === '' ? '' : Number(e.target.value))} />
        {unit && <span>{unit}</span>}
      </div>
      {out && <div className="sme-out">{out}</div>}
    </div>);
}
/** On/off bound to a store path. */
export function Toggle({ path, label, hint, disabled }: { path: string; label: string; hint?: string; disabled?: boolean }) {
  const { get, set, d } = useSme(); const id = useId();
  return (
    <div className="sme-toggle">
      <label htmlFor={id}>{label}{hint && <small>{hint}</small>}</label>
      <span className="sme-sw"><input id={id} type="checkbox" disabled={disabled || !d?.canEdit} checked={!!get(path)} onChange={(e) => set(path, e.target.checked)} /><i /></span>
    </div>);
}
/** Choice bound to a store path. */
export function Choice({ path, label, options, hint }: { path: string; label: string; options: [string, string][]; hint?: string }) {
  const { get, set, d } = useSme(); const id = useId();
  return (
    <div className="sme-field">
      <label htmlFor={id}>{label}{hint && <small>{hint}</small>}</label>
      <select id={id} className="input" disabled={!d?.canEdit} value={get(path) ?? ''} onChange={(e) => set(path, e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>);
}
/** Text or date bound to a store path. */
export function Text({ path, label, type = 'text' }: { path: string; label: string; type?: 'text' | 'date' }) {
  const { get, set, d } = useSme(); const id = useId();
  return (
    <div className={`sme-field${type === 'text' ? ' wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} disabled={!d?.canEdit} value={get(path) ?? ''} onChange={(e) => set(path, e.target.value)} />
    </div>);
}

/** A "Requirement"-style row: title, pill, text, next step. */
export function Req({ title, pill, kind, children, action }: { title: ReactNode; pill?: ReactNode; kind?: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="sme-req"><h3>{title}</h3>{pill && <Pill kind={kind ?? 'watch'}>{pill}</Pill>}{children && <p>{children}</p>}{action && <div className="sme-act">{action}</div>}</div>;
}

/** Copy text to the clipboard (inside the click), falling back to selecting it. */
export async function copyText(text: string, el?: HTMLElement | null): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    return false;
  }
}
