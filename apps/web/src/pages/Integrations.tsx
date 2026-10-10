/**
 * Integrations & API: clients that send meter readings (OAuth 2.0 client credentials),
 * how to call the API, and the company time zone used for month boundaries.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, type ApiKey } from '../lib/api';
import { Icon } from '../components/Icon';

const ZONES = ['Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Muscat', 'Asia/Kuwait', 'Asia/Bahrain', 'Africa/Cairo', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'UTC'];

export function Integrations() {
  const { toast, role, tenant } = useApp();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['meter_readings']);
  const [fresh, setFresh] = useState<(ApiKey & { key: string }) | null>(null);
  const [tz, setTz] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const admin = ['platform_admin', 'super_admin'].includes(role);
  const load = () => api.apiKeys().then((r) => setKeys(r.keys)).catch((e) => setErr(e.message));
  useEffect(() => { if (admin) load(); api.tenant().then((t) => setTz(t.timezone ?? 'Asia/Dubai')).catch(() => {}); }, [tenant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const origin = window.location.origin;

  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Setup</div><h1>Integrations & API</h1>
        <p className="sub">Systems that send data to {tenant?.name ?? 'the company'}: building management, utility portals, IoT platforms and data loggers (meter readings, matched by the meter's id); ERP and finance systems (purchase lines, reviewed under Add data → Purchases).</p></div></div>
      {err && <div className="note bad">{err}</div>}

      {admin && (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>API clients</h2>
          <p className="sub">Each sending system gets its own client id and secret. The secret is shown once; only a fingerprint of it is kept. Revoke a client to stop it at once.</p>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={name} maxLength={80} placeholder="Name of the system, e.g. BMS Al Saja'a, DEWA portal export" onChange={(e) => setName(e.target.value)} />
            {[['meter_readings', 'Meter readings'], ['purchases', 'Purchase lines']].map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 4, fontSize: 13 }}><input type="checkbox" checked={scopes.includes(k!)} onChange={(e) => setScopes((s) => (e.target.checked ? [...s, k!] : s.filter((x) => x !== k)))} />{l}</label>))}
            <button className="btn p" disabled={name.trim().length < 2 || !scopes.length} onClick={async () => { try { setFresh(await api.addApiKey(name.trim(), scopes)); setName(''); load(); } catch (e) { setErr((e as Error).message); } }}><Icon name="plus" />New client</button>
          </div>
          {fresh && (
            <div className="note warn" style={{ display: 'grid', gap: 6 }}>
              <b>Copy the secret now — it will not be shown again. Give it to the system's administrator privately (not by email or chat).</b>
              <div>Client id: <span className="mono">{fresh.id}</span></div>
              <div>Client secret: <span className="mono" style={{ wordBreak: 'break-all' }}>{fresh.key}</span> <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(fresh.key); toast('Secret copied'); }}>Copy</button></div>
              <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setFresh(null)}>Done</button>
            </div>
          )}
          {keys.length ? (
            <table className="t">
              <thead><tr><th>Client</th><th>May send</th><th>Client id</th><th>Secret starts</th><th>Created</th><th>Last used</th><th /></tr></thead>
              <tbody>{keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'off' : ''}>
                  <td><b>{k.name}</b>{k.revoked_at && <span className="chip grey" style={{ marginLeft: 6 }}>revoked</span>}</td>
                  <td className="small">{k.scopes.map((x) => (x === 'purchases' ? 'purchases' : 'meter readings')).join(', ')}</td><td className="mono small">{k.id}</td><td className="mono">{k.prefix}…</td>
                  <td>{k.created_at.slice(0, 10)}</td><td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString('en-GB') : 'never'}</td>
                  <td>{!k.revoked_at && <button className="btn ghost sm danger" onClick={async () => { await api.revokeApiKey(k.id); toast(`${k.name} revoked`); load(); }}>Revoke</button>}</td>
                </tr>))}</tbody>
            </table>
          ) : <div className="empty">No API clients yet.</div>}
        </div>
      )}

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2>Sending meter readings</h2>
        <ol className="steps">
          <li>Get an access token (valid 1 hour) with the client id and secret — OAuth 2.0 client credentials:
            <pre className="code">{`POST ${origin}/api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<client id>&client_secret=<secret>`}</pre></li>
          <li>Send readings with the token, up to 100,000 per request (at most 120 requests a minute per client):
            <pre className="code">{`POST ${origin}/api/v1/meter-readings
Authorization: Bearer <access token>
Content-Type: application/json

{ "readings": [
  { "meterId": "BMS-GAS-01", "timestamp": "2026-03-01T01:00:00+04:00", "value": 10.4 },
  { "meterId": "DEWA-2001458876", "timestamp": "2026-04-01T00:00:00+04:00", "value": 45500, "start": "2026-03-01T00:00:00+04:00" }
] }`}</pre></li>
          <li>The answer gives the batch id and what it holds — new readings, corrections, duplicates (skipped), conflicts with booked bills (skipped), refused (with the reason). The batch waits for review under Add data → the category → Meter readings and counts once published (a super admin can switch review off). List the meters and their ids with <span className="mono">GET /api/v1/meters</span>.</li>
        </ol>
        <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>timestamp</b>: time of the reading — for consumption per period, the end of the period. With a zone (Z or +04:00); without one it is read in the company time zone.</li>
          <li><b>value</b>: register reading (index) or consumption for the period, as the meter is set up, in the meter's unit before its multiplier.</li>
          <li>The same meter and time sent again replaces the earlier value (a correction, recorded in the audit log). Approved entries are never changed by new readings: the difference is reported instead.</li>
          <li>Hourly, daily, weekly, monthly and irregular readings all work: periods across a month end are split by time; a month's coverage is shown and a partly covered month can be scaled up (marked estimated).</li>
        </ul>
      </div>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2>Sending purchase lines (ERP)</h2>
        <p className="sub">For SAP, Oracle, Dynamics or any finance system: send the lines of a period under one reference, in as many calls as needed (up to 10,000 lines each), then mark the batch complete. It is then mapped and calculated, and reviewed and published under Add data → Purchases like an upload. The client needs the “Purchase lines” permission.</p>
        <pre className="code">{`POST ${origin}/api/v1/purchases
Authorization: Bearer <access token>
Content-Type: application/json

{ "reference": "SAP-2026-03", "currency": "AED", "facility": "BEEAH Headquarters", "complete": false,
  "lines": [
    { "date": "2026-03-10", "description": "Copier paper A4 80gsm", "amount": 4250, "supplier": "Gulf Stationery LLC",
      "supplierRef": "V100231", "supplierCountry": "AE", "category": "Office supplies", "glAccount": "Office expenses", "poNumber": "4500123", "quantity": 50, "unit": "box" },
    { "date": "2026-03-12", "description": "Ready mix concrete C40", "amount": 182000, "facility": "Al Saja'a Recycling Complex",
      "supplierEf": 210, "supplierEfUnit": "m3", "quantity": 400, "unit": "m3", "capital": true }
] }

POST ${origin}/api/v1/purchases/SAP-2026-03/complete     (or "complete": true on the last call)
GET  ${origin}/api/v1/purchases/SAP-2026-03              status and counts`}</pre>
        <ul className="sub" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>description</b> and <b>amount</b> (or a quantity with a supplier factor) are required; <b>date</b> as yyyy-mm-dd; <b>facility</b> by name, per line or for the whole call.</li>
          <li><b>supplierRef</b> (the ERP vendor number) and <b>supplierCountry</b> link each line to the right supplier and fill its profile; without them the name is matched (spellings and typos recognised).</li>
          <li>Each line is checked on its own: lines with problems are listed in the answer (index and reason) and kept for review; the others continue.</li>
          <li>A completed reference is closed: send corrections under a new reference. The same line sent twice (same date, amount, supplier, description, PO) is marked as a duplicate.</li>
        </ul>
      </div>

      {admin && (
        <div className="card row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 240 }}><span>Company time zone (month boundaries)</span>
            <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{[...new Set([tz, ...ZONES])].filter(Boolean).map((z) => <option key={z}>{z}</option>)}</select></label>
          <button className="btn" onClick={async () => { try { await api.setTimezone(tz); toast(`Time zone: ${tz}`); } catch (e) { setErr((e as Error).message); } }}>Save</button>
          <span className="sub grow">A month runs from local midnight on the 1st. Changing it later moves the boundaries of months not yet approved when they are recalculated.</span>
        </div>
      )}
    </div>
  );
}
