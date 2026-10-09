/**
 * Vehicle fleet of a facility: list, add / edit, retire / reinstate, delete
 * (only without entries), Excel template and upload with preview.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, download, type UploadRow, type Vehicle, type VehicleMethod, type VehicleType } from '../lib/api';
import { Icon } from './Icon';

const METHOD_LABEL: Record<VehicleMethod, string> = { distance: 'Distance', fuel: 'Fuel used', electricity: 'Electricity charged', spend: 'Spend' };
const today = () => new Date().toISOString().slice(0, 10);

export function useVehicleTypes() {
  const [types, setTypes] = useState<VehicleType[]>([]);
  useEffect(() => { api.vehicleTypes().then((r) => setTypes(r.types)).catch(() => setTypes([])); }, []);
  return types;
}

/** Fuels a vehicle can burn (liquid, gaseous, biofuel), for the "fuel used" override. */
export function useFuels() {
  const [fuels, setFuels] = useState<{ id: number; name: string; sub: string }[]>([]);
  useEffect(() => {
    api.catalogue().then((c) => {
      const cat = c.categories.find((x) => x.code === 'stationary_combustion');
      setFuels((cat?.subcategories ?? []).filter((s) => ['liquid_fuels', 'gaseous_fuels', 'biofuel'].includes(s.code)).flatMap((s) => s.items.map((i) => ({ id: i.id, name: i.name, sub: s.name }))));
    }).catch(() => setFuels([]));
  }, []);
  return fuels;
}

/** Vehicle type picker: group → class → type. */
export function TypePicker({ types, value, onChange, disabled }: { types: VehicleType[]; value: number | null; onChange: (id: number) => void; disabled?: boolean }) {
  const current = types.find((t) => t.id === value);
  const classes = useMemo(() => [...new Map(types.map((t) => [t.sub, t.grp ?? ''])).entries()], [types]);
  const [cls, setCls] = useState(current?.sub ?? '');
  useEffect(() => { if (current) setCls(current.sub); }, [current?.sub]); // eslint-disable-line react-hooks/exhaustive-deps
  const inClass = types.filter((t) => t.sub === cls);
  const groups = [...new Set(classes.map(([, g]) => g))];
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
      <label className="field" style={{ flex: '1 1 200px' }}>
        <span>Class</span>
        <select className="input" value={cls} disabled={disabled} onChange={(e) => { setCls(e.target.value); const first = types.find((t) => t.sub === e.target.value); if (first) onChange(first.id); }}>
          <option value="" disabled>Choose…</option>
          {groups.map((g) => <optgroup key={g} label={g || 'Other'}>{classes.filter(([, gg]) => gg === g).map(([c]) => <option key={c} value={c}>{c}</option>)}</optgroup>)}
        </select>
      </label>
      <label className="field" style={{ flex: '2 1 260px' }}>
        <span>Vehicle type</span>
        <select className="input" value={value ?? ''} disabled={disabled || !cls} onChange={(e) => onChange(Number(e.target.value))}>
          {!value && <option value="">Choose…</option>}
          {inClass.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
    </div>
  );
}

export function Fleet({ facilityId, canEdit, onCount }: { facilityId: string; canEdit: boolean; onCount?: (n: number) => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [edit, setEdit] = useState<Vehicle | 'new' | null>(null);
  const [retire, setRetire] = useState<Vehicle | null>(null);
  const [upload, setUpload] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const types = useVehicleTypes();
  const fuels = useFuels();
  const load = () => api.vehicles(facilityId).then((r) => { setVehicles(r.vehicles); onCount?.(r.vehicles.filter((v) => !v.retired_on).length); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };

  if (!vehicles) return <div className="empty">Loading…</div>;
  const inService = vehicles.filter((v) => !v.retired_on);
  const shown = showRetired ? vehicles : inService;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row">
        <div className="grow sub">{inService.length} in service{vehicles.length > inService.length ? ` · ${vehicles.length - inService.length} retired` : ''}. Vehicle data is entered for the vehicles in service in each month.</div>
        {vehicles.length > inService.length && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />Retired</label>}
      </div>
      {canEdit && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn p sm" onClick={() => setEdit('new')}><Icon name="plus" />Add vehicle</button>
          <button className="btn sm" onClick={() => setUpload(true)}><Icon name="upload" />Upload fleet (Excel)</button>
          <button className="btn ghost sm" onClick={() => run(() => download('/api/vehicles/template.xlsx', 'fleet-template.xlsx'))}>Download template</button>
        </div>
      )}
      {err && <div className="note bad">{err}</div>}
      {shown.length ? (
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="t">
            <thead><tr><th>Vehicle</th><th>Type</th><th>Entry</th><th>In service</th><th className="num">Entries</th>{canEdit && <th />}</tr></thead>
            <tbody>{shown.map((v) => (
              <tr key={v.id} style={v.retired_on ? { opacity: 0.6 } : undefined}>
                <td><b>{v.name}</b>{v.registration && <div className="sub mono">{v.registration}</div>}</td>
                <td>{v.type}<div className="sub">{v.class}{v.fuel ? ` · runs on ${v.fuel}` : ''}{v.charging ? ` · charged ${v.charging === 'site' ? 'on site' : 'elsewhere'}` : ''}{v.ownership === 'leased' ? ' · leased' : ''}</div></td>
                <td>{METHOD_LABEL[v.default_method]}</td>
                <td className="mono">{v.in_service_from}{v.retired_on && <div className="chip grey">retired {v.retired_on}</div>}</td>
                <td className="num">{v.entries}</td>
                {canEdit && (
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => setEdit(v)} aria-label={`Edit ${v.name}`}><Icon name="edit" /></button>
                    {v.retired_on
                      ? <button className="btn ghost sm" onClick={() => run(() => api.reinstateVehicle(v.id))}>Reinstate</button>
                      : <button className="btn ghost sm" onClick={() => setRetire(v)}>Retire</button>}
                    {v.entries === 0 && <button className="btn ghost sm" onClick={() => run(() => api.deleteVehicle(v.id))} aria-label={`Delete ${v.name}`}><Icon name="x" /></button>}
                  </td>
                )}
              </tr>))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">No vehicles yet{canEdit ? ' — add them one by one or upload the fleet from Excel.' : '.'}</div>}

      {edit && <VehicleForm facilityId={facilityId} vehicle={edit === 'new' ? null : edit} types={types} fuels={fuels} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {retire && <RetireForm vehicle={retire} onClose={() => setRetire(null)} onSaved={() => { setRetire(null); load(); }} />}
      {upload && <FleetUpload facilityId={facilityId} onClose={() => setUpload(false)} onSaved={() => { setUpload(false); load(); }} />}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onClose={onClose}>
      <div className="in">
        <div className="row"><h2 className="grow">{title}</h2><button className="btn ghost" onClick={() => ref.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </dialog>
  );
}

function VehicleForm({ facilityId, vehicle, types, fuels, onClose, onSaved }: {
  facilityId: string; vehicle: Vehicle | null; types: VehicleType[]; fuels: { id: number; name: string; sub: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: vehicle?.name ?? '', registration: vehicle?.registration ?? '', itemId: vehicle?.item_id ?? null as number | null,
    fuelItemId: vehicle?.fuel_item_id ?? null as number | null, ownership: vehicle?.ownership ?? 'owned', charging: vehicle?.charging ?? 'elsewhere',
    defaultMethod: vehicle?.default_method ?? 'distance' as VehicleMethod, inServiceFrom: vehicle?.in_service_from ?? today(), note: vehicle?.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const t = types.find((x) => x.id === f.itemId);
  const plug = !!(t?.attrs.electric || t?.attrs.phev);
  const methods: VehicleMethod[] = t?.attrs.electric ? ['distance', 'electricity', 'spend'] : t?.attrs.distance === false ? ['fuel', 'spend'] : ['distance', 'fuel', 'spend'];
  const fuelUnknown = t && !t.attrs.electric && !t.attrs.fuel;
  useEffect(() => { if (t && !methods.includes(f.defaultMethod)) setF((x) => ({ ...x, defaultMethod: methods[0]! })); }, [f.itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setErr(null);
    const body = { ...f, registration: f.registration || null, fuelItemId: t?.attrs.electric ? null : f.fuelItemId, charging: plug ? f.charging : null, note: f.note || null };
    try { vehicle ? await api.updateVehicle(vehicle.id, body) : await api.addVehicle(facilityId, body); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={vehicle ? `Edit ${vehicle.name}` : 'Add a vehicle'} onClose={onClose} wide>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Name / fleet no.</span><input className="input" value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Truck 12" /></label>
        <label className="field" style={{ width: 180 }}><span>Registration</span><input className="input mono" value={f.registration} maxLength={40} onChange={(e) => setF({ ...f, registration: e.target.value })} placeholder="SHJ 12345" /></label>
      </div>
      <TypePicker types={types} value={f.itemId} onChange={(id) => setF({ ...f, itemId: id })} disabled={!!vehicle && vehicle.entries > 0} />
      {vehicle && vehicle.entries > 0 && <div className="sub">The type cannot change once a vehicle has entries.</div>}
      {t && !t.attrs.electric && (
        <label className="field"><span>Fuel used{fuelUnknown ? ' (needed for fuel and spend entries)' : ' — only if different from the usual fuel of this type'}</span>
          <select className="input" value={f.fuelItemId ?? ''} onChange={(e) => setF({ ...f, fuelItemId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{fuelUnknown ? 'Choose…' : 'Usual fuel of the type'}</option>
            {[...new Set(fuels.map((x) => x.sub))].map((g) => <optgroup key={g} label={g}>{fuels.filter((x) => x.sub === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
          </select>
        </label>
      )}
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ width: 150 }}><span>Ownership</span>
          <select className="input" value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value as 'owned' })}><option value="owned">Owned</option><option value="leased">Leased</option></select></label>
        {plug && (
          <label className="field" style={{ width: 230 }}><span>Usually charged</span>
            <select className="input" value={f.charging} onChange={(e) => setF({ ...f, charging: e.target.value as 'site' })}>
              <option value="elsewhere">Elsewhere (public, home) → Scope 2 here</option><option value="site">At our site (already on its meter)</option>
            </select></label>
        )}
        <label className="field" style={{ width: 190 }}><span>Usual entry</span>
          <select className="input" value={f.defaultMethod} onChange={(e) => setF({ ...f, defaultMethod: e.target.value as VehicleMethod })}>{methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></label>
        <label className="field" style={{ width: 170 }}><span>In service from</span><input className="input" type="date" value={f.inServiceFrom} onChange={(e) => setF({ ...f, inServiceFrom: e.target.value })} /></label>
      </div>
      <label className="field"><span>Note</span><input className="input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!f.name.trim() || !f.itemId || !f.inServiceFrom} onClick={save}>{vehicle ? 'Save' : 'Add vehicle'}</button>
      </div>
    </Modal>
  );
}

function RetireForm({ vehicle, onClose, onSaved }: { vehicle: Vehicle; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Retire ${vehicle.name}`} onClose={onClose}>
      <p className="sub">The vehicle and its {vehicle.entries} entries stay. It is no longer offered for months after this date. You can reinstate it later.</p>
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ width: 180 }}><span>Retired on</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field grow"><span>Reason (optional)</span><input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Sold, scrapped, end of lease…" /></label>
      </div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" onClick={async () => { setErr(null); try { await api.retireVehicle(vehicle.id, { retiredOn: date, reason: reason || undefined }); onSaved(); } catch (e) { setErr((e as Error).message); } }}>Retire</button>
      </div>
    </Modal>
  );
}

/** Excel upload with a preview: rows with problems are listed and skipped. */
export function UploadPreview({ title, help, columns, run, onClose, onDone, templateButton }: {
  title: string; help: string; columns: { key: string; label: string; num?: boolean }[];
  run: (file: Blob, commit: boolean) => Promise<{ rows: UploadRow[]; valid: number; done: number }>; onClose: () => void; onDone: (n: number) => void; templateButton?: React.ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: UploadRow[]; valid: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (f: File) => { setFile(f); setErr(null); setPreview(null); setBusy(true); try { setPreview(await run(f, false)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const bad = preview?.rows.filter((r) => r.errors.length).length ?? 0;
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="sub">{help}</p>
      <div className="row" style={{ gap: 8 }}>
        <label className="btn"><Icon name="upload" />{file ? file.name : 'Choose the Excel file'}
          <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} /></label>
        {templateButton}
        {busy && <span className="sub">Checking…</span>}
      </div>
      {err && <div className="note bad">{err}</div>}
      {preview && (
        <>
          <div className={`note ${bad ? 'warn' : 'info'}`}>{preview.valid} row{preview.valid === 1 ? '' : 's'} ready{bad ? `, ${bad} with problems (skipped — fix them in the file and upload again)` : ''}.</div>
          <div className="scroll" style={{ maxHeight: 360, border: '1px solid var(--line)', borderRadius: 12 }}>
            <table className="t">
              <thead><tr><th>Row</th>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}<th>Check</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.row}>
                  <td className="mono">{r.row}</td>
                  {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{String(r[c.key] ?? '')}</td>)}
                  <td>{r.errors.length ? <span className="bad-text">{r.errors.join('; ')}</span> : <span className="chip">OK</span>}{r.warnings?.length ? <div className="sub">{r.warnings.join(' ')}</div> : null}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn p" disabled={!preview.valid || busy} onClick={async () => { setBusy(true); setErr(null); try { const r = await run(file!, true); onDone(r.done); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>
              Add {preview.valid} row{preview.valid === 1 ? '' : 's'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function FleetUpload({ facilityId, onClose, onSaved }: { facilityId: string; onClose: () => void; onSaved: () => void }) {
  return (
    <UploadPreview title="Upload the fleet" onClose={onClose} onDone={onSaved}
      help="Fill in the fleet template (one row per vehicle; pick the vehicle type from the list) and upload it. You see every row checked before anything is added."
      templateButton={<button className="btn ghost" onClick={() => download('/api/vehicles/template.xlsx', 'fleet-template.xlsx')}>Download template</button>}
      columns={[{ key: 'name', label: 'Name' }, { key: 'registration', label: 'Registration' }, { key: 'type', label: 'Type' }, { key: 'inServiceFrom', label: 'From' }]}
      run={async (file, commit) => { const r = await api.uploadFleet(facilityId, file, commit); return { rows: r.rows, valid: r.valid, done: r.added }; }} />
  );
}
