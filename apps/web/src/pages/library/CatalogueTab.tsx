/**
 * Categories & items: the admin edits the list users pick from.
 *  - Subcategories: add, rename, choose the units offered and the default unit, switch off / remove.
 *  - Items: add, rename, move to another subcategory, default unit, aliases, switch off / remove.
 *  - "Shown for <company>": hide a subcategory or item for the selected company only.
 * Removing something in use switches it off instead (history stays valid).
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../App';
import { api, type Category, type Item, type Subcategory, type Unit } from '../../lib/api';

export function CatalogueTab() {
  const { tenant, toast } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [catId, setCatId] = useState<number | null>(null);
  const [subId, setSubId] = useState<number | null>(null);
  const [hidden, setHidden] = useState<{ subs: Set<number>; items: Set<number> }>({ subs: new Set(), items: new Set() });
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const all = (await api.catalogue(true)).categories;
    setCats(all);
    setCatId((id) => id ?? all[0]?.id ?? null);
    if (tenant) {
      const mine = (await api.catalogue()).categories;
      const visibleSubs = new Set(mine.flatMap((c) => c.subcategories.map((s) => s.id)));
      const visibleItems = new Set(mine.flatMap((c) => c.subcategories.flatMap((s) => s.items.map((i) => i.id))));
      setHidden({
        subs: new Set(all.flatMap((c) => c.subcategories.filter((s) => s.active && !visibleSubs.has(s.id)).map((s) => s.id))),
        items: new Set(all.flatMap((c) => c.subcategories.flatMap((s) => s.items.filter((i) => i.active && visibleSubs.has(s.id) && !visibleItems.has(i.id)).map((i) => i.id)))),
      });
    }
  };
  useEffect(() => { load(); api.units().then((u) => setUnits(u.units)); }, [tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cat = cats.find((c) => c.id === catId) ?? null;
  const sub = cat?.subcategories.find((s) => s.id === subId) ?? cat?.subcategories[0] ?? null;
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    try { const r = await fn() as { message?: string } | undefined; toast(r?.message ?? ok ?? 'Saved'); await load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <div className="seg">{cats.map((c) => <button key={c.id} className={c.id === catId ? 'on' : ''} onClick={() => { setCatId(c.id); setSubId(null); }}>Scope {c.scope} · {c.name}</button>)}</div>
        <div className="grow" />
        {tenant ? <span className="chip info">Visibility switches apply to {tenant.name}</span> : <span className="chip grey">Choose a company to set what it sees</span>}
      </div>
      {err && <div className="note bad">{err}</div>}
      {cat && (
        <div className="grid2">
          <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div className="eyebrow" style={{ padding: '4px 8px' }}>Subcategories</div>
            <div className="list">
              {cat.subcategories.map((s) => (
                <button key={s.id} className={`${s.id === sub?.id ? 'on' : ''} ${s.active ? '' : 'off'}`} onClick={() => setSubId(s.id)}>
                  <span>{s.name}</span>
                  <span className="meta">{!s.active ? 'off' : hidden.subs.has(s.id) ? 'hidden' : s.items.filter((i) => i.active).length}</span>
                </button>
              ))}
            </div>
            <NewSub cat={cat} onAdd={(b) => run(() => api.addSubcategory(b), 'Subcategory added')} />
          </div>
          {sub && <SubEditor key={sub.id} cat={cat} sub={sub} units={units} tenantName={tenant?.name} hidden={hidden} run={run} />}
        </div>
      )}
    </div>
  );
}

function NewSub({ cat, onAdd }: { cat: Category; onAdd: (b: unknown) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="row" style={{ padding: '8px 4px 0', borderTop: '1px solid var(--line)' }}>
      <input className="input grow" placeholder="New subcategory name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn sm" disabled={name.trim().length < 2} onClick={() => {
        onAdd({ categoryId: cat.id, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60), name: name.trim(), units: [] });
        setName('');
      }}>Add</button>
    </div>
  );
}

function SubEditor({ cat, sub, units, tenantName, hidden, run }: {
  cat: Category; sub: Subcategory; units: Unit[]; tenantName?: string; hidden: { subs: Set<number>; items: Set<number> };
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const [name, setName] = useState(sub.name);
  const [chosen, setChosen] = useState<string[]>(sub.units);
  const [def, setDef] = useState(sub.default_unit ?? '');
  const [newItem, setNewItem] = useState('');
  const dims = [...new Set(units.map((u) => u.dimension))];

  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <div className="row">
        <label className="field grow"><span>Subcategory name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Default unit</span>
          <select className="input" value={def} onChange={(e) => setDef(e.target.value)}><option value="">—</option>{chosen.map((c) => <option key={c} value={c}>{units.find((u) => u.code === c)?.name ?? c}</option>)}</select>
        </label>
      </div>
      <div className="field">
        <span>Units offered in data entry (click to switch on/off; none ticked = all units the item has factors for)</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {dims.map((d) => (
            <div key={d} className="row" style={{ gap: 6 }}>
              <span className="sub" style={{ width: 100 }}>{d.replace('_', ' ')}</span>
              {units.filter((u) => u.dimension === d).map((u) => {
                const on = chosen.includes(u.code);
                return <button key={u.code} className={`chip ${on ? '' : 'grey'}`} style={{ border: 0, cursor: 'pointer' }}
                  onClick={() => setChosen(on ? chosen.filter((c) => c !== u.code) : [...chosen, u.code])}>{u.name}</button>;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn p" onClick={() => run(() => api.updateSubcategory(sub.id, { name, units: chosen, defaultUnit: def || null }))}>Save subcategory</button>
        <button className="btn" onClick={() => run(() => api.updateSubcategory(sub.id, { active: !sub.active }), sub.active ? 'Switched off' : 'Switched on')}>{sub.active ? 'Switch off' : 'Switch on'}</button>
        <button className="btn danger" onClick={() => run(() => api.removeSubcategory(sub.id), 'Removed')}>Remove</button>
        <div className="grow" />
        {tenantName && sub.active && (
          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={!hidden.subs.has(sub.id)} onChange={(e) => run(() => api.setVisibility({ subcategoryId: sub.id, enabled: e.target.checked }))} />
            Shown for {tenantName}
          </label>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }}>
        <div className="row"><h3 className="grow">Items · {sub.items.length}</h3>
          <input className="input" placeholder="New item name" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button className="btn sm" disabled={!newItem.trim()} onClick={() => { run(() => api.addItem({ subcategoryId: sub.id, name: newItem.trim() }), 'Item added — now add its factors in the Factors tab'); setNewItem(''); }}>Add item</button>
        </div>
        <div className="scroll" style={{ maxHeight: 460 }}>
          <table className="t">
            <thead><tr><th>Name</th><th>Move to</th><th>Default unit</th><th>Status</th>{tenantName && <th>Shown</th>}<th /></tr></thead>
            <tbody>{sub.items.map((i) => <ItemRow key={i.id} i={i} cat={cat} units={units} shown={!hidden.items.has(i.id)} tenantName={tenantName} run={run} />)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ i, cat, units, shown, tenantName, run }: { i: Item; cat: Category; units: Unit[]; shown: boolean; tenantName?: string; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [name, setName] = useState(i.name);
  return (
    <tr className={i.active ? '' : 'off'}>
      <td style={{ minWidth: 220 }}><input className="input" style={{ width: '100%', height: 32 }} value={name} onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== i.name && name.trim() && run(() => api.updateItem(i.id, { name: name.trim() }), 'Renamed')} />
        {i.aliases.length > 0 && <div className="sub" style={{ fontSize: 11.5 }}>aka {i.aliases.join(', ')}</div>}</td>
      <td><select className="input" style={{ height: 32, width: 140 }} value={i.subcategory_id} onChange={(e) => run(() => api.updateItem(i.id, { subcategoryId: Number(e.target.value) }), 'Moved')}>
        {cat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
      <td><select className="input" style={{ height: 32, width: 130 }} value={i.default_unit ?? ''} onChange={(e) => run(() => api.updateItem(i.id, { defaultUnit: e.target.value || null }))}>
        <option value="">(class default)</option>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></td>
      <td>{i.active ? <span className="chip">on</span> : <span className="chip grey">off</span>}</td>
      {tenantName && <td><input type="checkbox" checked={shown} disabled={!i.active} onChange={(e) => run(() => api.setVisibility({ itemId: i.id, enabled: e.target.checked }))} /></td>}
      <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
        <button className="btn sm ghost" title={i.active ? 'Switch off: hidden from data entry' : 'Switch on'} onClick={() => run(() => api.updateItem(i.id, { active: !i.active }), i.active ? 'Switched off' : 'Switched on')}>{i.active ? 'Off' : 'On'}</button>
        <button className="btn sm ghost danger" title="Remove (switched off instead if it is in use)" onClick={() => run(() => api.removeItem(i.id), 'Removed')}>✕</button>
      </div></td>
    </tr>
  );
}
