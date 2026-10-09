/**
 * Company & facilities: create a company (platform admin), choose its country
 * and GWP set, and manage its facilities.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, type Facility } from '../lib/api';

export function Settings() {
  const { tenant, tenants, reloadTenants, chooseTenant, toast } = useApp();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [newCo, setNewCo] = useState({ name: '', country: 'AE', gwpSet: 'AR5' });
  const [newFac, setNewFac] = useState({ name: '', country: '' });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (tenant) api.facilities().then((f) => setFacilities(f.facilities)); else setFacilities([]); }, [tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); try { await fn(); toast(ok); } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Setup</div><h1>Company & facilities</h1>
        <p className="sub">Until login is built, any company can be chosen at the top left. Each company's data is kept apart by the database itself.</p></div></div>
      {err && <div className="note bad">{err}</div>}

      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>{tenant ? tenant.name : 'No company chosen'}</h2>
          {tenant && (
            <>
              <div className="row">
                <label className="field"><span>Country (default for facilities)</span>
                  <input className="input" style={{ width: 90 }} maxLength={2} defaultValue={tenant.country}
                    onBlur={(e) => e.target.value.toUpperCase() !== tenant.country && run(async () => { await api.updateTenant({ country: e.target.value.toUpperCase() }); await reloadTenants(); }, 'Saved')} /></label>
                <label className="field grow"><span>GWP set used for reporting</span>
                  <select className="input" value={tenant.gwp_set} onChange={(e) => run(async () => { await api.updateTenant({ gwpSet: e.target.value }); await reloadTenants(); }, `Now reporting in ${e.target.value}`)}>
                    <option value="AR4">AR4 (2007)</option><option value="AR5">AR5 (2014) — UNFCCC standard, used by DESNZ</option><option value="AR6">AR6 (2021) — latest</option>
                  </select></label>
              </div>
              <div className="sub">Changing the GWP set applies to new calculations; saved entries keep the set they were calculated with (shown on each entry).</div>
            </>
          )}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }}>
            <h3>Add a company</h3>
            <div className="row">
              <input className="input grow" placeholder="Company name" value={newCo.name} onChange={(e) => setNewCo({ ...newCo, name: e.target.value })} />
              <input className="input" style={{ width: 70 }} maxLength={2} value={newCo.country} onChange={(e) => setNewCo({ ...newCo, country: e.target.value.toUpperCase() })} />
              <select className="input" value={newCo.gwpSet} onChange={(e) => setNewCo({ ...newCo, gwpSet: e.target.value })}><option>AR4</option><option>AR5</option><option>AR6</option></select>
              <button className="btn p" disabled={newCo.name.trim().length < 2} onClick={() => run(async () => {
                const t = await api.createTenant({ ...newCo, name: newCo.name.trim() }); await reloadTenants(); chooseTenant(t.id); setNewCo({ name: '', country: 'AE', gwpSet: 'AR5' });
              }, 'Company created')}>Create</button>
            </div>
            <div className="sub">{tenants.length} compan{tenants.length === 1 ? 'y' : 'ies'} on this installation.</div>
          </div>
        </div>

        <div className="card flush">
          <div style={{ padding: '14px 16px 6px' }}><h2>Facilities · {facilities.length}</h2></div>
          {tenant ? (
            <>
              <table className="t"><thead><tr><th>Name</th><th>Country</th></tr></thead>
                <tbody>{facilities.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.country}</td></tr>)}</tbody></table>
              <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
                <input className="input grow" placeholder="Facility name" value={newFac.name} onChange={(e) => setNewFac({ ...newFac, name: e.target.value })} />
                <input className="input" style={{ width: 70 }} maxLength={2} placeholder={tenant.country} value={newFac.country} onChange={(e) => setNewFac({ ...newFac, country: e.target.value.toUpperCase() })} />
                <button className="btn" disabled={!newFac.name.trim()} onClick={() => run(async () => {
                  await api.createFacility({ name: newFac.name.trim(), country: newFac.country || undefined }); setNewFac({ name: '', country: '' }); setFacilities((await api.facilities()).facilities);
                }, 'Facility added')}>Add facility</button>
              </div>
            </>
          ) : <div className="empty">Choose or create a company first.</div>}
        </div>
      </div>
    </div>
  );
}
