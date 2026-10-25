/**
 * One CN code in the Commission's tables: the default value that applies for a country of origin (with direct and
 * indirect parts, the production route, the mark-up by year and why that value applies), the same code in every
 * country, the highest value (Annex IV) and the benchmarks (column B with default values, column A with actual data).
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import type { CbamLookup } from '../lib/cbamComm';
import { CountrySelect } from '../components/CountrySelect';
import { countryLabel } from '../lib/countries';

const f = (x: number | null | undefined, d = 3) => (x == null ? '—' : x.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const cnFmt = (s: string) => s.replace(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' '));
export const ROUTES: Record<string, string> = {
  A: 'grey clinker / cement', B: 'white clinker / cement', C: 'carbon steel, BF/BOF', D: 'carbon steel, DRI/EAF', E: 'carbon steel, scrap/EAF',
  F: 'low-alloy steel, BF/BOF', G: 'low-alloy steel, DRI/EAF', H: 'low-alloy steel, scrap/EAF', J: 'high-alloy steel, EAF', K: 'primary aluminium', L: 'secondary aluminium',
};
export const routeName = (r: string | null) => !r ? '' : r.split('/').map((p) => { const m = /^([A-L])?(\d)?$/.exec(p); if (!m) return p; return [m[1] && `(${m[1]}) ${ROUTES[m[1]] ?? ''}`, m[2] && `variant (${m[2]})`].filter(Boolean).join(', '); }).join(' or ');
const TIER: Record<string, string> = { country: 'value for this country', other: '“Other countries and territories” value', highest: 'highest value (Annex IV)', own: "your company's own value" };

export function CbamValueLookup({ initialCn = '', initialCountry = '', compact = false, fixedCn = false }: { initialCn?: string; initialCountry?: string; compact?: boolean; fixedCn?: boolean }) {
  const { toast } = useApp();
  const [cn, setCn] = useState(initialCn);
  const [country, setCountry] = useState(initialCountry);
  const [d, setD] = useState<CbamLookup | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { setCn(initialCn); }, [initialCn]);
  useEffect(() => {
    const c = cn.replace(/\D/g, '');
    if (c.length < 4) { setD(null); return; }
    const t = window.setTimeout(() => { api.cbamRefLookup(c, country).then(setD).catch((e) => { setD(null); if (c.length >= 8) toast((e as Error).message); }); }, 250);
    return () => window.clearTimeout(t);
  }, [cn, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = d ? (all ? d.byCountry : d.byCountry.slice(0, 8)) : [];
  return <div style={{ display: 'grid', gap: 10 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {!fixedCn && <label className="field"><span>CN or TARIC code</span><input className="input mono" style={{ width: 150 }} value={cn} placeholder="7208 39 00" onChange={(e) => setCn(e.target.value)} /></label>}
      <label className="field" style={{ minWidth: 220 }}><span>Country of origin</span><CountrySelect value={country} empty="— choose —" onChange={setCountry} /></label>
    </div>
    {!d ? <div className="muted small">{cn.replace(/\D/g, '').length < 4 ? 'Enter a CN code.' : 'No value loaded for this code.'}</div> : <>
      <div className="muted small">{d.category} · {d.indirectCounts ? 'direct and indirect emissions are priced' : 'direct emissions are priced (indirect only reported)'}</div>
      {d.default ? <div className="cvl-box">
        <div><span className="lbl">Default value · {countryLabel(country)}</span>
          <div className="cvl-big">{f(d.default.value)} <small>tCO₂e/t</small></div>
          <div className="small">direct {f(d.default.direct)} · indirect {d.default.indirect == null ? 'n/a' : f(d.default.indirect)}{d.default.route ? ` · route ${routeName(d.default.route)}` : ''}</div>
          <div className="muted small">{TIER[d.default.tier] ?? d.default.tier} · CN {cnFmt(d.default.cn)}{d.default.indicative && <span className="chip warn" style={{ marginLeft: 4 }}>illustrative</span>}</div>
          {d.default.note && <div className="small warn-t">{d.default.note}</div>}
        </div>
        <table className="t"><thead><tr><th>With the mark-up</th><th className="num">Mark-up</th><th className="num">tCO₂e/t</th></tr></thead>
          <tbody>{d.default.withMarkup.map((m) => <tr key={m.year}><td>{m.year}{m.year === 2028 ? ' onwards' : ''}</td><td className="num">{Math.round(m.markup * 100)}%</td><td className="num">{f(m.value)}</td></tr>)}</tbody></table>
      </div> : country ? <div className="muted small">No default value for this code.</div> : <div className="muted small">Choose the country of origin to see the value that applies.</div>}
      <div className="cvl-grid">
        <div><span className="lbl">Benchmark with default values (column B)</span>
          {d.benchmarks.B.length ? <table className="t"><tbody>{d.benchmarks.B.map((b, i) => <tr key={i} className={d.default?.route && b.route && d.default.route.split('/').some((x) => b.route!.startsWith(x)) ? 'on' : ''}><td className="small">{b.route ? routeName(b.route) : 'any route'}{b.own && <span className="chip" style={{ marginLeft: 4 }}>own</span>}</td><td className="num">{f(b.value)}</td></tr>)}</tbody></table> : <div className="muted small">None loaded.</div>}
        </div>
        <div><span className="lbl">Benchmark with actual emissions (column A)</span>
          {d.benchmarks.A.length ? <table className="t"><tbody>{d.benchmarks.A.map((b, i) => <tr key={i}><td className="small">{b.route ? routeName(b.route) : 'process benchmark'}</td><td className="num">{f(b.value)}</td></tr>)}</tbody></table> : <div className="muted small">None loaded.</div>}
          <div className="muted small">With actual data the precursors add their own benchmark; the tool uses column B on the installation's route unless you enter the benchmark on the line.</div>
        </div>
      </div>
      {!compact && d.byCountry.length > 0 && <div><span className="lbl">Default value in each country ({d.byCountry.length}), lowest first</span>
        <table className="t"><thead><tr><th>Country</th><th className="num">Direct</th><th className="num">Indirect</th><th className="num">Total</th><th>Route</th></tr></thead>
          <tbody>{list.map((r) => <tr key={r.country} className={r.country === country ? 'on' : ''}><td>{r.name}{r.taric && <span className="muted small"> · TARIC {cnFmt(r.cn)}</span>}</td><td className="num">{f(r.direct)}</td><td className="num">{r.indirect == null ? 'n/a' : f(r.indirect)}</td><td className="num"><b>{f(r.value)}</b></td><td className="small">{r.route ?? ''}</td></tr>)}</tbody></table>
        <div className="row small" style={{ gap: 12 }}>{d.byCountry.length > 8 && <button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${d.byCountry.length}`}</button>}
          {d.other && <span className="muted">Other countries and territories: <b>{f(d.other.value)}</b></span>}{d.highest[0] && <span className="muted">Highest (Annex IV, origin unknown): <b>{f(d.highest[0].value)}</b></span>}</div>
      </div>}
    </>}
  </div>;
}
