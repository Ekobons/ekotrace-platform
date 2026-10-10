/**
 * Choosing a spend category (EPA NAICS commodity, or the company's own list): type to search
 * (name, NAICS code, old Ekotrace names); the matcher's candidates are offered first.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type SpendItem } from '../lib/api';

export function ItemPicker({ value, valueName, candidates, onPick, placeholder = 'Search spend categories…', autoFocus, compact }: {
  value: number | null; valueName?: string | null; candidates?: { itemId: number; name?: string; score?: number }[];
  onPick: (item: { id: number; name: string } | null) => void; placeholder?: string; autoFocus?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(!!autoFocus);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SpendItem[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { if (q.trim().length >= 2) api.spendItems(q.trim(), 25).then((r) => setItems(r.items)).catch(() => setItems([])); else setItems([]); }, 200);
    return () => window.clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (id: number, name: string) => { onPick({ id, name }); setOpen(false); setQ(''); };
  const cands = (candidates ?? []).filter((c) => c.name && c.itemId !== value);

  return (
    <div className={`ipick ${compact ? 'compact' : ''}`} ref={box}>
      {!open ? (
        <button type="button" className={`ipick-btn ${value ? '' : 'empty'}`} onClick={() => setOpen(true)} title="Change the spend category">
          {value ? valueName ?? `#${value}` : 'Choose a category…'}
        </button>
      ) : (
        <div className="ipick-pop">
          <input className="input sm" autoFocus placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
          <div className="ipick-list">
            {!q && cands.length > 0 && <div className="ipick-h">Suggested</div>}
            {!q && cands.map((c) => <button type="button" key={c.itemId} onClick={() => pick(c.itemId, c.name!)}>{c.name}</button>)}
            {q && items.map((i) => (
              <button type="button" key={i.id} onClick={() => pick(i.id, i.name)}>
                {i.name}<span className="muted small">{i.group ? ` · ${i.group}` : ''}{i.naics ? ` · NAICS ${i.naics}` : ''}{i.co2e != null ? ` · ${Number(i.co2e.toPrecision(3))} kg/${i.unit}${i.price_year ? ` ${i.price_year}` : ''}` : ''}{i.source === 'DEMO-SPEND' ? ' · DEMO' : ''}</span>
              </button>
            ))}
            {q.trim().length >= 2 && !items.length && <div className="ipick-h">Nothing found</div>}
            {!q && !cands.length && <div className="ipick-h">Type at least 2 letters (name or NAICS code)</div>}
            {value && <button type="button" className="muted" onClick={() => { onPick(null); setOpen(false); }}>Clear the category</button>}
          </div>
        </div>
      )}
    </div>
  );
}
