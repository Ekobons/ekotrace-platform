/**
 * Add data — stationary combustion and fugitive emissions.
 *
 * Layout follows the prototype: facility + period on top, subcategories on the
 * left, the entry form on the right. The result is recalculated as the user
 * types (preview, nothing saved) and shows totals, the split per gas, the
 * calculation steps and any warnings. "Save entry" stores it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, ApiError, BASIS_LABEL, num, tco2e, type Activity, type CalcResponse, type Category, type Facility } from '../lib/api';
import { Result } from '../components/Result';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

type Method = 'quantity' | 'screening' | 'mass_balance';
const FUGITIVE_FIELDS: Record<Method, { key: string; label: string; pct?: boolean; optional?: boolean }[]> = {
  quantity: [{ key: 'released', label: 'Quantity topped up / released' }],
  screening: [
    { key: 'operatingCharge', label: 'Charge of equipment in use' },
    { key: 'annualLeakRatePct', label: 'Annual leak rate', pct: true },
    { key: 'newCharge', label: 'Charge of equipment installed', optional: true },
    { key: 'installLossPct', label: 'Loss at installation', pct: true, optional: true },
    { key: 'disposedCharge', label: 'Charge of equipment disposed', optional: true },
    { key: 'recoveryPct', label: 'Recovered at disposal', pct: true, optional: true },
  ],
  mass_balance: [
    { key: 'stockStart', label: 'Gas in stock at start' },
    { key: 'stockEnd', label: 'Gas in stock at end' },
    { key: 'purchased', label: 'Purchased / received' },
    { key: 'soldOrReturned', label: 'Sold / returned / sent for recycling' },
    { key: 'newEquipmentCharge', label: 'Full charge of new equipment' },
    { key: 'retiredEquipmentCharge', label: 'Full charge of retired equipment' },
  ],
};
const METHOD_HELP: Record<Method, string> = {
  quantity: 'Use the service records: what was refilled is what leaked.',
  screening: 'Only the equipment charge is known: an annual leak rate is applied (e.g. 2–10 % for commercial AC, 0.5 % for SF₆ switchgear).',
  mass_balance: 'From gas purchase and stock records over the period (GHG Protocol mass balance).',
};

export function AddData() {
  const { category: catCode = 'stationary_combustion' } = useParams();
  const { tenant, toast } = useApp();
  const [cat, setCat] = useState<Category | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<number | 'year'>(new Date().getMonth());
  const [subId, setSubId] = useState<number | null>(null);
  const [itemId, setItemId] = useState<number | null>(null);
  const [units, setUnits] = useState<{ code: string; name: string }[]>([]);
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [method, setMethod] = useState<Method>('quantity');
  const [fug, setFug] = useState<Record<string, string>>({});
  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<Activity[]>([]);

  // Load catalogue for this category and the company's facilities.
  useEffect(() => {
    setCat(null); setSubId(null); setItemId(null); setResult(null);
    api.catalogue().then((c) => {
      const found = c.categories.find((x) => x.code === catCode) ?? null;
      setCat(found);
      setSubId(found?.subcategories[0]?.id ?? null);
    });
  }, [catCode, tenant?.id]);
  useEffect(() => {
    api.facilities().then((f) => { setFacilities(f.facilities); setFacilityId((id) => (f.facilities.some((x) => x.id === id) ? id : f.facilities[0]?.id ?? '')); });
  }, [tenant?.id]);

  const sub = cat?.subcategories.find((s) => s.id === subId) ?? null;
  const item = sub?.items.find((i) => i.id === itemId) ?? null;

  // First item of the subcategory by default; units follow the item.
  useEffect(() => { setItemId(sub?.items[0]?.id ?? null); }, [subId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!itemId) { setUnits([]); return; }
    api.itemUnits(itemId).then((u) => { setUnits(u.units); setUnit(u.defaultUnit ?? u.units[0]?.code ?? ''); });
  }, [itemId]);

  const period = useMemo(() => {
    if (month === 'year') return { periodStart: iso(year, 0, 1), periodEnd: iso(year, 11, 31) };
    return { periodStart: iso(year, month, 1), periodEnd: iso(year, month, lastDay(year, month)) };
  }, [year, month]);

  const payload = useMemo(() => {
    if (!itemId || !unit) return null;
    const base = { itemId, unit, facilityId: facilityId || undefined, ...period };
    if (cat?.calc_method === 'fugitive') {
      const fields = FUGITIVE_FIELDS[method];
      const data: Record<string, number | string> = { method };
      for (const f of fields) {
        const v = fug[f.key];
        if (v === undefined || v === '') { if (!f.optional) return null; continue; }
        data[f.key] = Number(v);
      }
      return { ...base, fugitive: data };
    }
    if (quantity === '') return null;
    return { ...base, quantity: Number(quantity) };
  }, [itemId, unit, facilityId, period, cat, method, fug, quantity]);

  // Live preview (debounced).
  useEffect(() => {
    setError(null);
    if (!payload) { setResult(null); return; }
    const t = window.setTimeout(() => {
      api.calculate(payload).then(setResult).catch((e: ApiError) => { setResult(null); setError(e.message); });
    }, 250);
    return () => window.clearTimeout(t);
  }, [payload]);

  const loadRecent = () => {
    if (!facilityId) return;
    api.activities({ facilityId, category: catCode, limit: 8 }).then((r) => setRecent(r.activities)).catch(() => {});
  };
  useEffect(loadRecent, [facilityId, catCode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!payload || !facilityId) return;
    setSaving(true);
    try {
      const r = await api.saveActivity({ ...payload, facilityId, dataType, note: note || undefined });
      toast(`Saved: ${item?.name} · ${tco2e(r.totals.direct)} tCO₂e`);
      setQuantity(''); setFug({}); setNote('');
      loadRecent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!cat) return <div className="page"><div className="card empty">Loading…</div></div>;
  const fugitive = cat.calc_method === 'fugitive';

  return (
    <div className="page">
      <div className="head">
        <div>
          <div className="eyebrow">Capture · Scope {cat.scope}</div>
          <h1>{cat.name}</h1>
          <p className="sub">{cat.description}</p>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 260 }}>
            <span>Facility</span>
            <select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              {!facilities.length && <option value="">No facilities yet — add one in Company & facilities</option>}
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.country})</option>)}
            </select>
          </label>
          <label className="field">
            <span>Year</span>
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[2022, 2023, 2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
          <div className="grow" />
          <span className="chip info">Factors: DESNZ {year <= 2026 ? year : '2026 (latest)'} · GWP {tenant?.gwp_set}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {MONTHS.map((m, i) => (
            <button key={m} className={`btn sm ${month === i ? 'p' : ''}`} style={{ minWidth: 56 }} onClick={() => setMonth(i)}>{m}</button>
          ))}
          <button className={`btn sm ${month === 'year' ? 'p' : ''}`} onClick={() => setMonth('year')}>Whole year</button>
        </div>
      </div>

      <div className="grid2">
        <div className="card" style={{ padding: 12 }}>
          <div className="eyebrow" style={{ padding: '4px 8px 8px' }}>{fugitive ? 'Gas groups' : 'Fuel classes'}</div>
          <div className="list">
            {cat.subcategories.map((s) => (
              <button key={s.id} className={s.id === subId ? 'on' : ''} onClick={() => setSubId(s.id)}>
                <span>{s.name}{s.is_bioenergy && <span className="chip" style={{ marginLeft: 6 }}>bio</span>}</span>
                <span className="meta">{s.items.length}</span>
              </button>
            ))}
          </div>
          {!fugitive && <p className="sub" style={{ padding: '10px 8px 0', fontSize: 12 }}>Bioenergy: CH₄ and N₂O count in Scope 1; the CO₂ is biogenic and reported separately.</p>}
        </div>

        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field grow" style={{ minWidth: 240 }}>
              <span>{fugitive ? 'Gas or refrigerant' : 'Fuel'}</span>
              <select className="input" value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))}>
                {sub?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            {!fugitive && (
              <label className="field" style={{ width: 170 }}>
                <span>Quantity</span>
                <input className="input num" inputMode="decimal" value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ''))} />
              </label>
            )}
            <label className="field" style={{ width: 170 }}>
              <span>Unit</span>
              <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}
              </select>
            </label>
          </div>
          {item && (item.composition?.length || item.note) && (
            <div className="sub">
              {item.composition?.length ? <>Composition: {item.composition.map((c) => `${c.gas} ${num(c.fraction * 100, 4)} %`).join(' · ')}. </> : null}
              {item.note}
            </div>
          )}

          {fugitive && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="seg">
                {(['quantity', 'screening', 'mass_balance'] as Method[]).map((m) => (
                  <button key={m} className={method === m ? 'on' : ''} onClick={() => { setMethod(m); setFug({}); }}>
                    {m === 'quantity' ? 'Quantity refilled' : m === 'screening' ? 'Screening (charge × leak rate)' : 'Mass balance'}
                  </button>
                ))}
              </div>
              <div className="sub">{METHOD_HELP[method]}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {FUGITIVE_FIELDS[method].map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}{f.optional ? ' (optional)' : ''} · {f.pct ? '%' : unit}</span>
                    <input className="input num" inputMode="decimal" value={fug[f.key] ?? ''} placeholder="0"
                      onChange={(e) => setFug({ ...fug, [f.key]: e.target.value.replace(/[^0-9.]/g, '') })} />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="row">
            <label className="field" style={{ width: 160 }}>
              <span>Data type</span>
              <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}>
                <option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option>
              </select>
            </label>
            <label className="field grow">
              <span>Note / reference</span>
              <input className="input" value={note} maxLength={1000} placeholder="Invoice no., meter, service report…" onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          {error && <div className="note bad">{error}</div>}
          {result ? <Result r={result} /> : !error && <div className="note info">Enter a {fugitive ? 'quantity' : 'quantity'} to see the emissions, the split per gas and how they were calculated.</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn p" disabled={!result || !facilityId || saving} onClick={save}>{saving ? 'Saving…' : 'Save entry'}</button>
          </div>
        </div>
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2>Recent entries · {facilities.find((f) => f.id === facilityId)?.name ?? '—'}</h2></div>
        {recent.length ? (
          <table className="t">
            <thead><tr><th>Period</th><th>Item</th><th className="num">Quantity</th><th className="num">{BASIS_LABEL.direct} tCO₂e</th><th className="num">WTT tCO₂e</th><th className="num">Biogenic tCO₂</th><th>Type</th></tr></thead>
            <tbody>{recent.map((a) => (
              <tr key={a.id}>
                <td>{a.period_start.slice(0, 7)}{a.period_end.slice(0, 7) !== a.period_start.slice(0, 7) ? ` – ${a.period_end.slice(0, 7)}` : ''}</td>
                <td>{a.item}</td><td className="num">{num(a.quantity)} {a.unit}</td>
                <td className="num">{tco2e(a.co2e_direct)}</td><td className="num">{tco2e(a.co2e_wtt)}</td><td className="num">{tco2e(a.co2_biogenic)}</td>
                <td><span className="chip grey">{a.data_type}</span></td>
              </tr>))}
            </tbody>
          </table>
        ) : <div className="empty">Nothing saved yet for this facility.</div>}
      </div>
    </div>
  );
}
