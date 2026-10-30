/**
 * English / Hindi for the EKOTRACE SME screens. English is the default and the key:
 *   t('Emissions')                                → 'उत्सर्जन' in Hindi
 *   t('{n} of {total} done', { n: 2, total: 5 })  → '5 में से 2 पूरे'
 * Text missing from the Hindi dictionary (hi.ts) simply stays English.
 * The choice is kept on this browser (there is no per-user setting on the server yet).
 * Every screen that shows SME text re-renders on a change because the SME frame, the menu and the
 * sign-in page subscribe with useLang(); plain t() calls inside them read the current language.
 */
import { Fragment, createElement, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { HI } from './hi';
import './i18n.css';

export type Lang = 'en' | 'hi';
const KEY = 'eko_sme_lang';
const read = (): Lang => { try { return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } };
let cur: Lang = read();
const subs = new Set<() => void>();

export function setLang(l: Lang) {
  if (l === cur) return;
  cur = l;
  try { localStorage.setItem(KEY, l); } catch { /* not kept on this browser */ }
  subs.forEach((f) => f());
}
export const getLang = () => cur;
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

type Vars = Record<string, string | number | null | undefined>;
const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] === undefined || v[k] === null ? m : String(v[k]))) : s);

/** 'Change|column' is the key for one meaning of a word; in English (or when not translated) the part after | is dropped. */
const pick = (s: string) => (cur === 'hi' && HI[s] !== undefined ? HI[s]! : s.includes('|') ? s.slice(0, s.indexOf('|')) : s);

/** The text in the chosen language, with {placeholders} filled in. */
export function t(s: string | null | undefined, vars?: Vars): string {
  if (s === null || s === undefined) return '';
  return fill(pick(s), vars);
}
/** Like t(), with placeholders that may be elements: tn('{n} of {total} have proof', { n: <b>2</b>, total: 7 }). */
export function tn(s: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = pick(s).split(/\{(\w+)\}/);
  return createElement(Fragment, null, ...parts.map((p: string, i: number) => (i % 2 ? createElement(Fragment, { key: i }, p in vars ? vars[p] : `{${p}}`) : p)));
}
/** Like t(), for a value that may not be text (passed through unchanged). */
export function tx<T>(s: T): T { return (typeof s === 'string' ? t(s) : s) as T; }

/** The language and its setter; re-renders the caller when the language changes. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, getLang, () => 'en' as Lang);
  return { lang, setLang, t };
}

/** Sets <html lang> while an SME screen is open (Hindi text then gets Devanagari fonts and spacing). */
export function useHtmlLang(active = true) {
  const { lang } = useLang();
  useEffect(() => {
    if (!active) return;
    const el = document.documentElement, before = el.lang || 'en';
    el.lang = lang === 'hi' ? 'hi' : 'en';
    return () => { el.lang = before; };
  }, [lang, active]);
}

/** "English | हिंदी" */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang } = useLang();
  return (
    <div className={`sme-lang ${className}`} role="group" aria-label="Language / भाषा">
      <button type="button" lang="en" aria-pressed={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
      <button type="button" lang="hi" aria-pressed={lang === 'hi'} className={lang === 'hi' ? 'on' : ''} onClick={() => setLang('hi')}>हिंदी</button>
    </div>);
}
