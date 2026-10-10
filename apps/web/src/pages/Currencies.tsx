/**
 * Currencies & price index (Setup): how spend in any currency is brought to the money of
 * the spend-based factors (EPA: 2022 US dollars).
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, type FxRow } from '../lib/api';
import { Icon } from '../components/Icon';

const METHOD: [string, string, string][] = [
  ['month', 'Average rate of the purchase month (recommended)', 'Each line uses the average rate of the month it was bought in. Closest to the money actually spent; the usual convention for income-statement items. A missing month falls back to the annual average (marked on the line).'],
  ['year', 'Annual average', 'One rate per currency and year. Simpler; slightly less precise when a currency moved during the year.'],
  ['fixed', 'Fixed (budget) rate per year', 'The company\'s own rate per year, e.g. the treasury budget rate. Falls back to the annual average when none is set.'],
];

export function Currencies() {
  const { role, toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.currency>> | null>(null);
  const [cur, setCur] = useState('');
  const [paste, setPaste] = useState('');
  const [kind, setKind] = useState('month');
  const [source, setSource] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const isSuper = role === 'super_admin' || role === 'platform_admin';
  const canAdd = isSuper || role === 'admin';
  const load = () => api.currency(cur || undefined).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  // "EUR 2024-03 0.92" or "EUR;2024-03;0.92" per line
  const parsed = useMemo(() => paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const c = l.split(/[\t;,| ]+/).filter(Boolean);
    const currency = (c.find((x) => /^[A-Za-z]{3}$/.test(x)) ?? '').toUpperCase();
    const period = c.find((x) => /^\d{4}(-\d{1,2})?$/.test(x) || /^\d{1,2}[/.-]\d{4}$/.test(x)) ?? '';
    const rate = Number(c.filter((x) => x !== period && /^\d*\.?\d+$/.test(x)).pop());
    const p = /^(\d{1,2})[/.-](\d{4})$/.exec(period);
    const per = p ? `${p[2]}-${p[1]!.padStart(2, '0')}` : period.replace(/^(\d{4})-(\d)$/, '$1-0$2');
    return { ok: !!currency && !!per && rate > 0, row: { currency, kind: kind === 'month' && per.length === 4 ? 'year' : kind, period: per, perUsd: rate, source: source || 'entered by the company' }, line: l };
  }), [paste, kind, source]);

  if (!d) return <div className="page"><div className="card empty">{err ?? 'Loading…'}</div></div>;
  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Setup</div><h1>Currencies &amp; price index</h1>
        <p className="sub">Spend-based factors are in kg CO₂e per US dollar of a given year (EPA v1.3: 2022 dollars). Each purchase is converted to US dollars with an exchange rate, then brought to that year's prices with the US consumer price index, so inflation does not inflate emissions.</p></div></div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h3>Exchange rate used</h3>
        {METHOD.map(([k, l, help]) => (
          <label key={k} className={`choice ${d.fxMethod === k ? 'on' : ''}`} style={{ cursor: isSuper ? 'pointer' : 'default' }}>
            <span className="row" style={{ gap: 8 }}><input type="radio" disabled={!isSuper} checked={d.fxMethod === k} onChange={async () => { try { await api.currencySettings({ fxMethod: k }); toast('Saved: recalculate open purchase batches to apply'); load(); } catch (e) { setErr((e as Error).message); } }} /><b>{l}</b></span>
            <span className="sub">{help}</span>
          </label>
        ))}
        <div className="sub">Currencies pegged to the US dollar (AED 3.6725, SAR 3.75, QAR 3.64, OMR 0.3845, BHD 0.376) always use the peg, whatever the method. Company currency (default for files without a currency column): <b>{d.currency}</b>.</div>
      </div>

      {d.missing.length > 0 && (
        <div className="card"><h3>Rates missing for open purchase lines</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{d.missing.map((m) => <span key={m.currency + m.month} className="chip warn">{m.currency} {m.month} · {m.lines} lines</span>)}</div>
          <div className="sub">Add them below, then use “Recalculate” on the purchase batch.</div></div>
      )}
      {d.fallbacks.length > 0 && (
        <div className="card"><h3>Fallbacks used</h3>
          <table className="t compact"><tbody>{d.fallbacks.map((f) => <tr key={f.warning}><td>{f.warning}</td><td className="num">{f.lines.toLocaleString('en')} lines</td></tr>)}</tbody></table></div>
      )}

      <div className="cols2">
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div className="row"><h3 className="grow">Exchange rates (units of the currency per 1 USD)</h3>
            <select className="input sm" value={cur} onChange={(e) => setCur(e.target.value)} style={{ width: 'auto' }}><option value="">All currencies</option>{[...new Set([...d.used.map((u) => u.currency), ...d.rates.map((r) => r.currency)])].sort().map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="scrollx" style={{ maxHeight: 420 }}><table className="t compact">
            <thead><tr><th>Currency</th><th>Kind</th><th>Period</th><th className="num">per USD</th><th>Source</th><th /></tr></thead>
            <tbody>{d.rates.map((r: FxRow) => <tr key={r.id}><td><b>{r.currency}</b></td><td>{r.kind}</td><td className="mono small">{r.kind === 'month' ? r.period.slice(0, 7) : r.kind === 'peg' ? `since ${r.period.slice(0, 4)}` : r.period.slice(0, 4)}</td>
              <td className="num">{r.per_usd}</td><td className="small">{r.source}{r.own ? '' : <span className="muted"> · shared</span>}</td>
              <td>{r.own && canAdd && <button className="btn ghost sm" aria-label="Remove" onClick={async () => { await api.deleteRate(r.id); load(); }}><Icon name="x" /></button>}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {canAdd && <div className="card" style={{ display: 'grid', gap: 8 }}>
            <h3>Add rates</h3>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field"><span>Kind</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="month">Monthly average</option><option value="year">Annual average</option><option value="fixed">Fixed (budget) rate</option></select></label>
              <label className="field grow"><span>Source</span><input className="input" value={source} placeholder="e.g. Central bank monthly averages" onChange={(e) => setSource(e.target.value)} /></label>
            </div>
            <textarea className="input" rows={6} style={{ height: 'auto', fontFamily: 'var(--mono, monospace)' }} value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder={'One per line: currency, month (or year), units per USD\nEUR 2025-01 0.961\nEUR 2025-02 0.958\nINR 2025 86.2'} />
            {paste && <div className="sub">{parsed.filter((p) => p.ok).length} rates read{parsed.some((p) => !p.ok) ? <span className="bad"> · not read: {parsed.filter((p) => !p.ok).slice(0, 3).map((p) => p.line).join('; ')}</span> : ''}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm p" disabled={!parsed.some((p) => p.ok)} onClick={async () => { try { const r = await api.addRates(parsed.filter((p) => p.ok).map((p) => p.row)); toast(`${r.saved} rates saved`); setPaste(''); load(); } catch (e) { setErr((e as Error).message); } }}>Save rates</button></div>
          </div>}
          <div className="card"><h3>US consumer price index (CPI-U, annual average)</h3>
            <table className="t compact"><tbody>{d.cpi.filter((c) => c.region === 'US').map((c) => <tr key={c.year}><td>{c.year}</td><td className="num">{c.value}</td></tr>)}</tbody></table>
            <div className="sub">Source: US Bureau of Labor Statistics. A year not yet loaded uses the latest year available, marked on each line. {role === 'platform_admin' && <AddCpi onDone={load} />}</div></div>
          {err && <div className="note bad">{err}</div>}
        </div>
      </div>
    </div>
  );
}

function AddCpi({ onDone }: { onDone: () => void }) {
  const [y, setY] = useState(''); const [v, setV] = useState('');
  return <span className="row" style={{ gap: 6, marginTop: 6 }}><input className="input sm" placeholder="Year" value={y} onChange={(e) => setY(e.target.value)} style={{ width: 80 }} />
    <input className="input sm" placeholder="Value" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 100 }} />
    <button className="btn sm" disabled={!y || !v} onClick={async () => { await api.addPriceIndex({ region: 'US', year: Number(y), value: Number(v), source: 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)' }); setY(''); setV(''); onDone(); }}>Add</button></span>;
}
