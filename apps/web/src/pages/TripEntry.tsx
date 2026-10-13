/**
 * Business travel (Scope 3.6) — one row per trip, for the months picked in Add data.
 *
 *  Flights: from / to airports, with connecting airports if any (each leg's distance is worked out:
 *           great-circle + 8%, as DESNZ advises; each leg is saved as its own entry), or the flight type
 *           (Domestic, Short-haul, Long-haul, International) with its typical distance — nobody has to
 *           know the km; class; return; trips (journeys × people). DESNZ air factors, with radiative
 *           forcing unless the company chose without (Methodology).
 *  Hotels:  country, star rating, rooms × nights, meeting space (m² × hours). DESNZ hotel stay per
 *           room-night by country; the star rating's and the meeting space's factors from the factor
 *           library when it has them.
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
const HAUL: Record<string, string> = { domestic: 'domestic', intl: 'international', short: 'short-haul', long: 'long-haul' };
/** DESNZ has every class only for long-haul and international; short-haul economy and business; domestic the average. */
const clsFor = (haul: string, cls: string) => haul === 'domestic' ? 'average' : haul === 'short' ? (cls === 'premium' ? 'economy' : cls === 'first' ? 'business' : cls) : cls;

export type TripKind = 'flights' | 'hotels' | 'ground' | 'spend';
type Row = {
  k: number; m: number; note: string;
  // flights
  from: string; to: string; via: string[]; haul: string; km: string; cls: string; ret: boolean; trips: string;
  // hotels
  hotel: string; stars: string; rooms: string; nights: string; msqm: string; mhrs: string;
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
  const blank = (m: number): Row => ({ k: K++, m, note: '', from: '', to: '', haul: 'short', km: '', cls: 'economy', ret: true, trips: '1', via: [], hotel: defHotel, stars: '', rooms: '1', nights: '', msqm: '', mhrs: '', item: String(opt?.ground[0]?.itemId ?? '') });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { setRows(picked.map((m) => blank(m))); }, [kind, picked.join(','), opt ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...p } : r)));

  // airport suggestions (one list shared by the inputs)
  const [hits, setHits] = useState<AirportHit[]>([]);
  const lookup = (q: string) => { if (q.trim().length >= 2 && !/^[A-Za-z]{3}\s/.test(q)) api.airports(q).then((r) => setHits(r.airports)).catch(() => {}); };
  const code = (v: string) => (v.trim().match(/^([A-Za-z]{3})\b/)?.[1] ?? '').toUpperCase();

  /** A row's entries: one, or one per leg of a connecting flight. */
  const legsOf = (r: Row) => [code(r.from), ...r.via.map(code).filter(Boolean), code(r.to)];
  const bodies = (r: Row): Record<string, unknown>[] => {
    const p = monthPeriod(year, r.m), base = { facilityId, ...p, dataType: 'actual', note: r.note || undefined };
    const trips = Number(r.trips) || 1;
    if (kind === 'flights') {
      if (byType) return [{ ...base, unit: 'pkm', trip: { kind: 'flight', haul: r.haul, cls: r.cls, ret: r.ret, trips } }];
      const L = legsOf(r);
      if (!L[0] || !L[L.length - 1]) return [];
      if (L.length === 2) return [{ ...base, unit: 'pkm', trip: { kind: 'flight', from: L[0], to: L[1], cls: r.cls, ret: r.ret, trips } }];
      const route = L.join('-');
      return L.slice(1).map((to, i) => ({ ...base, note: [r.note, `${route} leg ${i + 1}/${L.length - 1}`].filter(Boolean).join(' · '), unit: 'pkm',
        trip: { kind: 'flight', from: L[i], to, cls: r.cls, ret: r.ret, trips, leg: `${i + 1}/${L.length - 1}`, route } }));
    }
    if (kind === 'hotels') {
      const meet = Number(r.msqm) > 0 && Number(r.mhrs) > 0;
      if (!r.hotel || !(Number(r.nights) > 0 || meet)) return [];
      return [{ ...base, itemId: Number(r.hotel), unit: 'room_night', trip: { kind: 'hotel', rooms: Number(r.rooms) || 1, nights: Number(r.nights) || 0,
        ...(r.stars ? { stars: Number(r.stars) } : {}), ...(meet ? { meetingSqm: Number(r.msqm), meetingHours: Number(r.mhrs) } : {}) } }];
    }
    const g = opt?.ground.find((x) => String(x.itemId) === r.item);
    if (!g || !(Number(r.km) > 0)) return [];
    return [{ ...base, itemId: g.itemId, unit: g.unit, trip: { kind: 'ground', km: Number(r.km), ret: r.ret, trips } }];
  };
  const entries = rows.flatMap((r) => bodies(r).map((b, i) => ({ k: r.k, e: `${r.k}.${i}`, b })));
  const key = JSON.stringify(entries);
  const [eres, setRes] = useState<Record<string, { kg?: number; error?: string; warnings?: string[] }>>({});
  // per row: the legs added up; an error on any leg is the row's error
  const res = useMemo(() => {
    const out: Record<number, { kg?: number; error?: string; warnings?: string[] }> = {};
    for (const e of entries) {
      const x = eres[e.e]; if (!x) continue;
      const o = (out[e.k] ??= { kg: 0, warnings: [] });
      if (x.error) o.error = x.error; else o.kg = (o.kg ?? 0) + (x.kg ?? 0);
      o.warnings!.push(...(x.warnings ?? []));
    }
    for (const o of Object.values(out)) if (o.error) delete o.kg;
    return out;
  }, [eres, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!entries.length) { setRes({}); return; }
    const t = window.setTimeout(() => {
      api.batch(entries.map((e) => e.b), true).then((b) => {
        const r: typeof eres = {};
        b.results.forEach((x, i) => { r[entries[i]!.e] = x.ok ? { kg: x.totals?.scope3 ?? 0, warnings: x.warnings } : { error: x.error }; });
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
      const L = legsOf(r).filter(Boolean);
      for (let i = 1; i < L.length; i++) {
        const f = L[i - 1]!, t = L[i]!, id = `${f}-${t}`;
        if (f !== t && !(id in dist)) {
          setDist((d) => ({ ...d, [id]: '…' }));
          api.flightDistance(f, t).then((x) => setDist((d) => ({ ...d, [id]: { km: x.km, haul: x.haul } }))).catch((e) => setDist((d) => ({ ...d, [id]: (e as Error).message })));
        }
      }
    }
  }, [rows, kind, byType]); // eslint-disable-line react-hooks/exhaustive-deps

  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const ok = entries.filter((e) => eres[e.e]?.kg !== undefined);
  const total = ok.reduce((s, e) => s + (eres[e.e]!.kg ?? 0), 0) / 1000;
  const nTrips = new Set(ok.map((e) => e.k)).size;
  const save = async (submit: boolean) => {
    setBusy(submit ? 'submit' : 'draft');
    try {
      const b = await api.batch(entries.map((e) => e.b), false);
      const ids = b.results.filter((x) => x.ok && x.id).map((x) => x.id!);
      if (submit && ids.length) await api.reviewAction(ids, 'submit');
      const failed = new Set(b.results.filter((x) => !x.ok).map((x) => entries[x.index]!.k));
      const n = new Set(entries.filter((_, i) => b.results[i]?.ok).map((e) => e.k)).size;
      toast(`${n} trip${n === 1 ? '' : 's'}${b.saved !== n ? ` (${b.saved} entries, one per flight leg)` : ''} ${submit ? `submitted to ${approver || 'the approver'}` : 'saved as draft'}${b.failed ? `, ${b.failed} with problems (still on screen)` : ''}`);
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

  const rf = opt.rf ? 'rf' : 'norf';
  /** kg CO₂e per passenger, one way, for a flight type and class (typical distance × DESNZ factor incl. well-to-tank). */
  const perFlight = (haul: string, cls: string) => { const f = opt.airKg[`bt:air:${haul}:${clsFor(haul, cls)}:${rf}`]; return f ? f * (opt.typicalKm[haul] ?? 0) : null; };
  const hotelIso = (r: Row) => opt.hotels.find((h) => String(h.itemId) === r.hotel)?.iso ?? '';
  const hasLib = (regions: string[], iso: string) => regions.includes('GLOBAL') || (!!iso && regions.includes(iso));
  const legLabel = (f: string, t: string) => { const d = dist[`${f}-${t}`]; return d ? (typeof d === 'string' ? d : `${num(d.km)} km · ${HAUL[d.haul] ?? d.haul}`) : ''; };
  const airportIn = (r: Row, v: string, on: (x: string) => void, ph: string, label: string) =>
    <input className="input" list="airport-hits" aria-label={label} placeholder={ph} value={v} onChange={(e) => { on(e.target.value); lookup(e.target.value); }} />;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {kind === 'flights' && <div className="row" style={{ gap: 12 }}>
        <div className="seg strong" role="group" aria-label="Flights by">
          <button className={!byType ? 'on' : ''} aria-pressed={!byType} onClick={() => setByType(false)}>✈ From / to airports</button>
          <button className={byType ? 'on' : ''} aria-pressed={byType} onClick={() => setByType(true)}>☰ Flight type</button></div>
        <span className="sub grow">{byType ? 'When the airports are not known: pick the type and class. A typical distance for the type is used — no km needed.' : 'Type a code or a city (e.g. DXB, Riyadh). Add the connecting airport for a flight with a stop. Each leg’s distance is worked out: great-circle + 8% (DESNZ).'}</span>
        <span className="chip c-n" title="Company choice, under Methodology">{opt.rf ? 'With radiative forcing' : 'Without radiative forcing'}</span>
      </div>}
      {kind === 'hotels' && <div className="sub">DESNZ hotel-stay factor per room-night by country (the latest year with a value when the year has none). The star rating and meeting space use the factor library’s CHSB / HCMI factors when it has them.</div>}
      {kind === 'ground' && <div className="sub">Trains, buses, taxis, hire cars and ferries for work. Company-owned vehicles go under Vehicles; travel to and from work under Employee commuting.</div>}
      {kind === 'ground' && !opt.ground.length && <div className="note warn">No transport factors are loaded in this database, so there is nothing to choose from. Ask the platform admin to load the DESNZ files (run <span className="mono">npm run db:migrate</span> then <span className="mono">npm run db:seed</span>); rail, bus, taxi, car hire and ferry then appear here.</div>}
      <datalist id="airport-hits">{hits.map((a) => <option key={a.iata} value={`${a.iata} — ${a.city || a.name}, ${a.countryName}`}>{a.name}</option>)}</datalist>
      <div className="scrollx"><table className="t rows">
        <thead><tr><th>Month</th>
          {kind === 'flights' && (byType ? <th>Flight type</th> : <><th>From</th><th>Via (connecting)</th><th>To</th></>)}
          {kind === 'flights' && <><th>Class</th><th title="Return ✓ · trips = journeys × people">Return · trips</th></>}
          {kind === 'hotels' && <><th>Country</th><th>Hotel type</th><th>Rooms</th><th>Nights</th><th title="Meeting or event room used during the stay">Meeting space m²</th><th>Meeting hours</th></>}
          {kind === 'ground' && <><th>Type of transport</th><th>One-way km</th><th title="Return ✓ · trips = journeys × people">Return · trips</th></>}
          <th>Traveller / ref.</th><th className="num">Emissions</th><th /></tr></thead>
        <tbody>{rows.map((r) => {
          const L = legsOf(r);
          const g = opt.ground.find((x) => String(x.itemId) === r.item);
          const pf = perFlight(r.haul, r.cls), h = HAUL_OPT(opt, r.haul);
          const iso = hotelIso(r), cl = opt.hotelClasses.find((c) => String(c.stars) === r.stars);
          return (
            <tr key={r.k} className={res[r.k]?.error ? 'bad' : ''}>
              <td style={{ width: 90 }}>{monthSel(r)}</td>
              {kind === 'flights' && (byType ? <>
                <td style={{ minWidth: 260 }}><select className="input" aria-label="Flight type" value={r.haul} onChange={(e) => set(r.k, { haul: e.target.value })}>{opt.hauls.map((x) => <option key={x.key} value={x.key}>{x.label} · ≈ {num(opt.typicalKm[x.key] ?? 0)} km</option>)}</select>
                  <div className="haulhint">{h?.hint}{pf != null ? ` · ≈ ${num(Math.round(pf))} kg CO₂e per person one way` : ''}</div>{err(r)}</td>
              </> : <>
                <td style={{ minWidth: 120 }}>{airportIn(r, r.from, (x) => set(r.k, { from: x }), 'DXB', 'From')}{err(r)}</td>
                <td style={{ minWidth: 120 }}><div className="viaw">
                  {r.via.map((v, i) => <span key={i} className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>{airportIn(r, v, (x) => set(r.k, { via: r.via.map((y, j) => (j === i ? x : y)) }), 'DOH', `Via ${i + 1}`)}
                    <button className="btn ghost xs" aria-label="Remove connecting airport" onClick={() => set(r.k, { via: r.via.filter((_, j) => j !== i) })}>×</button></span>)}
                  {r.via.length < 2 && <button className="btn link" onClick={() => set(r.k, { via: [...r.via, ''] })}>+ via</button>}</div></td>
                <td style={{ minWidth: 120 }}>{airportIn(r, r.to, (x) => set(r.k, { to: x }), 'LHR', 'To')}
                  {L.length === 2 ? (L[0] && L[1] && <div className="muted small">{legLabel(L[0], L[1])}</div>)
                    : L.slice(1).map((t, i) => L[i] && t ? <div key={i} className="muted small">{L[i]}→{t} {legLabel(L[i]!, t)}</div> : null)}</td>
              </>)}
              {kind === 'flights' && <>
                <td style={{ minWidth: 128 }}><select className="input" aria-label="Class" value={r.cls} onChange={(e) => set(r.k, { cls: e.target.value })}>{opt.classes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></td>
                <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" aria-label="Return" title="Return" checked={r.ret} onChange={(e) => set(r.k, { ret: e.target.checked })} />
                  <input className="input num" style={{ width: 52 }} inputMode="numeric" aria-label="Trips (journeys × people)" value={r.trips} onChange={(e) => set(r.k, { trips: e.target.value.replace(/[^0-9]/g, '') })} /></span></td>
              </>}
              {kind === 'hotels' && <>
                <td style={{ minWidth: 180 }}><select className="input" aria-label="Country" value={r.hotel} onChange={(e) => set(r.k, { hotel: e.target.value })}>
                  {opt.hotels.map((x) => <option key={x.itemId} value={x.itemId}>{x.country}{x.co2e != null ? ` · ${num(x.co2e)} kg${x.factorYear !== year ? ` (${x.factorYear})` : ''}` : ' · no factor'}</option>)}</select>{err(r)}</td>
                <td style={{ minWidth: 170 }}><select className="input" aria-label="Hotel type" value={r.stars} onChange={(e) => set(r.k, { stars: e.target.value })}>
                  <option value="">Not known · country average</option>{opt.hotelClasses.map((c) => <option key={c.stars} value={c.stars}>{c.label}</option>)}</select>
                  {cl && !hasLib(cl.regions, iso) && <div className="haulhint">No {cl.stars}-star factor in the library yet: country average used</div>}</td>
                <td><input className="input num" style={{ width: 64 }} inputMode="numeric" aria-label="Rooms" value={r.rooms} onChange={(e) => set(r.k, { rooms: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 72 }} inputMode="numeric" aria-label="Nights" placeholder="0" value={r.nights} onChange={(e) => set(r.k, { nights: e.target.value.replace(/[^0-9]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 92 }} inputMode="decimal" aria-label="Meeting space m²" placeholder="m²" value={r.msqm} onChange={(e) => set(r.k, { msqm: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
                <td><input className="input num" style={{ width: 80 }} inputMode="decimal" aria-label="Meeting hours" placeholder="hours" value={r.mhrs} onChange={(e) => set(r.k, { mhrs: e.target.value.replace(/[^0-9.]/g, '') })} />
                  {Number(r.msqm) > 0 && Number(r.mhrs) > 0 && !hasLib(opt.meetingRegions, iso) && <div className="haulhint">Not counted: no meeting-space factor in the library yet</div>}</td>
              </>}
              {kind === 'ground' && <>
                <td style={{ minWidth: 220 }}>{opt.ground.length ? <select className="input" aria-label="Type of transport" value={r.item} onChange={(e) => set(r.k, { item: e.target.value })}>
                  {[...new Set(opt.ground.map((x) => x.group))].map((gr) => <optgroup key={gr} label={gr}>{opt.ground.filter((x) => x.group === gr).map((x) => <option key={x.itemId} value={x.itemId}>{x.name}</option>)}</optgroup>)}
                </select> : <span className="muted small">No transport factors loaded</span>}{g?.note && <div className="haulhint">{g.note}</div>}{err(r)}</td>
                <td><input className="input num" style={{ width: 84 }} inputMode="decimal" placeholder={g?.unit === 'km' ? 'km driven' : 'km'} value={r.km} onChange={(e) => set(r.k, { km: e.target.value.replace(/[^0-9.]/g, '') })} /></td>
                <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><input type="checkbox" aria-label="Return" title="Return" checked={r.ret} onChange={(e) => set(r.k, { ret: e.target.checked })} />
                  <input className="input num" style={{ width: 52 }} inputMode="numeric" aria-label="Trips (journeys × people)" value={r.trips} onChange={(e) => set(r.k, { trips: e.target.value.replace(/[^0-9]/g, '') })} /></span></td>
              </>}
              <td style={{ minWidth: 120 }}><input className="input" placeholder="Name, booking ref." value={r.note} maxLength={300} onChange={(e) => set(r.k, { note: e.target.value })} /></td>
              {emis(r)}{del(r)}
            </tr>);
        })}</tbody>
      </table></div>
      <div className="row"><button className="btn sm" onClick={() => setRows((rs) => [...rs, { ...blank(rs[rs.length - 1]?.m ?? picked[0] ?? 0), cls: rs[rs.length - 1]?.cls ?? 'economy', from: rs[rs.length - 1]?.from ?? '', haul: rs[rs.length - 1]?.haul ?? 'short', hotel: rs[rs.length - 1]?.hotel ?? defHotel }])}>+ Trip</button>
        <span className="muted small">Trips: journeys × people — the same trip made by 3 people counts 3.</span></div>
      {[...new Set(Object.values(res).flatMap((x) => x.warnings ?? []))].slice(0, 3).map((w) => <div key={w} className="note warn">{w}</div>)}
      <div className="softbar"><span className="muted small">{kind === 'flights' ? `DESNZ ${year <= 2026 ? year : 2026} business travel – air, per passenger-km${opt.rf ? ', with radiative forcing' : ''}; well-to-tank counted in 3.6. Flight type: typical one-way distance × the type’s factor.` : kind === 'hotels' ? 'DESNZ hotel stay per room-night; star rating and meeting space from the factor library (CHSB / HCMI).' : 'DESNZ business travel – land and sea; well-to-tank counted in 3.6.'}</span>
        <span className="grow" /><b>{nTrips} trip{nTrips === 1 ? '' : 's'} · {total.toLocaleString('en', { maximumFractionDigits: 3 })} tCO₂e</b></div>
      <div className="row"><span className="muted small">Goes to <b>{approver || 'the approver'}</b> for approval.</span><span className="grow" />
        <button className="btn" disabled={!ok.length || !!busy || ok.length !== entries.length} onClick={() => void save(false)}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
        <button className="btn p" disabled={!ok.length || !!busy || ok.length !== entries.length} onClick={() => void save(true)}>{busy === 'submit' ? 'Submitting…' : 'Submit for approval'}</button></div>
    </div>
  );
}

const HAUL_OPT = (o: TripOptions, key: string) => o.hauls.find((h) => h.key === key);
