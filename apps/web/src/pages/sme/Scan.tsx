/** Bill scan: read a bill PDF, show each value with the line it came from, let the person correct it, then write it into the right module. */
import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { useSme } from './store';
import { SmeHead } from './ui';
import { f0, f2, n, smeApi, type ScanField } from '../../lib/sme';

type BillType = 'electricity' | 'diesel' | 'lpg';
/** Where a value goes: `set` replaces the field, `add` adds to the year's running total. */
interface Def { key: string; label: string; hint?: string; unit?: string; text?: boolean; path?: string; mode?: 'set' | 'add'; where?: string }
const TYPES: [BillType, string, string][] = [
  ['electricity', 'Electricity', 'DISCOM bill (HT or LT)'],
  ['diesel', 'Diesel', 'Fuel invoice or delivery note'],
  ['lpg', 'LPG', 'Cylinder or bulk invoice'],
];
const DEFS: Record<BillType, Def[]> = {
  electricity: [
    { key: 'period', label: 'Billing period', text: true },
    { key: 'unitsKwh', label: 'Units this month', unit: 'kWh', path: 'bills.units', mode: 'set', where: 'Bill analyser · Units this month' },
    { key: 'maxDemandKva', label: 'Maximum demand recorded', unit: 'kVA', path: 'bills.md', mode: 'set', where: 'Bill analyser · Maximum demand' },
    { key: 'contractDemandKva', label: 'Contract demand', unit: 'kVA', path: 'bills.cd', mode: 'set', where: 'Bill analyser · Contract demand' },
    { key: 'powerFactor', label: 'Power factor', hint: 'Between 0 and 1', path: 'bills.pf', mode: 'set', where: 'Bill analyser · Power factor' },
    { key: 'pfPenaltyInr', label: 'Power factor penalty', unit: '₹', hint: '0 if the bill has none', path: 'bills.pfPenalty', mode: 'set', where: 'Bill analyser · Power factor penalty' },
    { key: 'amountInr', label: 'Bill amount', unit: '₹', hint: 'For checking only' },
    { key: 'supplier', label: 'Electricity company', text: true },
  ],
  diesel: [
    { key: 'date', label: 'Invoice date', text: true },
    { key: 'litres', label: 'Diesel bought', unit: 'L', path: 'emissions.diesel', mode: 'add', where: 'Emissions · Diesel' },
    { key: 'amountInr', label: 'Invoice amount', unit: '₹', hint: 'For checking only' },
    { key: 'supplier', label: 'Supplier', text: true },
  ],
  lpg: [
    { key: 'date', label: 'Invoice date', text: true },
    { key: 'cylinders', label: 'Cylinders', hint: 'For checking only' },
    { key: 'kg', label: 'LPG bought', unit: 'kg', hint: 'Cylinders × size (19 kg, 47.5 kg)', path: 'emissions.lpg', mode: 'add', where: 'Emissions · LPG' },
    { key: 'amountInr', label: 'Invoice amount', unit: '₹', hint: 'For checking only' },
    { key: 'supplier', label: 'Supplier', text: true },
  ],
};
const MAX = 15 * 1024 * 1024;

export function SmeScan() {
  const { d, get, set } = useSme();
  const { toast } = useApp();
  const [type, setType] = useState<BillType>('electricity');
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [read, setRead] = useState<{ fields: Record<string, ScanField>; scanned: boolean; type: BillType } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [addGrid, setAddGrid] = useState(true);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!d) return <div className="card empty">Loading…</div>;
  const can = d.canEdit;

  const reset = () => { setRead(null); setVals({}); setErr(''); setDone(false); };
  const pick = (f: File | null | undefined) => {
    reset();
    if (!f) { setFile(null); return; }
    const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!pdf) { setFile(null); setErr(f.type.startsWith('image/') ? 'Photos are not supported yet. Save the photo as a PDF first (most phone scanner apps can), or type the numbers in.' : 'Choose the bill as a PDF file.'); return; }
    if (f.size > MAX) { setFile(null); setErr('This PDF is larger than 15 MB. Try a smaller copy of the bill.'); return; }
    setFile(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (can) pick(e.dataTransfer.files?.[0]); };

  const go = async () => {
    if (!file) return;
    setBusy(true); reset();
    try {
      const r = await smeApi.scan(type, file);
      setRead({ fields: r.fields, scanned: r.scanned, type });
      setVals(Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value === null || v.value === undefined ? '' : String(v.value)])));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const defs = read ? DEFS[read.type] : [];
  const num = (k: string) => { const v = vals[k]; return v === undefined || v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v); };
  const useThem = () => {
    if (!read) return;
    const main = read.type === 'electricity' ? 'unitsKwh' : read.type === 'diesel' ? 'litres' : 'kg';
    if (num(main) === null) { toast(`${defs.find((x) => x.key === main)?.label ?? 'The main figure'} is missing. Enter it first.`); return; }
    const pf = num('powerFactor');
    if (read.type === 'electricity' && pf !== null && (pf <= 0 || pf > 1)) { toast('Power factor must be between 0 and 1.'); return; }
    for (const x of defs) {
      const v = num(x.key);
      if (!x.path || v === null) continue;
      set(x.path, x.mode === 'add' ? n(get(x.path)) + v : v);
    }
    if (read.type === 'electricity' && addGrid) set('emissions.grid', n(get('emissions.grid')) + (num('unitsKwh') ?? 0));
    setDone(true);
    toast('Figures saved');
  };

  const outLine = (x: Def) => {
    if (!x.path) return null;
    const v = num(x.key), cur = get(x.path);
    if (v === null) return <>Not saved: empty</>;
    if (x.mode === 'add') return <>Adds to {x.where} for {d.fy}: {f0(cur)} + {fmt(v)} = <b>{fmt(n(cur) + v)} {x.unit}</b></>;
    return <>Goes to {x.where}{cur !== undefined && cur !== '' && cur !== null ? <>, replacing {fmt(cur)}</> : ''}</>;
  };

  return (
    <>
      <SmeHead lede="Upload a bill as a PDF and the numbers are read for you. You check each one against the line it came from, correct anything wrong, and only then is it saved.">
        <Link className="btn" to="/sme/bills">Bill analyser</Link>
      </SmeHead>
      <div className="sme-callout"><b>PDF only for now.</b> Photos (JPG, PNG) are not supported yet; most phone scanner apps can save a photo as a PDF. A PDF downloaded from your DISCOM is read instantly. A scanned PDF is read by OCR, which is slower and can take up to a minute.</div>

      <div className="sme-grid2">
        <div className="card">
          <h2>1. Choose the bill</h2>
          <div className="seg" role="group" aria-label="Bill type" style={{ marginTop: 12 }}>
            {TYPES.map(([v, t]) => <button key={v} type="button" className={type === v ? 'on' : ''} aria-pressed={type === v} disabled={!can || busy} onClick={() => { setType(v); reset(); }}>{t}</button>)}
          </div>
          <p className="muted small" style={{ margin: '6px 0 12px' }}>{TYPES.find((t) => t[0] === type)?.[2]}</p>
          <label className={`sv-drop${drag ? ' on' : ''}${can ? '' : ' dis'}`} onDragOver={(e) => { e.preventDefault(); if (can) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <input ref={input} type="file" accept="application/pdf,.pdf" disabled={!can || busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <span className="ic"><Icon name="upload" /></span>
            <span style={{ minWidth: 0 }}>{file ? <><b>{file.name}</b><small>{f2(file.size / 1024 / 1024)} MB · tap to choose another</small></> : <><b>Choose a PDF or drop it here</b><small>Up to 15 MB</small></>}</span>
          </label>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn p" type="button" disabled={!can || !file || busy} onClick={go}>{busy ? <><span className="sv-busy" /> Reading…</> : 'Read the bill'}</button>
            {busy && <span className="muted small">A scanned PDF can take up to a minute.</span>}
          </div>
          {!can && <p className="muted small">You can view figures but not add them. Ask a manager or data preparer to read bills.</p>}
          {err && <div className="note bad" role="alert" style={{ marginTop: 12 }}>{err}<br /><Link to={type === 'electricity' ? '/sme/bills' : '/sme/emissions'}>Type the numbers in instead</Link></div>}
        </div>

        <div className="card">
          <div className="sv-h2row"><h2>2. Check what was read</h2>{read && <span className="chip grey">{read.scanned ? 'Read by OCR' : 'Read from PDF text'}</span>}</div>
          {!read && <p className="muted" style={{ marginTop: 10 }}>Choose the bill type, pick the PDF and press Read the bill. Each value will show the line of the bill it came from.</p>}
          {read && <>
            <p className="muted small" style={{ margin: '6px 0 4px' }}>Compare each value with the quoted line{read.scanned ? '; OCR can misread digits, so check closely' : ''}. Fix anything wrong, or fill in what was not found.</p>
            <div>
              {defs.map((x) => {
                const f = read.fields[x.key];
                return (
                  <div className={`sv-read${x.text ? " wide" : ""}`} key={x.key}>
                    <label htmlFor={`sc-${x.key}`}>{x.label}{x.unit ? ` (${x.unit})` : ''}{x.hint && <small>{x.hint}</small>}</label>
                    <input id={`sc-${x.key}`} className={`input${x.text ? ' txt' : ' num'}`} type={x.text ? 'text' : 'number'} step="any" inputMode={x.text ? 'text' : 'decimal'} placeholder="Not found"
                      disabled={!can} value={vals[x.key] ?? ''} onChange={(e) => { setVals({ ...vals, [x.key]: e.target.value }); setDone(false); }} />
                    {f?.line ? <div className="sv-src">From<q title={f.line}>{f.line}</q></div> : <div className="sv-src miss">Not found on the bill. Type it in if the bill shows it.</div>}
                    {x.path && <div className="sv-src">{outLine(x)}</div>}
                  </div>);
              })}
            </div>
            {read.type === 'electricity' && (
              <label className="sv-check" style={{ marginTop: 12 }}><input type="checkbox" checked={addGrid} disabled={!can} onChange={(e) => { setAddGrid(e.target.checked); setDone(false); }} />
                <span>Also add the units to grid electricity in Emissions<small>{d.fy} total: {f0(get('emissions.grid'))} + {f0(num('unitsKwh') ?? 0)} = {f0(n(get('emissions.grid')) + (num('unitsKwh') ?? 0))} kWh. Untick if this month is already counted.</small></span></label>)}
            {can && (done
              ? <div className="note ok" style={{ marginTop: 14 }}>Saved. See the result in {read.type === 'electricity' ? <><Link to="/sme/bills">Bill analyser</Link>{addGrid && <> and <Link to="/sme/emissions">Emissions</Link></>}</> : <Link to="/sme/emissions">Emissions</Link>}.</div>
              : <div className="row" style={{ marginTop: 14 }}><button className="btn p" type="button" onClick={useThem}>Use these figures</button><span className="muted small">Bill amount, dates and supplier are for checking and are not saved.</span></div>)}
          </>}
        </div>
      </div>
    </>);
}

const fmt = (v: unknown) => { const x = n(v); return Number.isInteger(x) ? f0(x) : x.toLocaleString('en-IN', { maximumFractionDigits: 3 }); };
