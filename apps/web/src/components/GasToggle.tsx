/**
 * "Show split by gas" toggle. CO2e totals are always shown; the per-gas
 * breakdown sits below them, closed by default. The choice is remembered
 * on this browser.
 */
import { useState } from 'react';
import { Icon } from './Icon';

const KEY = 'eko.showGas';

export function useGasSplit(): [boolean, () => void] {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? '0' : '1'); } catch { /* ignore */ } return !o; });
  return [open, toggle];
}

export function GasToggle({ open, onToggle, count }: { open: boolean; onToggle: () => void; count: number }) {
  return (
    <button className="btn ghost sm disclose" aria-expanded={open} onClick={onToggle}>
      <Icon name="down" /> {open ? 'Hide' : 'Show'} split by gas{count ? ` (${count} ${count === 1 ? 'gas' : 'gases'})` : ''}
    </button>
  );
}
