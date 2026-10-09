/**
 * Factors per item: pick an item on the left; the right shows every factor
 * (year × part × unit) with its gas split and source. "Add or correct" saves a
 * new version — the previous one stays in history.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../App';
import { api, BASIS_LABEL, BASIS_SHORT, num, type Basis, type Category, type Factor, type Unit } from '../../lib/api';

export function FactorsTab() {
  const { toast } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [subId, setSubId] = useState<number | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [year, setYear] = useState<number | ''>('');
  const [factors, setFactors] = useState<Factor[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [history, setHistory] = useState<{ id: number; rows: Awaited<ReturnType<typeof api.factorHistory>>['history'] } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.catalogue(true).then((c) => {
      setCats(c.categories);
      setCatId((id) => id ?? c.categories[0]?.id ?? null);
      setItemId((id) => id ?? c.categories[0]?.subcategories[0]?.items[0]?.id ?? null);
    });
    api.units().then((u) => setUnits(u.units));
  }, []);
  const load = () => { if (itemId) api.factors({ itemId, year: year || undefined, status: showAll ? 'all' : 'active', limit: 2000 }).then((r) => setFactors(r.factors)); };
  useEffect(load, [itemId, year, showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = cats.flatMap((c) => c.subcategories.flatMap((s) => s.items)).find((i) => i.id === itemId);
  const unitName = (c: string) => units.find((u) => u.code === c)?.name ?? c;
  const q = search.trim().toLowerCase();
  const cat = cats.find((c) => c.id === catId) ?? null;
  const match = (i: { name: string; aliases: string[] }) => !q || i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.toLowerCase().includes(q));
  /** Groups shown on the left: with a search, matches in every category; otherwise the chosen category (and subcategory). */
  const groups = useMemo(() => {
    const src = q ? cats.flatMap((c) => c.subcategories.map((s) => ({ c, s }))) : (cat?.subcategories ?? []).filter((s) => !subId || s.id === subId).map((s) => ({ c: cat!, s }));
    return src.map(({ c, s }) => ({ key: s.id, title: q ? `${c.name} › ${s.name}` : s.name, items: s.items.filter(match) })).filter((g) => g.items.length);
  }, [cats, cat, subId, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (c: Category) => c.subcategories.reduce((n, s) => n + s.items.length, 0);
  const pickCat = (id: number) => {
    setCatId(id); setSubId(null); setSearch('');
    const c = cats.find((x) => x.id === id);
    const first = c?.subcategories.flatMap((s) => s.items)[0];
    if (first && !c!.subcategories.some((s) => s.items.some((i) => i.id === itemId))) setItemId(first.id);
  };

  // Group rows by year for readability.
  const byYear = useMemo(() => {
    const m = new Map<string, Factor[]>();
    for (const f of factors) {
      const y = f.valid_from.slice(0, 4) === f.valid_to.slice(0, 4) ? f.valid_from.slice(0, 4) : `${f.valid_from.slice(0, 4)}–${f.valid_to.slice(0, 4)}`;
      m.set(y, [...(m.get(y) ?? []), f]);
    }
    return [...m.entries()];
  }, [factors]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="catchips">
        {[1, 2, 3].map((sc) => cats.some((c) => c.scope === sc) && (
          <div key={sc} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ width: 62 }}>Scope {sc}</span>
            {cats.filter((c) => c.scope === sc).map((c) => (
              <button key={c.id} className={`chipbtn ${c.id === catId && !q ? 'on' : ''}`} onClick={() => pickCat(c.id)}>
                {c.name}<span className="meta">{count(c)}</span></button>))}
          </div>))}
      </div>
    <div className="grid2">
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8, alignContent: 'start', maxHeight: 'calc(100vh - 260px)', overflow: 'auto', position: 'sticky', top: 12 }}>
        <input className="input" placeholder="Search every category…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!q && cat && cat.subcategories.length > 1 && (
          <select className="input" value={subId ?? ''} onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            setSubId(id);
            const sub = cat.subcategories.find((x) => x.id === id);
            if (sub && !sub.items.some((i) => i.id === itemId) && sub.items[0]) setItemId(sub.items[0].id);
          }}>
            <option value="">All {cat.name.toLowerCase()} ({count(cat)})</option>
            {cat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.items.length})</option>)}
          </select>
        )}
        {q && <div className="sub" style={{ padding: '0 4px' }}>{groups.reduce((n, g) => n + g.items.length, 0)} found in all categories</div>}
        {groups.map((g) => (
          <div key={g.key} className="list">
            <div className="sub" style={{ padding: '6px 10px 2px', fontWeight: 600 }}>{g.title}</div>
            {g.items.map((i) => (
              <button key={i.id} className={`${i.id === itemId ? 'on' : ''} ${i.active ? '' : 'off'}`} onClick={() => setItemId(i.id)}>
                <span>{i.name}</span>{!i.active && <span className="meta">off</span>}
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <div className="empty">Nothing found.</div>}
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        {item && (
          <>
            <div className="row">
              <div className="grow">
                <h2>{item.name}</h2>
                <div className="sub">
                  {item.aliases.length > 0 && <>Also known as: {item.aliases.join(', ')}. </>}
                  {item.gas_code && <>Single gas: <span className="mono">{item.gas_code}</span> — uses the GWP table, no factor rows needed. </>}
                  {item.composition?.length ? <>Blend: {item.composition.map((c) => `${c.gas} ${num(c.fraction * 100, 4)} %`).join(' + ')} — calculated per gas. </> : null}
                  {item.note}
                </div>
              </div>
              <select className="input" value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')}>
                <option value="">All years</option>{[2022, 2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
              </select>
              <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show superseded</label>
              <button className="btn p" onClick={() => setAdding(true)}>Add or correct a factor</button>
            </div>
            {adding && <AddFactor itemId={item.id} units={units} onDone={(msg) => { setAdding(false); if (msg) { toast(msg); load(); } }} />}
            {factors.length === 0 ? <div className="empty">{item.gas_code || item.composition?.length ? 'Calculated from the gas table (see Gases & GWP).' : item.code.startsWith('waste:') ? 'Calculated with the IPCC 2006 / 2019 Refinement method: its default values and their table numbers are shown on the waste entry screen, where they can be replaced per site.' : 'No factors for this item yet.'}</div> : (
              <div className="scroll">
                <table className="t">
                  <thead><tr><th>Year</th><th>Part</th><th>Per</th><th className="num">kg CO₂e</th><th className="num">CO₂ kg</th><th className="num">CH₄ kg</th><th className="num">N₂O kg</th><th>Source</th><th>Ver.</th></tr></thead>
                  <tbody>
                    {byYear.map(([y, rows]) => rows.map((f, i) => {
                      const g = (code: string) => f.gases?.find((x) => x.gas === code || (code === 'CH4' && x.gas === 'CH4_fossil') || (code === 'CO2' && x.gas === 'CO2_biogenic'))?.kgPerUnit;
                      return (
                        <tr key={f.id} className={`click ${f.status !== 'active' ? 'off' : ''}`} onClick={async () => setHistory({ id: f.id, rows: (await api.factorHistory(f.id)).history })}
                          style={i === 0 ? { borderTop: '2px solid var(--line2)' } : undefined}>
                          <td><b>{i === 0 ? y : ''}</b></td>
                          <td style={{ whiteSpace: 'nowrap' }}><span className={`chip ${f.basis === 'direct' ? '' : f.basis === 'wtt' ? 'warn' : 'info'}`}>{BASIS_SHORT[f.basis as Basis]}</span></td>
                          <td style={{ whiteSpace: 'nowrap' }}>{unitName(f.unit)}</td>
                          <td className="num">{num(f.co2e)}</td><td className="num">{num(g('CO2'))}</td><td className="num">{num(g('CH4'))}</td><td className="num">{num(g('N2O'))}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{f.source}{f.region !== 'GLOBAL' && <span className="chip info" style={{ marginLeft: 4 }}>{f.region}</span>}</td>
                          <td>v{f.version}{f.status !== 'active' && <span className="chip grey" style={{ marginLeft: 4 }}>{f.status}</span>}</td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>
            )}
            {history && (
              <div className="note info">
                <b>History of factor #{history.id}</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {history.rows.map((h) => <li key={h.id}>v{h.version} · {num(h.co2e)} kg CO₂e · {h.source} · {h.status} · by {h.created_by} on {h.created_at.slice(0, 10)}{h.note ? ` · ${h.note}` : ''}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </div>
  );
}

function AddFactor({ itemId, units, onDone }: { itemId: number; units: Unit[]; onDone: (msg?: string) => void }) {
  const [f, setF] = useState({ year: '2026', basis: 'direct', unit: 'L', region: 'GLOBAL', co2e: '', co2: '', ch4: '', n2o: '', source: 'ADMIN', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setErr(null);
    const gases = [['CO2', f.co2], ['CH4_fossil', f.ch4], ['N2O', f.n2o]].filter(([, v]) => v !== '').map(([gas, v]) => ({ gas, kgPerUnit: Number(v) }));
    try {
      const r = await api.addFactor({ itemId, sourceCode: f.source, basis: f.basis, unit: f.unit, region: f.region || 'GLOBAL', co2e: f.co2e === '' ? null : Number(f.co2e), gases,
        validFrom: `${f.year}-01-01`, validTo: `${f.year}-12-31`, note: f.note || undefined });
      onDone(r.replaced ? `Saved as a new version (previous kept in history)` : 'Factor added');
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card" style={{ background: '#F8FAF9', display: 'grid', gap: 10 }}>
      <h3>Add or correct a factor</h3>
      <div className="row">
        <label className="field"><span>Year</span><input className="input num" style={{ width: 90 }} value={f.year} onChange={set('year')} /></label>
        <label className="field"><span>Part</span><select className="input" value={f.basis} onChange={set('basis')}>{Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Per unit</span><select className="input" value={f.unit} onChange={set('unit')}>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>
        <label className="field"><span>Country</span><input className="input" style={{ width: 90 }} value={f.region} onChange={set('region')} placeholder="GLOBAL or AE" /></label>
        <label className="field"><span>Source code</span><input className="input" style={{ width: 130 }} value={f.source} onChange={set('source')} /></label>
      </div>
      <div className="row">
        <label className="field"><span>kg CO₂e per unit</span><input className="input num" value={f.co2e} onChange={set('co2e')} /></label>
        <label className="field"><span>kg CO₂</span><input className="input num" value={f.co2} onChange={set('co2')} /></label>
        <label className="field"><span>kg CH₄</span><input className="input num" value={f.ch4} onChange={set('ch4')} /></label>
        <label className="field"><span>kg N₂O</span><input className="input num" value={f.n2o} onChange={set('n2o')} /></label>
        <label className="field grow"><span>Note (why)</span><input className="input" value={f.note} onChange={set('note')} /></label>
      </div>
      <div className="sub">Give the gas amounts (kg of each gas, not CO₂e) so any GWP set works; the CO₂e total is optional and used as a check. Same year, part, unit and country as an existing factor → saved as a new version.</div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => onDone()}>Cancel</button><button className="btn p" onClick={save}>Save</button></div>
    </div>
  );
}
