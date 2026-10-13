/**
 * Business travel (Scope 3.6) — one row per trip, for the months picked in Add data.
 *
 *  Flights: from / to airports (the distance is worked out: great-circle + 8%, as DESNZ advises), or
 *           the flight type with the one-way distance (a typical distance when not known);
 *           class; return; trips (journeys × people). DESNZ air factors, with radiative forcing
 *           unless the company chose without (Methodology).
 *  Hotels:  country, rooms × nights (DESNZ hotel stay per room-night; the hotel's own factor if it gives one).
 *  Other:   rail, bus, taxi, car hire, ferry — one-way km, return, trips.
 *  Spend:   air fares, hotels, taxis paid without the details — by spend (EPA factors), via ManualGrid.
 *
 * Save as draft or Submit for approval, like every other category.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, num, tco2e, type AirportHit, type TripOptions } from '../lib/api';
import { useApp } from '../App';
import { useEntry } from '../components/EntryContext';
import { ManualGrid } from './PurchaseEntry';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthPeriod = (y: number, m: number) => ({ periodStart: `${y}-${pad(m + 1)}-01`, periodEnd: `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}` });
const HAUL: Record<string, string> = { domestic: 'domestic', intl: 'international', short: 'short-haul (UK)', long: 'long-haul (UK)' };

export type TripKind = 'flights' | 'hotels' | 'ground' | 'spend';
type Row = {
  k: number; m: number; note: string;
  // flights
  from: string; to: string; haul: string; km: string; cls: string; ret: boolean; trips: string;
  // hotels
  hotel: string; rooms: string; nights: string; own: string;
  // ground
  item: string;
};
let K = 1;

export function TripEntry({ kind, facilityId, year, onSaved }: { kind: TripKind; facilityId: string; year: number; onSaved: () => void }) {
  const { toast } = useApp();
  const { months, approver, changed } = useEntry();
  const picked = useMemo(() => months ?? [new Date().getMonth()], [months]);
  const [opt, setOpt] = useState<TripOptions | null>(null);
  useEffect(() => { api.tripOptions(year).then(setOpt).catch(() => {}); }, [year]);
  const [byType, setByType] = useState(false);
  const defHotel = useMemo(() => String(opt?.hotels.find((h) => h.iso === opt.country && h.co2e != null)?.itemId ?? opt?.hotels.find((h) => h.co2e != null)?.itemId ?? ''), [opt]);
  const blank = (m: number): Row => ({ k: K++, m, note: '', from: '', to: '', haul: 'intl', km: '', cls: 'economy', ret: true, trips: '1', hotel: defHotel, rooms: '1', nights: '', own: '', item: String(opt?.ground[0]?.itemId ?? '') });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { setRows(picked.map((m) => blank(m))); }, [kind, picked.join(','), opt ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...p } : r)));

  // airport suggestions (one list shared by the inputs)
  const [hits, setHits] = useState<AirportHit[]>([]);
  const lookup = (q: string) => { if (q.trim().length >= 2 && !/^[A-Za-z]{3}\s/.test(q)) api.airports(q).then((r) => setHits(r.airports)).catch(() => {}); };
  const code = (v: string) => (v.trim().match(/^([A-Za-z]{3})\b/)?.[1] ?? '').toUpperCase();

  const body = (r: Row): Record<string, unknown> | null => {
    const p = monthPeriod(year, r.m), base = { facilityId, ...p, dataType: 'actual', note: r.note || undefined };
    const trips = Number(r.trips) || 1;
    if (kind === 'flights') {
      const f = code(r.from), t = code(r.to);
      if (!byType && (!f || !t)) return null;
      return { ...base, unit: 'pkm', trip: { kind: 'flight', ...(byType ? { haul: r.haul, km: Number(r.km) || undefined } : { from: f, to: t }), cls: r.cls, ret: r.ret, trips } };
    }
    if (kind === 'hotels') {
      if (!r.hotel || !(Number(r.nights) > 0)) return null;
      return { ...base, itemId: Number(r.hotel), unit: 'room_night', trip: { kind: 'hotel', rooms: Number(r.rooms) || 1, nights: Number(r.nights), ...(r.own ? { ownFactor: Number(r.own), ownSource: 'hotel’s own factor' } : {}) } };
    }
    const g = opt?.ground.find((x) => String(x.itemId) === r.item);
    if (!g || !(Number(r.km) > 0)) return null;
    return { ...base, itemId: g.itemId, unit: g.unit, trip: { kind: 'ground', km: Number(r.km), ret: r.ret, trips } };
  };
  const entries = rows.map((r) => ({ k: r.k, b: body(r) })).filter((e) => e.b) as { k: number; b: Record<string, unknown> }[];
  const key = JSON.stringify(entries);
  const [res, setRes] = useState<Record<number, { kg?: number; error?: string; warnings?: string[] }>>({});
  useEffect(() => {
    if (!entries.length) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.batch(entries.map((e) => e.b), true).then((b) => {
        const r: typeof res = {};
        b.results.forEach((x, i) => { r[entries[i]!.k] = x.ok ? { kg: x.totals?.scope3 ?? 0, warnings: x.warnings } : { error: x.error }; });
        setRes(r);
      }).catch(() => {});
    }, 350);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // flight distance shown in the row
  const [dist, setDist] = useState<Record<string, { km: number; haul: string } | string>>({});
  useEffect(() => {
    if (kind !== 'flights' || byType) return;
    for (const r of rows) {
      const f = code(r.from), t = code(r.to), id = `${f}-${t}`;
      if (f && t && f !== t && !(id in dist)) {
        setDist((d) => ({ ...d, [id]: '…' }));
        api.flightDistance(f, t).then((x) => setDist((d) => ({ ...d, [id]: { km: x.km, haul: x.haul } }))).catch((e) => setDist((d) => ({ ...d, [id]: (e as Error).message })));
      }
    }
  }, [rows, kind, byType]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const ok = entries.filter((e) => res[e.k]?.kg !== undefined);
  const total = ok.reduce((s, e) => s + (res[e.k]!.kg ?? 0), 0) / 1000;
  const save = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'draft');
    try {
      const b = await api.batch(entries.map((e) => e.b), false);
      const ids = b.results.filter((x) => x.ok && x.id).map((x) => x.id!);
      if (submit && ids.length) await api.reviewAction(ids, 'submit');
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.k));
      toast(`${b.saved} trip${b.saved === 1 ? '' : 's'} ${submit ? `submitted to ${approver || 'the approver'}` : 'saved as draft'}${b.failed ? `, ${b.failed} with problems (still on screen)` : ''}`);
      setRows((rs) => { const keep = rs.filter((r) => failed.has(r.k)); return keep.length ? keep : picked.map((m) => blank(m)); });
      onSaved(); changed();
    } finally { setBusy(null); }
  };

  if (kind === 'spend') {
    const m = picked[0] ?? 0;
    return <ManualGrid facilityId={facilityId} period={{ periodStart: `${year}-${pad(m + 1)}-01`, periodEnd: monthPeriod(year, picked[picked.length - 1] ?? m).periodEnd }} onSaved={() => { onSaved(); changed(); }}
      target="business_travel" title="Travel paid without the details — by spend" />;
  }
  if (!opt) return <div className="muted">Loading…</div>;
  const monthSel = (r: Row) => picked.length > 1
    ? <select className="input" style={{ width: 76 }} value={r.m} onChange={(e) => set(r.k, { m: Number(e.target.value) })}>{picked.map((m) => <option key={m} value={m}>{MONTHS[m]}</option>)}</select>
    : <b>{MONTHS[r.m]}<br />{year}</b>;
  const emis = (r: Row) => { const x = res[r.k]; return <td className="num" style={{ minWidth: 72 }}><b style={{ fontSize: 14 }}>{x?.kg !== undefined ? tco2e(x.kg) : '—'}</b><div className="muted small">tCO₂e</div></td>; };
  const del = (r: Row) => <td><button className="btn ghost sm" aria-label="Remove trip" onClick={() => setRows((rs) => rs.filter((y) => y.k !== r.k))}>×</button></td>;
  const err = (r: Row) => res[r.k]?.error ? <div className="small bad">{res[r.k]!.error}</div> : null;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {kind === 'flights' && <div className="row" style={{ gap: 10 }}>
        <div className="seg" role="group" aria-label="Flights by"><button className={!byType ? 'on' : ''} onClick={() => setByType(false)}>From / to airports</button><button className={byType ? 'on' : ''} onClick={() => setByType(true)}>Flight type and distance</button></div>
        <span className="sub grow">{byType ? 'When the airports are not known: a typical distance is used if you leave the km empty.' : 'Type a code or a city (e.g. DXB, Riyadh). The distance is worked out: great-circle + 8% (DESNZ).'}</span>
        <span className="chip c-n" title="Company choice, under Methodology">{opt.rf ? 'With radiative forcing' : 'Without radiative forcing'}</span>
      </div>}
      {kind === 'hotels' && <div className="sub">DESNZ hotel-stay factor per room-night by country; the latest year with a value is used when the year has none. Enter the hotel’s own factor when it gives one.</div>}
      {kind === 'ground' && <div className="sub">Trains, buses, taxis, hire cars and ferries for work. Company-owned vehicles go under Vehicles; travel to and from work under Employee commuting.</div>}
      <datalist id="airport-hits">{hits.map((a) => <option key={a.iata} value={`${a.iata} — ${a.city || a.name}, ${a.countryName}`}>{a.name}</option>)}</datalist>
      <div className="scrollx"><table className="t rows">
        <thead><tr><th>Month</th>
          {kind === 'flights' && (byType ? <><th>Flight type</th><th>One-way km</th></> : <><th>From</th><th>To</th></>)}
          {kind === 'flights' && <><th>Class</th><th title="Return ✓ · trips = journeys × people">Return · trips</th></>}
          {kind === 'hotels' && <><th>Country</th><th>Rooms</th><th>Nights</th><th>Own factor</th></>}
          {kind === 'ground' && <><th>Transport</th><th>One-way km</th><th title="Return ✓ · trips = journeys × people">Return · trips</th></>}
          <th>Traveller / ref.</th><th className="num">Emissions</th><th /></tr></thead>
        <tbody>{rows.map((r) => {
          const id = `${code(r.from)}-${code(r.to)}`, d = dist[id];
          const g = opt.ground.find((x) => String(x.itemId) === r.item);
          return (
            <tr key={r.k} className={res[r.k]?.error ? 'bad' : ''}>
              <td style={{ width: 90 }}>{monthSel(r)}</td>
              {kind === 'flights' && (byType ? <>
                <td style={{ minWidth: 200 }}><select className="input" value={r.haul} onChange={(e) => set(r.k, { haul: e.target.value })}>{opt.hauls.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}</select></td>
                <td><input className="input num" style={{ width: 110 }} inputMode="decimal" placeholder={`≈ ${num(opt.typicalKm[r.haul] ?? 0)}`} value={r.km} onChange={(e) => set(r.k, { km: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
              </> : <>
                <td style={{ minWidth: 120 }}><input className="input" list="airport-hits" placeholder="DXB" value={r.from} onChange={(e) => { set(r.k, { from: e.target.value }); lookup(e.target.value); }} />{err(r)}</td>
                <td style={{ minWidth: 120 }}><input className="input" list="airport-hits" placeholder="LHR" value={r.to} onChange={(e) => { set(r.k, { to: e.target.value }); lookup(e.target.value); }} />
                  {d && <div className="muted small">{typeof d === 'string' ? d : `${num(d.km)} km · ${HAUL[d.haul] ?? d.haul}`}</div>}</td>
              </>)}
              {kind === 'flights' && <>
                <td style={{ minWidth: 128 }}><select className="input" value={r.cls} onChange={(e) => set(r.k, { cls: e.target.value })}>{opt.classes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></td>
                <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" aria-label="Return" title="Return" checked={r.ret} onChange={(e) => set(r.k, { ret: e.target.checked })} />
                  <input className="input num" style={{ width: 52 }} inputMode="numeric" aria-label="Trips (journeys × people)" value={r.trips} onChange={(e) => set(r.k, { trips: e.target.value.replace(/[^0-9]/g, '') })} /></span></td>
              </>}
              {kind === 'hotels' && <>
                <td style={{ minWidth: 180 }}><select className="input" value={r.hotel} onChange={(e) => set(r.k, { hotel: e.target.value })}>
                  {opt.hotels.map((h) => <option key={h.itemId} value={h.itemId}>{h.country}{h.co2e != null ? ` · ${num(h.co2e)} kg${h.factorYear !== year ? ` (${h.factorYear})` : ''}` : ' · no factor'}</option>)}</select>{err(r)}</td>
                <td><input className="input num" style={{ width: 70 }} inputMode="numeric" value={r.rooms} onChange={(e) => set(r.k, { rooms: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 80 }} inputMode="numeric" placeholder="0" value={r.nights} onChange={(e) => set(r.k, { nights: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 110 }} inputMode="decimal" placeholder="kg / room-night" value={r.own} onChange={(e) => set(r.k, { own: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
              </>}
              {kind === 'ground' && <>
                <td style={{ minWidth: 200 }}><select className="input" value={r.item} onChange={(e) => set(r.k, { item: e.target.value })}>
                  {[...new Set(opt.ground.map((x) => x.group))].map((gr) => <optgroup key={gr} label={gr}>{opt.ground.filter((x) => x.group === gr).map((x) => <option key={x.itemId} value={x.itemId}>{x.name}</option>)}</optgroup>)}
                </select>{err(r)}</td>
                <td><input className="input num" style={{ width: 84 }} inputMode="decimal" placeholder={g?.unit === 'km' ? 'km driven' : 'km'} value={r.km} onChange={(e) => set(r.k, { km: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
                <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" aria-label="Return" title="Return" checked={r.ret} onChange={(e) => set(r.k, { ret: e.target.checked })} />
                  <input className="input num" style={{ width: 52 }} inputMode="numeric" aria-label="Trips (journeys × people)" value={r.trips} onChange={(e) => set(r.k, { trips: e.target.value.replace(/[^0-9]/g, '') })} /></span></td>
              </>}
              <td style={{ minWidth: 120 }}><input className="input" placeholder="Name, booking ref." value={r.note} maxLength={300} onChange={(e) => set(r.k, { note: e.target.value })} /></td>
              {emis(r)}{del(r)}
            </tr>);
        })}</tbody>
      </table></div>
      <div className="row"><button className="btn sm" onClick={() => setRows((rs) => [...rs, { ...blank(rs[rs.length - 1]?.m ?? picked[0] ?? 0), cls: rs[rs.length - 1]?.cls ?? 'economy', from: rs[rs.length - 1]?.from ?? '' }])}>+ Trip</button>
        <span className="muted small">Trips: journeys × people — the same trip made by 3 people counts 3.</span></div>
      {[...new Set(Object.values(res).flatMap((x) => x.warnings ?? []))].slice(0, 3).map((w) => <div key={w} className="note warn">{w}</div>)}
      <div className="softbar"><span className="muted small">{kind === 'flights' ? `DESNZ ${year <= 2026 ? year : 2026} business travel – air, per passenger-km${opt.rf ? ', with radiative forcing' : ''}; well-to-tank counted in 3.6.` : kind === 'hotels' ? 'DESNZ hotel stay, per room-night.' : 'DESNZ business travel – land and sea; well-to-tank counted in 3.6.'}</span>
        <span className="grow" /><b>{ok.length} trip{ok.length === 1 ? '' : 's'} · {total.toLocaleString('en', { maximumFractionDigits: 3 })} tCO₂e</b></div>
      <div className="row"><span className="muted small">Goes to <b>{approver || 'the approver'}</b> for approval.</span><span className="grow" />
        <button className="btn" disabled={!ok.length || !!busy || ok.length !== entries.length} onClick={() => void save(false)}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
        <button className="btn p" disabled={!ok.length || !!busy || ok.length !== entries.length} onClick={() => void save(true)}>{busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button></div>
    </div>
  );
}
