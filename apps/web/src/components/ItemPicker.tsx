/**
 * Choosing a spend category: the matcher's candidates first; browse the Ekotrace list (category › subcategory ›
 * product, each with the EPA factor of its NAICS code); or type to search (name, NAICS code, EPA names — Ekotrace
 * list products first).
 */
import { useEffect, useRef, useState } from 'react';
import { api, type SpendItem, type SpendTree } from '../lib/api';

let TREE: Promise<SpendTree> | null = null;
const TYPE_SHORT: Record<string, string> = { 'Standard Goods': 'goods', 'Standard Services': 'services', 'Capital Goods': 'capital goods' };
const fmtF = (co2e: number | null, unit: string | null, py: number | null) => (co2e != null ? ` · ${Number(co2e.toPrecision(3))} kg/${unit}${py ? ` ${py}` : ''}` : '');

export function ItemPicker({ value, valueName, candidates, onPick, placeholder = 'Search spend categories…', autoFocus, compact }: {
  value: number | null; valueName?: string | null; candidates?: { itemId: number; name?: string; score?: number }[];
  onPick: (item: { id: number; name: string } | null) => void; placeholder?: string; autoFocus?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(!!autoFocus);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SpendItem[]>([]);
  const [tree, setTree] = useState<SpendTree | null>(null);
  const [path, setPath] = useState<[string?, string?] | null>(null);
  const browse = () => { setPath([]); (TREE ??= api.spendTree()).then(setTree).catch(() => { TREE = null; }); };
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
  const pick = (id: number, name: string) => { onPick({ id, name }); setOpen(false); setQ(''); setPath(null); };
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
            {!q && path && <BrowseList tree={tree} path={path} setPath={setPath} pick={pick} />}
            {!q && !path && <>
              {cands.length > 0 && <div className="ipick-h">Suggested</div>}
              {cands.map((c) => <button type="button" key={c.itemId} onClick={() => pick(c.itemId, c.name!)}>{c.name}</button>)}
              <button type="button" className="ipick-browse" onClick={browse}>Browse the Ekotrace list (category › subcategory › product) →</button>
              {!cands.length && <div className="ipick-h">or type at least 2 letters (name or NAICS code)</div>}
            </>}
            {q && items.map((i) => (
              <button type="button" key={i.id} onClick={() => pick(i.id, i.name)}>
                {i.name}<span className="muted small">{i.group ? ` · ${i.group}` : ''}{i.type ? ` · ${TYPE_SHORT[i.type] ?? i.type}` : ''}{!i.listed && i.naics ? ` · EPA NAICS ${i.naics}` : ''}{fmtF(i.co2e, i.unit, i.price_year)}{i.source === 'DEMO-SPEND' ? ' · DEMO' : ''}</span>
              </button>
            ))}
            {q.trim().length >= 2 && !items.length && <div className="ipick-h">Nothing found</div>}
            {value && <button type="button" className="muted" onClick={() => { onPick(null); setOpen(false); }}>Clear the category</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function BrowseList({ tree, path, setPath, pick }: { tree: SpendTree | null; path: [string?, string?]; setPath: (p: [string?, string?] | null) => void; pick: (id: number, name: string) => void }) {
  if (!tree) return <div className="ipick-h">Loading…</div>;
  const [cat, sub] = path;
  const c = cat ? tree.categories.find((x) => x.name === cat) : null;
  const s = c && sub ? c.subcategories.find((x) => x.name === sub) : null;
  return <>
    <div className="ipick-crumb">
      <button type="button" onClick={() => setPath(cat ? [] : null)}>← {cat ? 'All categories' : 'Back'}</button>
      {c && <button type="button" onClick={() => setPath([cat])}>{c.name}</button>}{s && <b> › {s.name}</b>}
    </div>
    {!c && tree.categories.map((x) => <button type="button" key={x.name} onClick={() => setPath([x.name])}>{x.name}<span className="muted small"> · {x.subcategories.reduce((n, y) => n + y.items.length, 0)}</span></button>)}
    {c && !s && c.subcategories.map((x) => <button type="button" key={x.name} onClick={() => setPath([cat, x.name])}>{x.name}<span className="muted small"> · {x.items.length}</span></button>)}
    {s && s.items.map((i) => <button type="button" key={i.id} onClick={() => pick(i.id, i.name)}>{i.name}<span className="muted small">{i.type ? ` · ${TYPE_SHORT[i.type] ?? i.type}` : ''}{fmtF(i.co2e, i.unit, i.price_year)}</span></button>)}
  </>;
}
