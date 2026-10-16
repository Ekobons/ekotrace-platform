/**
 * Pick a country by its name (the tool stores the two-letter code). Common countries first, then A–Z;
 * typing the first letters in the list jumps to the country. Optional extra choices (e.g. "Global").
 * CityInput suggests cities of the chosen country as you type (free text still accepted).
 */
import { useEffect, useId, useState } from 'react';
import { COMMON, COUNTRIES, countryLabel } from '../lib/countries';
import { api } from '../lib/api';

export function CountrySelect({ value, onChange, empty, extra, disabled, className = 'input', ariaLabel }: {
  value: string; onChange: (code: string) => void;
  /** text of an empty choice (e.g. "Not known"); without it a country must be chosen */
  empty?: string;
  /** choices shown before the countries, e.g. [['GLOBAL', 'Global (all countries)']] */
  extra?: [string, string][];
  disabled?: boolean; className?: string; ariaLabel?: string;
}) {
  const v = (value ?? '').toUpperCase();
  const known = !v || COUNTRIES.some(([c]) => c === v) || extra?.some(([c]) => c === v);
  return (
    <select className={className} value={v} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      {(empty !== undefined || !v) && <option value="">{empty ?? 'Choose a country…'}</option>}
      {!known && <option value={v}>{v}</option>}
      {extra?.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      <optgroup label="Common">{COMMON.map((c) => <option key={'c' + c} value={c}>{countryLabel(c)}</option>)}</optgroup>
      <optgroup label="All countries">{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
    </select>
  );
}

export function CityInput({ country, value, onChange, placeholder = 'e.g. Sharjah', disabled }: { country?: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  const [hits, setHits] = useState<string[]>([]);
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setHits([]); return; }
    const t = window.setTimeout(() => { api.cities(q, country).then((r) => setHits(r.cities)).catch(() => setHits([])); }, 200);
    return () => window.clearTimeout(t);
  }, [value, country]);
  return <>
    <input className="input" list={id} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    <datalist id={id}>{hits.map((c) => <option key={c} value={c} />)}</datalist>
  </>;
}
