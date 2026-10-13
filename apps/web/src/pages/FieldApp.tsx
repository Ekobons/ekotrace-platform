/**
 * QR & field app (Capture): bins with QR labels, the scans recorded at them, and the month's roll-up into
 * draft waste entries (Scope 3.5). The scan itself happens on a phone at /scan/<code> (ScanPage).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { useApp } from '../App';
import { api, num, type Bin, type Category, type Facility, type Rollup, type Scan } from '../lib/api';
import { OPS, firstOp, griOf, materialsOf, methodName, opsOf } from '../lib/waste';
import { Icon } from '../components/Icon';
import { MN } from '../components/DashCharts';

/** A QR code as SVG markup (only the label's URL is in it). */
export function qrSvg(text: string, cell = 4) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
export const scanUrl = (code: string) => `${window.location.origin}/scan/${code}`;

/** Container sizes and typical densities, to help set a bin up (kg per litre, loose waste). */
const SIZES: [string, number][] = [['120 L wheelie bin', 120], ['240 L wheelie bin', 240], ['660 L bin', 660], ['1,100 L bin', 1100], ['6 m³ skip', 6000], ['20 m³ roll-off', 20000], ['30 m³ compactor', 30000]];
const DENSITY: [RegExp, number, string][] = [
  [/food|organic|garden/i, 0.5, 'food / organic'], [/glass/i, 0.3, 'glass'], [/paper|board|book/i, 0.06, 'paper and card'], [/plastic|film|packaging/i, 0.04, 'plastics'],
  [/metal|cans/i, 0.1, 'metal cans and scrap'], [/aggregate|concrete|brick|soil|asphalt|plaster/i, 1.2, 'construction'], [/oil|sludge|chemical|paint/i, 0.9, 'liquids and sludge'], [/.*/, 0.15, 'mixed waste']];
const densityFor = (name: string) => DENSITY.find(([re]) => re.test(name))!;

const ymNow = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };

export function FieldApp() {
  const { toast, can } = useApp();
  const nav = useNavigate();
  const [facs, setFacs] = useState<Facility[]>([]);
  const [fac, setFac] = useState('');
  const [tab, setTab] = useState<'bins' | 'scans' | 'roll'>('bins');
  const [bins, setBins] = useState<Bin[] | null>(null);
  const [cat, setCat] = useState<Category | null>(null);
  const [tick, setTick] = useState(0);
  const [ym, setYm] = useState(ymNow);
  const [code, setCode] = useState('');
  useEffect(() => { api.facilities().then((f) => { setFacs(f.facilities); setFac((x) => x || f.facilities.find((y) => y.canEnter)?.id || f.facilities[0]?.id || ''); }).catch(() => {}); }, []);
  useEffect(() => { api.catalogue().then((c) => setCat(c.categories.find((x) => x.code === 'waste_generated') ?? null)).catch(() => {}); }, []);
  useEffect(() => { if (fac) api.bins(fac).then((b) => setBins(b.bins)).catch((e) => toast((e as Error).message)); }, [fac, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const canManage = can('super_admin', 'admin', 'manager');
  const facName = facs.find((f) => f.id === fac)?.name ?? '';

  const printLabels = (list: Bin[]) => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print the labels'); return; }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bin labels · ${esc(facName)}</title><style>
      body{font-family:system-ui,sans-serif;margin:16px;color:#10201C} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
      .lbl{border:2px solid #0E7C66;border-radius:12px;padding:12px;break-inside:avoid;text-align:center} .lbl svg{width:150px;height:150px}
      .n{font-weight:700;font-size:15px;margin-top:4px} .s{font-size:11.5px;color:#3D4F49} .h{display:inline-block;background:#FBEBCB;color:#7A4A06;border-radius:99px;padding:1px 8px;font-size:11px;font-weight:700;margin-top:4px}
      .c{font-family:monospace;font-size:12px;letter-spacing:.1em;margin-top:4px} .t{font-size:10.5px;color:#5B6B66;margin-top:6px}
      @media print{body{margin:0}.np{display:none}}</style></head><body>
      <p class="np"><button onclick="print()">Print</button> · ${list.length} label${list.length === 1 ? '' : 's'} · cut out and stick on each bin.</p><div class="grid">
      ${list.map((b) => `<div class="lbl">${qrSvg(scanUrl(b.code), 4)}<div class="n">${esc(b.name)}</div><div class="s">${esc(b.facility)}${b.location ? ` · ${esc(b.location)}` : ''}</div>
        <div class="s">${esc(b.material ?? b.item)} · ${esc(methodName(b.route, b.gri))}</div>${b.hazardous ? '<div class="h">HAZARDOUS</div>' : ''}<div class="c">${b.code}</div>
        <div class="t">Scan with the phone camera · sign in to Ekotrace</div></div>`).join('')}</div></body></html>`);
    w.document.close();
  };

  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>QR & field app</h1><div className="muted">Waste weighed or checked at the bin. Each bin has a QR label; field staff scan it with the phone camera and record the weight; at month end the scans become draft waste entries.</div></div>
        <span className="grow" />
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/scan/${code.trim().toUpperCase()}`); }}>
          <input className="input sm" style={{ width: 150 }} placeholder="Label code" aria-label="Label code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn sm">Open scan page</button></form>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <select className="input" style={{ width: 280 }} aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)}>{facs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <div className="seg strong" role="tablist">
          {([['bins', '▦ Bins & labels'], ['scans', '◉ Scans'], ['roll', '⇪ Month roll-up']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        <span className="grow" />
        {tab !== 'bins' && <div className="row" style={{ gap: 6 }}>
          <select className="input sm" style={{ width: 'auto' }} aria-label="Month" value={ym.m} onChange={(e) => setYm({ ...ym, m: Number(e.target.value) })}>{MN.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
          <select className="input sm" style={{ width: 'auto' }} aria-label="Year" value={ym.y} onChange={(e) => setYm({ ...ym, y: Number(e.target.value) })}>{[0, 1, 2].map((d) => ymNow().y - d).map((y) => <option key={y}>{y}</option>)}</select></div>}
      </div>
      {tab === 'bins' && <Bins bins={bins} cat={cat} fac={fac} canManage={canManage} reload={() => setTick((t) => t + 1)} print={printLabels} />}
      {tab === 'scans' && fac && <Scans fac={fac} ym={ym} />}
      {tab === 'roll' && fac && <Roll fac={fac} ym={ym} />}
    </div>
  );
}

function Bins({ bins, cat, fac, canManage, reload, print }: { bins: Bin[] | null; cat: Category | null; fac: string; canManage: boolean; reload: () => void; print: (b: Bin[]) => void }) {
  const { toast } = useApp();
  const mats = useMemo(() => (cat ? materialsOf(cat) : new Map()), [cat]);
  const blank = { name: '', location: '', material: '', op: 'landfill', haz: false, contractor: '', size: '240', density: '' };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const m = mats.get(f.material);
  const dn = densityFor(m?.name ?? '');
  const add = async () => {
    const op = opsOf(m).find((o) => o.key === f.op);
    if (!f.name.trim() || !op) { toast('Name the bin and choose the material and method'); return; }
    try {
      await api.addBin({ facilityId: fac, name: f.name.trim(), location: f.location.trim() || undefined, itemId: op.item, gri: griOf(f.op), hazardous: f.haz,
        contractor: f.contractor.trim() || undefined, capacityL: Number(f.size) || undefined, density: Number(f.density) || dn[1] });
      toast('Bin added — print its label'); setF({ ...blank, material: f.material, op: f.op, haz: f.haz, contractor: f.contractor }); reload();
    } catch (e) { toast((e as Error).message); }
  };
  const groups = [...new Set([...mats.values()].map((x) => x.group))];
  return <>
    {canManage && <section className="card tacard">
      <div className="row"><h2>Add a bin</h2><span className="grow" /><button className="btn sm" onClick={() => setOpen(!open)}>{open ? 'Close' : '+ New bin'}</button></div>
      {open && <div className="formgrid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <label className="field"><span>Bin name</span><input className="input" placeholder="e.g. Loading bay 1 · cardboard" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Location</span><input className="input" placeholder="e.g. Kitchen, Gate 2" value={f.location} maxLength={200} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <label className="field"><span>Material</span><select className="input" value={f.material} onChange={(e) => { const x = mats.get(e.target.value); setF({ ...f, material: e.target.value, haz: !!x?.haz, op: firstOp(x), density: '' }); }}>
          <option value="">Choose…</option>{groups.map((g) => <optgroup key={g} label={g}>{[...mats.entries()].filter(([, x]) => x.group === g).map(([k, x]) => <option key={k} value={k}>{x.name}</option>)}</optgroup>)}</select></label>
        <label className="field"><span>Usual disposal method</span><select className="input" value={f.op} disabled={!m} onChange={(e) => setF({ ...f, op: e.target.value })}>
          {(['Diverted from disposal', 'Disposal'] as const).map((g) => <optgroup key={g} label={g}>{(m ? opsOf(m) : OPS).filter((o) => o.group === g).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>)}</select></label>
        <label className="field"><span>Hazardous?</span><select className="input" value={f.haz ? 'y' : 'n'} onChange={(e) => setF({ ...f, haz: e.target.value === 'y' })}><option value="n">Non-hazardous</option><option value="y">Hazardous (manifest needed at collection)</option></select></label>
        <label className="field"><span>Contractor</span><input className="input" placeholder="Collector or treatment company" value={f.contractor} maxLength={120} onChange={(e) => setF({ ...f, contractor: e.target.value })} /></label>
        <label className="field"><span>Container</span><select className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{SIZES.map(([n, l]) => <option key={l} value={l}>{n}</option>)}</select></label>
        <label className="field"><span>Density kg/L (for fill levels)</span><input className="input num" inputMode="decimal" placeholder={`${dn[1]} · ${dn[2]}`} value={f.density} onChange={(e) => setF({ ...f, density: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        <div className="row" style={{ gridColumn: '1 / -1' }}><span className="muted small">The fill-level estimate is capacity × % full × density; weighing is better and the weighbridge weight at collection replaces both.</span><span className="grow" /><button className="btn p" onClick={() => void add()}>Add bin</button></div>
      </div>}
    </section>}
    <section className="card tacard">
      <div className="row"><h2>Bins & QR labels · {bins?.length ?? 0}</h2><span className="grow" />{!!bins?.length && <button className="btn sm" onClick={() => print(bins)}><Icon name="qr" />Print all labels</button>}</div>
      {!bins ? <div className="muted">Loading…</div> : !bins.length ? <div className="muted">No bins at this facility yet.{canManage ? ' Add one above, print its label and stick it on the bin.' : ''}</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Label</th><th>Bin</th><th>Material · method</th><th>Contractor</th><th className="num">Capacity</th><th className="num">This month</th><th>Last scan</th><th /></tr></thead>
          <tbody>{bins.map((b) => (
            <tr key={b.id}>
              <td style={{ width: 70 }}><div className="qrmini" dangerouslySetInnerHTML={{ __html: qrSvg(scanUrl(b.code), 2) }} /></td>
              <td><b>{b.name}</b><div className="muted small">{b.location ?? ''} · <span className="mono">{b.code}</span></div></td>
              <td>{b.material ?? b.item}{b.hazardous && <> <span className="chip warn">Hazardous</span></>}<div className="muted small">{methodName(b.route, b.gri)}</div></td>
              <td className="small">{b.contractor ?? <span className="muted">—</span>}</td>
              <td className="num small">{b.capacityL ? `${num(b.capacityL)} L` : '—'}</td>
              <td className="num"><b>{num(Math.round(b.monthKg ?? 0))}</b> <span className="muted small">kg</span>{!!b.openScans && <div className="muted small">{b.openScans} scan{b.openScans === 1 ? '' : 's'} not rolled up</div>}</td>
              <td className="small muted">{b.lastScan ? new Date(b.lastScan).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}</td>
              <td className="nowrap"><Link className="btn xs" to={`/scan/${b.code}`}>Scan</Link> <button className="btn xs ghost" onClick={() => print([b])}>Label</button>
                {canManage && <> <button className="btn xs ghost" onClick={async () => { try { await api.removeBin(b.id); reload(); } catch (e) { toast((e as Error).message); } }}>Remove</button></>}</td>
            </tr>))}</tbody></table></div>)}
    </section>
  </>;
}

const KIND: Record<string, string> = { weigh: 'Weighed', fill: 'Fill level', collection: 'Collection' };

function Scans({ fac, ym }: { fac: string; ym: { y: number; m: number } }) {
  const { toast } = useApp();
  const [s, setS] = useState<Scan[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setS(null); api.scans({ facilityId: fac, year: ym.y, month: ym.m }).then((r) => setS(r.scans)).catch((e) => toast((e as Error).message)); }, [fac, ym.y, ym.m, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const flagged = (s ?? []).filter((x) => x.flags.length && x.status === 'open').length;
  return (
    <section className="card tacard">
      <div className="row"><h2>Scans · {MN[ym.m - 1]} {ym.y} · {s?.length ?? 0}</h2><span className="grow" />{flagged > 0 && <span className="chip warn">{flagged} with checks to look at</span>}</div>
      {!s ? <div className="muted">Loading…</div> : !s.length ? <div className="muted">No scans this month.</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>When</th><th>Bin</th><th>Type</th><th className="num">kg</th><th>Manifest</th><th>Checks</th><th>By</th><th>Status</th><th /></tr></thead>
          <tbody>{s.map((x) => (
            <tr key={x.id} style={x.status === 'void' ? { opacity: 0.5 } : undefined}>
              <td className="small nowrap">{new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{x.bin}<div className="muted small">{x.item}</div></td>
              <td className="small">{KIND[x.kind]}{x.kind === 'fill' && x.fillPct != null ? ` · ${x.fillPct}%` : ''}</td>
              <td className="num"><b>{num(x.kg)}</b>{x.estimated && <div><span className="chip grey">estimated</span></div>}</td>
              <td className="small mono">{x.manifest ?? ''}</td>
              <td className="small">{x.flags.map((f) => <div key={f} style={{ color: 'var(--warn)' }}>⚠ {f}</div>)}</td>
              <td className="small muted">{x.by}</td>
              <td><span className={`chip ${x.status === 'rolled' ? '' : x.status === 'void' ? 'grey' : 'info'}`}>{x.status === 'rolled' ? 'In an entry' : x.status === 'void' ? 'Removed' : 'Open'}</span></td>
              <td>{x.status === 'open' && <button className="btn xs ghost" onClick={async () => { try { await api.voidScan(x.id); setTick((t) => t + 1); } catch (e) { toast((e as Error).message); } }}>Remove</button>}</td>
            </tr>))}</tbody></table></div>)}
    </section>);
}

function Roll({ fac, ym }: { fac: string; ym: { y: number; m: number } }) {
  const { toast, can } = useApp();
  const [r, setR] = useState<Rollup | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { setR(null); api.rollup({ facilityId: fac, year: ym.y, month: ym.m }).then(setR).catch((e) => toast((e as Error).message)); }, [fac, ym.y, ym.m, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = r ? r.groups.reduce((a, g) => a + (g.actual > 0 ? 1 : 0) + (g.estimated > 0 ? 1 : 0), 0) : 0;
  const make = async () => {
    setBusy(true);
    try {
      const x = await api.makeRollup({ facilityId: fac, year: ym.y, month: ym.m });
      const w = [...new Set(x.made.flatMap((m) => m.warnings))];
      toast(`${x.made.length} draft waste entr${x.made.length === 1 ? 'y' : 'ies'} made${w.length ? ` · ${w[0]}` : ''}`); setTick((t) => t + 1);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (!r) return <div className="card empty">Loading…</div>;
  return <>
    <section className="card tacard">
      <div className="row"><h2>By bin · {MN[ym.m - 1]} {ym.y}</h2><span className="grow" /><span className="muted small">Weighbridge weights of the month’s collections replace the field scans of that bin.</span></div>
      {!r.perBin.length ? <div className="muted">No scans waiting for this month.{r.rolled ? ` ${r.rolled} scan${r.rolled === 1 ? ' is' : 's are'} already in waste entries.` : ''}</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Bin</th><th>Basis</th><th className="num">Weighed kg</th><th className="num">Estimated kg</th><th className="num">Scans</th><th>Manifests</th></tr></thead>
          <tbody>{r.perBin.map((b) => <tr key={b.bin}><td><b>{b.bin}</b><div className="muted small">{b.item}</div></td><td className="small">{b.basis}</td><td className="num">{num(b.actualKg)}</td><td className="num">{num(b.estimatedKg)}</td><td className="num">{b.scans}</td><td className="small mono">{b.manifests.join(', ')}</td></tr>)}</tbody></table></div>)}
    </section>
    {r.groups.length > 0 && <section className="card tacard">
      <div className="row"><h2>Entries to be made · {n}</h2><span className="grow" />
        {can('super_admin', 'admin', 'manager', 'preparer') && <button className="btn p" disabled={busy} onClick={() => void make()}>{busy ? 'Making…' : `Create ${n} draft entr${n === 1 ? 'y' : 'ies'}`}</button>}</div>
      <div className="scrollx"><table className="t">
        <thead><tr><th>Material · method</th><th>Hazardous</th><th>Contractor</th><th className="num">Actual kg</th><th className="num">Estimated kg</th><th>Manifests</th></tr></thead>
        <tbody>{r.groups.map((g, i) => <tr key={i}><td>{g.item}<div className="muted small">{g.bins.join(', ')}</div></td><td>{g.hazardous ? <span className="chip warn">Yes{g.manifests.length ? '' : ' · no manifest'}</span> : 'No'}</td>
          <td className="small">{g.contractor ?? '—'}</td><td className="num">{num(g.actual)}</td><td className="num">{num(g.estimated)}</td><td className="small mono">{g.manifests.join(', ')}</td></tr>)}</tbody></table></div>
      <p className="muted small">Saved as drafts under Waste → sent out (Scope 3.5), weighed and estimated kept apart, with the contractor and manifests. Check the totals against the contractor’s monthly statement, then submit for approval from <Link to="/entries">Entries & results</Link>.</p>
    </section>}
  </>;
}
