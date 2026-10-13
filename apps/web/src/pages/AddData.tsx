/**
 * Capture → Add data, laid out as in the prototype.
 *
 *  - Band: facility (type · manager), status of the months picked (approved / in review / missing),
 *    and the twelve months of the year with their status — pick one or several, they are entered
 *    side by side as rows; or the whole year as one entry.
 *  - Data categories as cards on top, each with its status for the months picked and its scope.
 *  - The entry card: Enter → Review → Approved.
 *      Enter     ways in as cards (type it in, bills, meter readings, fleet, paste, Excel,
 *                automatic feed), then the rows: Save as draft or Submit for approval.
 *      Review    entries not yet approved: submit, withdraw, approve or send back with a note
 *                (nobody approves their own entry), delete a draft.
 *      Approved  what counts in the dashboards for these months.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CategoryBills, ReadingBatches } from './CategoryBills';
import { Icon } from '../components/Icon';
import { useApp } from '../App';
import { unitLabel, api, ApiError, num, tco2e, type CalcResponse, type Category, type DataStatus, type Facility, type ReviewEntry } from '../lib/api';
import { Result } from '../components/Result';
import { VehicleEntry, type VehicleMode } from './VehicleEntry';
import { EnergyEntry } from './EnergyEntry';
import { WasteEntry } from './WasteEntry';
import { PurchaseEntry } from './PurchaseEntry';
import { CommutingEntry } from './CommutingEntry';
import { WaterEntry } from './WaterEntry';
import { TripEntry, type TripKind } from './TripEntry';
import { MonthGrid } from '../components/MonthGrid';
import { EntryContext } from '../components/EntryContext';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const groupOf = (code: string) => (code.startsWith('waste_') ? 'waste' : code.startsWith('water_') ? 'water' : code);
const ICON: Record<string, string> = {
  stationary_combustion: 'flame', mobile_combustion: 'truck', purchased_electricity: 'bolt', fugitive: 'snow', waste: 'bin', water: 'drop',
  purchased_goods: 'cart', employee_commuting: 'bus', business_travel: 'plane',
};

const SHORT: Record<string, string> = {
  stationary_combustion: 'Fuels', mobile_combustion: 'Vehicles', fugitive: 'Refrigerants', waste: 'Waste', purchased_electricity: 'Electricity',
  purchased_goods: 'Purchases', employee_commuting: 'Commuting', water: 'Water',
};
const catName = (c: Category) => (c.code.startsWith('waste_') ? 'Waste' : c.code.startsWith('water_') ? 'Water' : c.code === 'purchased_goods' ? 'Purchases' : c.name);
type MState = 'approved' | 'review' | 'draft' | 'returned' | 'missing' | 'none' | 'open' | 'future';
const MSTYLE: Record<MState, [string, string]> = {
  approved: ['Approved', 'c-ok'], review: ['In review', 'c-warn'], draft: ['Draft', 'c-n'], returned: ['Sent back', 'c-bad'],
  missing: ['Missing', 'c-bad'], none: ['—', 'c-n'], open: ['Open', 'c-info'], future: ['Future', 'c-n'],
};
const LSTYLE: Record<ReviewEntry['status'], [string, string]> = { draft: ['Draft', 'c-n'], submitted: ['Waiting approval', 'c-warn'], approved: ['Approved', 'c-ok'], rejected: ['Sent back', 'c-bad'] };

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

/** Ways in, shown as cards. */
type Way = 'form' | 'bills' | 'readings' | 'fleet' | 'paste' | 'upload' | 'auto' | 'flights' | 'hotels' | 'ground' | 'spend';
const WAYS: Record<Way, [string, string, string]> = {
  form: ['Type it in', 'edit', 'One row per month. Units are fixed per type, so nobody mixes litres and gallons.'],
  bills: ['Upload bills', 'doc', 'PDF bills are read, matched to the meter of the account, checked and previewed, then published as the months’ entries.'],
  readings: ['Meter readings', 'gauge', 'Batches sent by connected meters (hourly to monthly) are previewed before they count.'],
  fleet: ['Whole fleet', 'grid', 'Every vehicle of the facility as a row: type the distance or fuel of each.'],
  paste: ['Paste a table', 'paste', 'Paste rows from a spreadsheet in everyday words, e.g. “car petrol | 2 | 34 km”.'],
  upload: ['Excel / CSV', 'download', 'Download a template for this facility and these months, fill it in, then upload it here.'],
  auto: ['Automatic feed', 'feed', 'Connected systems post data straight into Ekotrace.'],
  flights: ['Flights', 'plane', 'One row per trip: airports or flight type, class, return and how many trips.'],
  hotels: ['Hotel stays', 'building', 'Room stays (rooms × nights) or meetings and events (m² × hours), one row each.'],
  ground: ['Other transport', 'bus', 'Trains, buses, taxis, hire cars and ferries: one-way km, return, trips.'],
  spend: ['By spend', 'cart', 'Fares, hotels and taxis known only by the amount paid: spend-based factors (EPA). Expense or travel-agency files go through Purchases.'],
};

export function AddData() {
  const { category: catCode = 'stationary_combustion' } = useParams();
  const { tenant, toast } = useApp();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const stage = (sp.get('stage') as 'enter' | 'review' | 'approved' | null) ?? 'enter';
  const group = groupOf(catCode);
  /** Categories that take bills and meter readings (an account / meter per supply). */
  const billCat = catCode === 'purchased_electricity' || catCode === 'stationary_combustion' ? catCode : catCode.startsWith('waste_') ? 'waste' : catCode.startsWith('water_') ? 'water' : null;
  const [cat, setCat] = useState<Category | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState(() => new URLSearchParams(window.location.search).get('facility') ?? '');
  const now = new Date(), nowY = now.getFullYear(), nowM = now.getMonth();
  // ?year= and ?month= (1–12) open a given month, e.g. from Data progress
  const q0 = new URLSearchParams(window.location.search), qy = Number(q0.get('year')), qm = Number(q0.get('month'));
  const [year, setYear] = useState(qy >= 2000 && qy <= 2100 ? qy : nowY);
  /** months picked (0–11); `whole` = one entry for the whole year */
  const [picked, setPicked] = useState<number[]>([qm >= 1 && qm <= 12 ? qm - 1 : Math.max(0, nowM - 1)]);
  const [whole, setWhole] = useState(false);
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const yearly = cat?.calc_method === 'travel';
  const single = cat?.calc_method === 'spend';
  const ways: Way[] = !cat ? [] : cat.calc_method === 'trip' ? ['flights', 'hotels', 'ground', 'spend'] : cat.calc_method === 'vehicle' ? ['form', 'fleet', 'paste', 'upload'] : billCat ? ['form', 'bills', 'readings', 'auto'] : ['form'];
  const way = ((sp.get('via') as Way | null) ?? 'form');
  const wayOk: Way = ways.includes(way) ? way : ways[0] ?? 'form';

  // Load catalogue for this category and the company's facilities.
  useEffect(() => {
    api.catalogue().then((c) => {
      const found = c.categories.find((x) => x.code === catCode) ?? null;
      setCat(found);
      setCats(c.categories.filter((x) => x.active !== false));
    });
  }, [catCode, tenant?.id]);
  useEffect(() => {
    api.facilities().then((f) => { const mine = f.facilities.filter((x) => x.canEnter); setFacilities(mine); setFacilityId((id) => (mine.some((x) => x.id === id) ? id : mine[0]?.id ?? '')); });
  }, [tenant?.id]);
  useEffect(() => {
    if (!facilityId) { setStatus(null); return; }
    api.dataStatus(facilityId, year).then(setStatus).catch(() => setStatus(null));
  }, [facilityId, year, tick]);
  // Purchases are entered one month at a time.
  useEffect(() => { if (single && picked.length > 1) setPicked([picked[picked.length - 1]!]); }, [single]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- status of months and categories --
  const isFuture = (m: number) => year > nowY || (year === nowY && m > nowM);
  const mState = (g: string, m: number): MState => {
    const c = (status?.cells ?? []).filter((x) => groupOf(x.cat) === g && x.m === m + 1)
      .reduce((a, x) => ({ d: a.d + x.draft, s: a.s + x.submitted, ap: a.ap + x.approved, r: a.r + x.rejected }), { d: 0, s: 0, ap: 0, r: 0 });
    if (c.d + c.s + c.ap + c.r === 0) return isFuture(m) ? 'future' : year === nowY && m === nowM ? 'open' : (status?.usual ?? []).some((u) => groupOf(u) === g) ? 'missing' : 'none';
    return c.r ? 'returned' : c.s ? 'review' : c.d ? 'draft' : 'approved';
  };
  const shownMonths = yearly || whole ? MONTHS.map((_, i) => i).filter((m) => !isFuture(m)) : picked;
  const catState = (g: string) => {
    const sts = shownMonths.map((m) => mState(g, m)), n = sts.length;
    const miss = sts.filter((x) => x === 'missing').length, back = sts.filter((x) => x === 'returned').length, rev = sts.filter((x) => x === 'review').length, dr = sts.filter((x) => x === 'draft').length;
    if (!n) return { label: 'Pick a month', cls: 'muted', k: 'none' };
    if (back) return { label: `Sent back${n > 1 ? ` · ${back} of ${n}` : ''}`, cls: 'bad', k: 'missing' };
    if (miss) return { label: miss === n ? 'Missing' : `Missing ${miss} of ${n}`, cls: 'bad', k: 'missing' };
    if (sts.every((x) => x === 'none' || x === 'open' || x === 'future')) return { label: 'Optional · nothing yet', cls: 'muted', k: 'none' };
    if (rev) return { label: 'Waiting approval', cls: 'warn', k: 'review' };
    if (dr) return { label: 'Draft · not submitted', cls: 'muted', k: 'review' };
    return { label: 'Approved', cls: 'ok', k: 'approved' };
  };
  const tabs = cats.filter((c) => c.code !== 'waste_generated' && c.code !== 'water_discharge' && (c.calc_method !== 'spend' || c.code === 'purchased_goods'));
  const expected = tabs.filter((c) => (status?.usual ?? []).some((u) => groupOf(u) === groupOf(c.code)));
  const summary = expected.map((c) => catState(groupOf(c.code)).k);
  const counts = useMemo(() => {
    const c = (status?.cells ?? []).filter((x) => groupOf(x.cat) === group && shownMonths.includes(x.m - 1));
    return { open: c.reduce((a, x) => a + x.draft + x.submitted + x.rejected, 0), drafts: c.reduce((a, x) => a + x.draft + x.rejected, 0), approved: c.reduce((a, x) => a + x.approved, 0) };
  }, [status, group, shownMonths.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMonth = (m: number) => {
    setWhole(false);
    if (single) { setPicked([m]); return; }
    setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m].sort((a, b) => a - b)));
  };
  const allOpen = () => {
    setWhole(false);
    const open = MONTHS.map((_, i) => i).filter((m) => !isFuture(m) && ['missing', 'none', 'open', 'draft', 'returned'].includes(mState(group, m)));
    setPicked(single ? open.slice(-1) : open.length ? open : MONTHS.map((_, i) => i).filter((m) => !isFuture(m)));
  };
  const periodLabel = yearly || whole ? `${year}, whole year` : picked.length ? picked.map((m) => MONTHS[m]).join(', ') + ` ${year}` : 'pick a month above';
  const reviewRange = yearly || whole || !picked.length ? { from: iso(year, 0, 1), to: iso(year, 11, 1) } : { from: iso(year, picked[0]!, 1), to: iso(year, picked[picked.length - 1]!, 1) };
  /** the period of a single entry: one month, or the whole year */
  const period = whole || yearly || !picked.length ? { periodStart: iso(year, 0, 1), periodEnd: iso(year, 11, 31) } : { periodStart: iso(year, picked[0]!, 1), periodEnd: iso(year, picked[0]!, lastDay(year, picked[0]!)) };
  /** rows for the months picked (most categories); a single form for one entry */
  const rows = !whole && !yearly && picked.length > 0;
  const fac = facilities.find((f) => f.id === facilityId);
  const groups = useMemo(() => { const g = new Map<string, Facility[]>(); for (const f of facilities) { const k = f.parent_name ?? ''; g.set(k, [...(g.get(k) ?? []), f]); } return [...g]; }, [facilities]);

  if (!cat) return <div className="page"><div className="card empty">Loading…</div></div>;
  const ctx = { months: whole || yearly ? null : picked, approver: status?.approver ?? '', changed: refresh };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1 className="h1big">Add data</h1></div>
        <span className="sub" style={{ maxWidth: 520 }}>Anyone with access to a facility can add its data. Nobody approves their own entry.</span>
      </div>

      <section className="card band">
        <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
          <label className="pick"><span className="lbl">Facility · {facilities.length} you can add data for</span>
            <select className="bigsel" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              {!facilities.length && <option value="">No facilities you can enter data for — ask your administrator</option>}
              {groups.map(([g, fs]) => g ? <optgroup key={g} label={g}>{fs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup> : fs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>))}
            </select></label>
          <div className="pick"><span className="lbl">Type · manager</span><b className="bandval">{status?.facility.type ?? fac?.facility_type ?? 'Facility'} · {status?.facility.manager ?? 'no manager set'}</b></div>
          <label className="pick"><span className="lbl">Year</span>
            <select className="bigsel" style={{ minWidth: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2022, 2023, 2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}</select></label>
          <span className="grow" />
          {expected.length > 0 && <div className="row" style={{ gap: 6 }}>
            <span className="chip c-ok">{summary.filter((x) => x === 'approved').length} of {expected.length} approved</span>
            <span className="chip c-warn">{summary.filter((x) => x === 'review').length} in review</span>
            <span className="chip c-bad">{summary.filter((x) => x === 'missing').length} missing</span>
          </div>}
        </div>
        {yearly ? <div className="note info" style={{ margin: 0 }}>{cat.name} is entered once a year per facility: {year}.</div> : <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="lbl">Months of {year} · {single ? 'pick one' : 'pick one or several — they’re entered side by side'}</span><span className="grow" />
            {!single && <button className="btn sm" onClick={allOpen}>All open months</button>}
            {!single && <button className={`btn sm ${whole ? 'p' : ''}`} title="One entry for the whole year (e.g. refrigerant screening, landfill)" onClick={() => setWhole(!whole)}>Whole year</button>}
            {!single && <button className="btn sm ghost" onClick={() => { setWhole(false); setPicked([]); }}>Clear</button>}
          </div>
          <div className="months">{MONTHS.map((name, m) => {
            const st = mState(group, m), on = !whole && picked.includes(m), off = st === 'future';
            return (
              <button key={m} className={`mbtn${on ? ' on' : ''}${off ? ' off' : ''}${whole && !off ? ' yr' : ''}`} disabled={off} aria-pressed={on} title={`${name} ${year} · ${MSTYLE[st][0]}`} onClick={() => toggleMonth(m)}>
                <b>{name}</b><small className={on ? '' : MSTYLE[st][1]}>{MSTYLE[st][0]}</small>
              </button>);
          })}</div>
        </div>}
      </section>

      <EntryContext.Provider value={ctx}>
      <div className="entrylayout">
      <nav className="card catrail" aria-label="Data categories">
        <div className="lbl" style={{ padding: '6px 10px 8px' }}>Data categories · {yearly || whole ? year : picked.length ? picked.map((m) => MONTHS[m]).join(', ') : 'pick months'}</div>
        {tabs.map((c) => {
          const g = groupOf(c.code), st = catState(g), on = g === group;
          return (
            <button key={c.code} className={`catbtn${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}
              onClick={() => navigate(`/data/${c.code}${sp.get('stage') ? `?stage=${sp.get('stage')}` : ''}`)}>
              <span className="ic"><Icon name={ICON[g] ?? 'list'} /></span>
              <span className="grow" style={{ minWidth: 0 }}><b>{catName(c)}</b><small className={st.cls}>{st.label}</small></span>
              <span className="chip c-n">S{g === 'waste' ? '1/3' : c.scope}</span>
            </button>);
        })}
        <div className="muted small" style={{ padding: '10px 10px 4px', lineHeight: 1.5 }}>Missing = a past month with nothing, for a category this facility reports.</div>
      </nav>
      <section className="card flush entrycard">
        <div className="entryhead">
          <span className="ic lg"><Icon name={ICON[group] ?? 'list'} size={20} /></span>
          <div><div className="row" style={{ gap: 8 }}><h2>{catName(cat)}</h2><span className="chip c-n">S{group === 'waste' ? '1 / 3' : cat.scope}</span><span className={`chip ${{ ok: 'c-ok', warn: 'c-warn', bad: 'c-bad', muted: 'c-n' }[catState(group).cls] ?? 'c-n'}`}>{catState(group).label}</span></div><div className="sub">{fac?.name ?? '—'} · {periodLabel}</div></div>
          <span className="grow" />
          <div className="row" style={{ gap: 4 }}>
            {([['enter', '1', 'Enter'], ['review', '2', `Review${counts.open ? ` · ${counts.open}` : ''}`], ['approved', '3', `Approved${counts.approved ? ` · ${counts.approved}` : ''}`]] as const).map(([k, n, t], i) => (
              <span key={k} className="row" style={{ gap: 4 }}>
                <button className={`stg${stage === k ? ' on' : ''}`} onClick={() => setParam('stage', k === 'enter' ? null : k)}><i>{n}</i>{t}</button>
                {i < 2 && <span className="muted" aria-hidden="true">›</span>}
              </span>))}
          </div>
        </div>
        <div className="entrybody">
          {stage === 'review' ? <ReviewStage facilityId={facilityId} group={group} range={reviewRange} approver={status?.approver ?? ''} onChange={refresh} toast={toast} />
            : stage === 'approved' ? <ApprovedStage facilityId={facilityId} group={group} range={reviewRange} onChange={refresh} toast={toast} />
            : <>
              {ways.length > 1 && <>
                <div className="methods">{ways.map((w) => (
                  <button key={w} className={`meth${wayOk === w ? ' on' : ''}`} onClick={() => (w === 'auto' ? navigate('/integrations') : setParam('via', w === ways[0] ? null : w))}>
                    <Icon name={WAYS[w][1]} size={16} />{WAYS[w][0]}{w === 'auto' && <small>→ Integrations</small>}
                  </button>))}
                </div>
                <div className="sub" style={{ marginTop: -4 }}>{WAYS[wayOk][2]}</div>
              </>}
              {cat.description && ways.length <= 1 && <div className="sub">{cat.description}</div>}
              {!facilityId ? <div className="note info">No facility to enter data for.</div>
                : !rows && !whole && !yearly ? <div className="note info">Pick one or more months above.</div>
                : billCat && wayOk === 'bills' ? <CategoryBills category={billCat} />
                : billCat && wayOk === 'readings' ? <ReadingBatches category={billCat} />
                : <CategoryForm cat={cat} cats={cats} facilityId={facilityId} year={year} period={period} rows={rows} picked={picked} fac={fac} way={wayOk} onSaved={refresh} />}
              {counts.drafts > 0 && <div className="softbar">
                <span><b>{counts.drafts} draft{counts.drafts === 1 ? '' : 's'}</b> for {periodLabel} not yet submitted.</span><span className="grow" />
                <button className="btn sm p" onClick={() => setParam('stage', 'review')}>Review and submit →</button>
              </div>}
            </>}
        </div>
      </section>
      </div>
      </EntryContext.Provider>
    </div>
  );
}

/** The entry form of the category: rows for the months picked, or one entry. */
function CategoryForm({ cat, cats, facilityId, year, period, rows, picked, fac, way, onSaved }: {
  cat: Category; cats: Category[]; facilityId: string; year: number; period: { periodStart: string; periodEnd: string }; rows: boolean; picked: number[];
  fac?: Facility; way: Way; onSaved: () => void;
}) {
  const monthly = rows ? year : undefined;
  switch (cat.calc_method) {
    case 'water': return <WaterEntry cats={cats} facilityId={facilityId} period={period} onSaved={onSaved} monthly={monthly} />;
    case 'travel': return <CommutingEntry facilityId={facilityId} year={year} onSaved={onSaved} />;
    case 'trip': return <TripEntry kind={way as TripKind} facilityId={facilityId} year={year} onSaved={onSaved} />;
    case 'spend': return <PurchaseEntry cat={cat} facilityId={facilityId} period={period} onSaved={onSaved} />;
    case 'waste': case 'waste_disposal': return <WasteEntry cat={cat} cats={cats} facilityId={facilityId} period={period} onSaved={onSaved} monthly={monthly} />;
    // Certificates and contracts are claimed one month at a time: one month → the full form.
    case 'electricity': return <EnergyEntry cat={cat} facilityId={facilityId} period={period} onSaved={onSaved} monthly={rows && picked.length > 1 ? year : undefined}
      facilityRegion={fac?.grid_region ?? null} country={fac?.country ?? 'AE'} />;
    case 'vehicle': return <VehicleEntry cat={cat} facilityId={facilityId} period={period} onSaved={onSaved} monthly={monthly} mode={(way === 'form' ? 'one' : way) as VehicleMode} />;
    default: return <FuelForm cat={cat} facilityId={facilityId} year={year} period={period} rows={rows} onSaved={onSaved} />;
  }
}

/** Stationary combustion and refrigerants: the type per row, or one entry with the full calculation. */
function FuelForm({ cat, facilityId, year, period, rows, onSaved }: { cat: Category; facilityId: string; year: number; period: { periodStart: string; periodEnd: string }; rows: boolean; onSaved: () => void }) {
  const { tenant, toast } = useApp();
  const fugitive = cat.calc_method === 'fugitive';
  const [subId, setSubId] = useState<number | null>(cat.subcategories[0]?.id ?? null);
  useEffect(() => { setSubId(cat.subcategories[0]?.id ?? null); }, [cat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const sub = cat.subcategories.find((s) => s.id === subId) ?? null;
  const [itemId, setItemId] = useState<number | null>(null);
  useEffect(() => { setItemId(sub?.items[0]?.id ?? null); }, [subId]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = sub?.items.find((i) => i.id === itemId) ?? null;
  const [units, setUnits] = useState<{ code: string; name: string; dimension: string }[]>([]);
  const [unit, setUnit] = useState('');
  useEffect(() => {
    if (!itemId) { setUnits([]); return; }
    api.itemUnits(itemId).then((u) => { setUnits(u.units); setUnit((x) => (u.units.some((y) => y.code === x) ? x : u.defaultUnit ?? u.units[0]?.code ?? '')); });
  }, [itemId]);
  // Own calorific value (fuels only)
  const [useCv, setUseCv] = useState(false);
  const [cvValue, setCvValue] = useState('');
  const [cvTouched, setCvTouched] = useState(false);
  const [cvEnergy, setCvEnergy] = useState('MJ');
  const [cvPer, setCvPer] = useState('');
  const [cvUnits, setCvUnits] = useState<{ code: string; name: string; dimension: string }[]>([]);
  const [cvSuggest, setCvSuggest] = useState<{ value: number; source: string } | null>(null);
  const enteredDim = units.find((u) => u.code === unit)?.dimension;
  const cvPossible = cat.calc_method === 'combustion' && (enteredDim === 'mass' || enteredDim === 'volume') && cvUnits.length > 0;
  const perOptions = units.filter((u) => u.dimension === enteredDim);
  useEffect(() => { setCvPer(unit); }, [unit]);
  useEffect(() => {
    if (!itemId) return;
    api.itemCv(itemId, { energyUnit: '', perUnit: '', date: `${year}-01-01` }).then((r) => {
      setCvUnits(r.energyUnits);
      setCvEnergy((e) => (r.energyUnits.some((u) => u.code === e) ? e : r.energyUnits.find((u) => u.code === 'MJ')?.code ?? r.energyUnits[0]?.code ?? ''));
    }).catch(() => setCvUnits([]));
  }, [itemId, year]);
  useEffect(() => {
    if (!itemId || !useCv || !cvEnergy || !cvPer) return;
    api.itemCv(itemId, { energyUnit: cvEnergy, perUnit: cvPer, date: `${year}-01-01` }).then((r) => {
      setCvSuggest(r.suggested);
      if (!cvTouched && r.suggested) setCvValue(String(Number(r.suggested.value.toPrecision(5))));
    }).catch(() => setCvSuggest(null));
  }, [itemId, useCv, cvEnergy, cvPer, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const cv = cvPossible && useCv && Number(cvValue) > 0 && cvPer ? { value: Number(cvValue), energyUnit: cvEnergy, perUnit: cvPer } : undefined;

  const [method, setMethod] = useState<Method>('quantity');
  const [fug, setFug] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState('');
  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  /** One row of the months picked: the row's type (fuel or gas) with its quantity. Own CV applies to the fuel chosen above only. */
  const types = useMemo(() => (cv ? undefined : sub?.items.map((i) => ({ id: String(i.id), name: i.name }))), [sub, cv]);
  const buildRow = useMemo(() => (v: number, p: { periodStart: string; periodEnd: string }, type?: string) => {
    const id = type ? Number(type) : itemId;
    if (!id || !unit) return null;
    const base = { itemId: id, unit, ...p };
    if (fugitive) return { ...base, fugitive: { method: 'quantity', released: v } };
    return { ...base, quantity: v, ...(cv ? { cv } : {}) };
  }, [itemId, unit, fugitive, cv]);

  const payload = useMemo(() => {
    if (!itemId || !unit) return null;
    const base = { itemId, unit, facilityId: facilityId || undefined, ...period };
    if (fugitive) {
      const data: Record<string, number | string> = { method };
      for (const f of FUGITIVE_FIELDS[method]) {
        const v = fug[f.key];
        if (v === undefined || v === '') { if (!f.optional) return null; continue; }
        data[f.key] = Number(v);
      }
      return { ...base, fugitive: data };
    }
    if (quantity === '') return null;
    return { ...base, quantity: Number(quantity), ...(cv ? { cv } : {}) };
  }, [itemId, unit, facilityId, period, fugitive, method, fug, quantity, cv]);
  useEffect(() => {
    setError(null);
    if (rows || !payload) { setResult(null); return; }
    const t = window.setTimeout(() => { api.calculate(payload).then(setResult).catch((e: ApiError) => { setResult(null); setError(e.message); }); }, 250);
    return () => window.clearTimeout(t);
  }, [payload, rows]);

  async function save(submit: boolean) {
    if (!payload || !facilityId) return;
    setSaving(submit ? 'submit' : 'draft');
    try {
      const r = await api.saveActivity({ ...payload, facilityId, dataType, note: note || undefined });
      if (submit) await api.reviewAction([r.id], 'submit');
      toast(`${submit ? 'Submitted' : 'Saved as draft'}: ${item?.name} · ${tco2e(r.totals.direct)} tCO₂e`);
      setQuantity(''); setFug({}); setNote(''); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(null); }
  }

  const unitName = units.find((u) => u.code === unit)?.name ?? unit;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <label className="field" style={{ minWidth: 220 }}><span>{fugitive ? 'Gas group' : 'Fuel class'}</span>
          <select className="input" value={subId ?? ''} onChange={(e) => setSubId(Number(e.target.value))}>
            {cat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_bioenergy ? ' (bioenergy)' : ''}</option>)}</select></label>
        {(!rows || cv) && <label className="field grow" style={{ minWidth: 240 }}><span>{fugitive ? 'Gas or refrigerant' : 'Fuel'}</span>
          <select className="input" value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))}>{sub?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
        <label className="field" style={{ width: 170 }}><span>Unit</span>
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>
        {fugitive && <div className="seg" style={{ alignSelf: 'flex-end' }}>
          {(['quantity', 'screening', 'mass_balance'] as Method[]).map((m) => (
            <button key={m} className={method === m ? 'on' : ''} onClick={() => { setMethod(m); setFug({}); }}>{m === 'quantity' ? 'Quantity refilled' : m === 'screening' ? 'Screening' : 'Mass balance'}</button>))}
        </div>}
      </div>
      {fugitive && <div className="sub">{METHOD_HELP[method]}</div>}
      {!fugitive && sub?.is_bioenergy && <div className="sub">Bioenergy: CH₄ and N₂O count in Scope 1; the CO₂ is biogenic and reported separately.</div>}
      {item && (item.composition?.length || item.note) && (!rows || cv) && <div className="sub">
        {item.composition?.length ? <>Composition: {item.composition.map((c) => `${c.gas} ${num(c.fraction * 100, 4)} %`).join(' · ')}. </> : null}{item.note}</div>}

      {cvPossible && (
        <div className="cvbox">
          <label className="row" style={{ gap: 8, fontWeight: 600 }}>
            <input type="checkbox" checked={useCv} onChange={(e) => { setUseCv(e.target.checked); setCvTouched(false); }} />
            Use our own calorific value
            <span className="sub" style={{ fontWeight: 400 }}>e.g. from the fuel supplier's certificate or a lab analysis{rows ? ' — applies to the fuel chosen here, for every row' : ''}</span>
          </label>
          {useCv && <>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field" style={{ width: 150 }}><span>Calorific value</span>
                <input className="input num" inputMode="decimal" value={cvValue} placeholder="0" onChange={(e) => { setCvTouched(true); setCvValue(e.target.value.replace(/[^0-9.]/g, '')); }} /></label>
              <label className="field" style={{ width: 170 }}><span>Energy unit</span>
                <select className="input" value={cvEnergy} onChange={(e) => { setCvEnergy(e.target.value); setCvTouched(false); }}>
                  <optgroup label="Net (lower heating value)">{cvUnits.filter((u) => u.dimension === 'energy_net').map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</optgroup>
                  <optgroup label="Gross (higher heating value)">{cvUnits.filter((u) => u.dimension === 'energy_gross').map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</optgroup>
                </select></label>
              <span style={{ paddingBottom: 10 }}>per</span>
              <label className="field" style={{ width: 150 }}><span>Unit</span>
                <select className="input" value={cvPer} onChange={(e) => { setCvPer(e.target.value); setCvTouched(false); }}>{perOptions.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>
            </div>
            <div className="sub">
              {cvSuggest ? <>{cvSuggest.source} default: <b>{num(cvSuggest.value, 5)}</b> {cvUnits.find((u) => u.code === cvEnergy)?.name} per {perOptions.find((u) => u.code === cvPer)?.name}.{' '}
                {cvTouched && <button className="btn ghost sm" onClick={() => { setCvTouched(false); setCvValue(String(Number(cvSuggest.value.toPrecision(5)))); }}>Use default</button>}</> : 'No default available for this combination.'}
              {' '}The quantity is converted to energy with your value, then the {item?.name} factors per unit of energy are applied.
            </div>
          </>}
        </div>
      )}

      {rows ? (fugitive && method !== 'quantity'
        ? <div className="note info">Screening and mass balance cover a year: choose <b>Whole year</b> above. Month by month works with “Quantity refilled”.</div>
        : <MonthGrid year={year} facilityId={facilityId} label={fugitive ? 'Refilled, by month' : 'Used, by month'} unitName={unitLabel(unit) || unitName}
            types={types} build={buildRow} onSaved={onSaved}
            dup={{ category: cat.code, same: (a, type) => a.item === (sub?.items.find((i) => String(i.id) === (type ?? String(itemId)))?.name ?? item?.name) }}
            factorText={`Factors: DESNZ ${year <= 2026 ? year : '2026 (latest)'} · GWP ${tenant?.gwp_set ?? ''}${cv ? ` · own calorific value for ${item?.name}` : ''}. Paste a column from Excel into the first quantity to fill the rows below.`} />)
        : <>
          {fugitive ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {FUGITIVE_FIELDS[method].map((f) => (
              <label key={f.key} className="field"><span>{f.label}{f.optional ? ' (optional)' : ''} · {f.pct ? '%' : unitName}</span>
                <input className="input num" inputMode="decimal" value={fug[f.key] ?? ''} placeholder="0" onChange={(e) => setFug({ ...fug, [f.key]: e.target.value.replace(/[^0-9.]/g, '') })} /></label>))}
          </div> : <label className="field" style={{ width: 220 }}><span>Quantity for {period.periodStart.slice(0, 4)}</span>
            <input className="input num" inputMode="decimal" value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ''))} /></label>}
          <div className="row">
            <label className="field" style={{ width: 160 }}><span>Data type</span>
              <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></label>
            <label className="field grow"><span>Note / reference</span>
              <input className="input" value={note} maxLength={1000} placeholder="Invoice no., meter, service report…" onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          {error && <div className="note bad">{error}</div>}
          {result ? <Result r={result} /> : !error && <div className="note info">Enter the {fugitive ? 'figures' : 'quantity'} to see the emissions, the split per gas and how they were calculated.</div>}
          <div className="row"><span className="grow" />
            <button className="btn" disabled={!result || !!saving} onClick={() => void save(false)}>{saving === 'draft' ? 'Saving…' : 'Save as draft'}</button>
            <button className="btn p" disabled={!result || !!saving} onClick={() => void save(true)}>{saving === 'submit' ? 'Submitting…' : 'Submit for approval'}</button></div>
        </>}
    </div>
  );
}

// ------------------------------------------------------------------ Review and Approved --
const ml = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const what = (e: ReviewEntry) => [e.vehicle, e.meter, e.waste_site].filter(Boolean).join(' · ');

function EntryRows({ list, onAct, busy }: { list: ReviewEntry[]; onAct?: (e: ReviewEntry, a: 'submit' | 'withdraw' | 'approve' | 'return' | 'delete', note?: string) => void; busy: boolean }) {
  const [back, setBack] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [del, setDel] = useState<string | null>(null);
  return (
    <div className="scrollx"><table className="t">
      <thead><tr><th>Month</th><th>What</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th>Scope</th><th>Status</th><th>Entered by</th>{onAct && <th />}</tr></thead>
      <tbody>{list.map((e) => (
        <tr key={e.id}>
          <td style={{ whiteSpace: 'nowrap' }}><b>{ml(e.period_start)}</b>{e.period_end.slice(0, 7) !== e.period_start.slice(0, 7) && <div className="muted small">to {ml(e.period_end)}</div>}</td>
          <td><b>{e.item}</b><div className="muted small">{[what(e), e.note, e.data_type !== 'actual' ? e.data_type : ''].filter(Boolean).join(' · ')}</div>
            {e.status === 'rejected' && e.review_note && <div className="small bad">Sent back by {e.reviewed_by_name ?? 'the approver'}: {e.review_note}</div>}</td>
          <td className="num">{num(e.quantity)} <span className="muted">{unitLabel(e.unit)}</span></td>
          <td className="num"><b>{tco2e(e.kg)}</b></td>
          <td><span className={`chip s${e.scope}`}>S{e.scope}</span></td>
          <td><span className={`chip ${LSTYLE[e.status][1]}`}>{LSTYLE[e.status][0]}</span></td>
          <td className="small">{e.entered_by ?? 'System'}{e.mine && <span className="muted"> (you)</span>}</td>
          {onAct && <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
            {back === e.id ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input className="input" style={{ width: 220 }} autoFocus placeholder="Why — so it can be fixed" value={why} onChange={(x) => setWhy(x.target.value)} />
              <button className="btn sm p" disabled={!why.trim() || busy} onClick={() => { onAct(e, 'return', why.trim()); setBack(null); setWhy(''); }}>Send back</button>
              <button className="btn sm ghost" onClick={() => setBack(null)}>Cancel</button></span>
            : del === e.id ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><span className="small bad">Delete this entry?</span>
              <button className="btn sm danger" disabled={busy} onClick={() => { onAct(e, 'delete'); setDel(null); }}>Delete</button><button className="btn sm ghost" onClick={() => setDel(null)}>Keep</button></span>
            : <span className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
              {e.canSubmit && <button className="btn sm" disabled={busy} onClick={() => onAct(e, 'submit')}>Submit</button>}
              {e.canWithdraw && e.mine && <button className="btn sm ghost" disabled={busy} onClick={() => onAct(e, 'withdraw')}>Withdraw</button>}
              {e.canApprove && <button className="btn sm p" disabled={busy} onClick={() => onAct(e, 'approve')}>Approve</button>}
              {e.canReturn && <button className="btn sm ghost danger" disabled={busy} onClick={() => setBack(e.id)}>Send back</button>}
              {e.canDelete && <button className="btn sm ghost danger" disabled={busy} onClick={() => setDel(e.id)}>Delete</button>}
            </span>}
          </td>}
        </tr>))}
      </tbody>
    </table></div>
  );
}

function useStage(facilityId: string, group: string, range: { from: string; to: string }, stage: 'open' | 'approved') {
  const [list, setList] = useState<ReviewEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!facilityId) return;
    api.review({ facilityId, category: group, from: range.from, to: range.to, stage }).then((r) => { setList(r.entries); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [facilityId, group, range.from, range.to, stage]);
  useEffect(load, [load]);
  return { list, err, load };
}

function useActions(load: () => void, onChange: () => void, toast: (t: string) => void) {
  const [busy, setBusy] = useState(false);
  const act = async (ids: string[], a: 'submit' | 'withdraw' | 'approve' | 'return' | 'delete', note?: string) => {
    setBusy(true);
    try {
      if (a === 'delete') { for (const id of ids) await api.deleteActivity(id); toast('Deleted'); }
      else {
        const r = await api.reviewAction(ids, a, note);
        const verb = { submit: 'submitted', withdraw: 'withdrawn', approve: 'approved', return: 'sent back' }[a];
        toast(`${r.done} ${verb}${r.skipped.length ? ` · ${r.skipped.length} not: ${r.skipped[0]!.reason}` : ''}`);
      }
      load(); onChange();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, act };
}

function ReviewStage({ facilityId, group, range, approver, onChange, toast }: { facilityId: string; group: string; range: { from: string; to: string }; approver: string; onChange: () => void; toast: (t: string) => void }) {
  const { list, err, load } = useStage(facilityId, group, range, 'open');
  const { busy, act } = useActions(load, onChange, toast);
  if (err) return <div className="note bad">{err}</div>;
  if (!list) return <div className="muted">Loading…</div>;
  const drafts = list.filter((e) => e.canSubmit), toApprove = list.filter((e) => e.canApprove), sum = list.reduce((a, e) => a + e.kg, 0);
  return <>
    <div className="row"><span className="sub">Entries not yet approved. Approvers see the quantity, the note and the check — nobody approves their own entry.</span><span className="grow" />
      {drafts.length > 0 && <button className="btn p" disabled={busy} onClick={() => void act(drafts.map((e) => e.id), 'submit')}>Submit {drafts.length} draft{drafts.length === 1 ? '' : 's'}</button>}
      {toApprove.length > 1 && <button className="btn p" disabled={busy} onClick={() => void act(toApprove.map((e) => e.id), 'approve')}>Approve all {toApprove.length}</button>}
    </div>
    {list.length ? <EntryRows list={list} busy={busy} onAct={(e, a, note) => void act([e.id], a, note)} /> : <div className="empty">Nothing waiting for these months. Approved entries are under step 3.</div>}
    {list.length > 0 && <div className="softbar"><b>Waiting: {tco2e(sum)} tCO₂e</b><span className="grow" /><span className="muted small">Approver: {approver || '—'}</span></div>}
  </>;
}

function ApprovedStage({ facilityId, group, range, onChange, toast }: { facilityId: string; group: string; range: { from: string; to: string }; onChange: () => void; toast: (t: string) => void }) {
  const { list, err, load } = useStage(facilityId, group, range, 'approved');
  const { busy, act } = useActions(load, onChange, toast);
  if (err) return <div className="note bad">{err}</div>;
  if (!list) return <div className="muted">Loading…</div>;
  const by = (s: number) => list.filter((e) => e.scope === s).reduce((a, e) => a + e.kg, 0);
  return <>
    <div className="kgrid">{[['Approved', list.reduce((a, e) => a + e.kg, 0)], ['Scope 1', by(1)], ['Scope 2', by(2)], ['Scope 3', by(3)]].map(([l, v]) => (
      <div key={l as string} className="soft"><span className="muted small">{l}</span><b style={{ fontSize: 22 }}>{tco2e(v as number)} t</b></div>))}</div>
    {list.length ? <EntryRows list={list} busy={busy} onAct={list.some((e) => e.canReturn) ? (e, a, note) => void act([e.id], a, note) : undefined} />
      : <div className="empty">Nothing approved yet for these months.</div>}
    <div className="muted small">Approved entries count in the dashboards and reports. <Link to="/dashboards">Dashboards →</Link></div>
  </>;
}
