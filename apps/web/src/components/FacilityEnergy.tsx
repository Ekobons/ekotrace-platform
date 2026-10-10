/**
 * Facility → Energy: the facility's energy set-up in one place — the grid region and its
 * factors (location-based Scope 2), utility accounts (meters that bills are matched to),
 * and the certificates and contracts that can be claimed here (market-based Scope 2).
 * Each is edited where it lives; this tab shows them together with links.
 */
import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, type Certificate, type GridRegion, type Meter, type OrgNode } from '../lib/api';

const BASIS: Record<string, string> = { scope2: 'Grid average (location-based)', scope2_market: 'Residual mix (market-based)', td_loss: 'Grid losses (T&D)', wtt: 'Upstream of generation (WTT)' };

export function FacilityEnergy({ node, onProfile }: { node: OrgNode; onProfile: () => void }) {
  const { role } = useApp();
  const isAdmin = ['super_admin', 'admin', 'manager', 'verifier'].includes(role); // who sees the register page
  const [region, setRegion] = useState<GridRegion | null | undefined>(undefined);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [certs, setCerts] = useState<Certificate[]>([]);
  useEffect(() => {
    api.gridRegions().then((r) => setRegion(r.regions.find((g) => g.code === node.grid_region) ?? null)).catch(() => setRegion(null));
    api.meters(node.id).then((r) => setMeters(r.meters)).catch(() => setMeters([]));
    api.certificates({ facilityId: node.id }).then((r) => setCerts(r.certificates)).catch(() => setCerts([]));
  }, [node.id, node.grid_region]);

  // Latest year per basis for the region.
  const latest = Object.values((region?.factors ?? []).reduce<Record<string, NonNullable<GridRegion['factors']>[number]>>((a, f) => {
    if (!a[f.basis] || a[f.basis]!.year < f.year) a[f.basis] = f; return a;
  }, {}));
  const accounts = meters.filter((m) => m.account_no);

  return (
    <div className="facility-energy" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <fieldset className="box"><legend>Grid region · location-based Scope 2</legend>
        {region === undefined ? <div className="sub">Loading…</div> : !node.grid_region ? (
          <div className="note warn">No grid region set: electricity here uses the country average for {node.country}. <button className="btn sm" onClick={onProfile}>Set it in Profile</button></div>
        ) : (
          <dl>
            <dt>Region</dt><dd><b>{region?.name ?? node.grid_region}</b> <span className="muted small mono">{node.grid_region}</span></dd>
            {latest.map((f) => <Fragment key={f.basis}><dt>{BASIS[f.basis] ?? f.basis}</dt><dd>{num(f.co2e)} {f.unit} · {f.year} · <span className="muted small">{f.source}</span></dd></Fragment>)}
            {!latest.length && <><dt>Factors</dt><dd className="muted">none loaded for this region yet</dd></>}
          </dl>
        )}
        <div className="sub" style={{ marginTop: 8 }}>Changed in the Profile tab. Factors are kept in the Library.</div>
      </fieldset>

      <fieldset className="box"><legend>Utility accounts · bills are matched to these</legend>
        {accounts.length ? (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Account</th><th>Meter</th><th>Measures</th><th>Last reading</th></tr></thead>
            <tbody>{accounts.map((m) => <tr key={m.id}><td className="mono">{m.account_no}</td><td>{m.name}</td><td>{m.item}</td><td>{m.last ? new Date(m.last.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : <span className="chip warn">none yet</span>}</td></tr>)}</tbody>
          </table></div>
        ) : <div className="sub">No utility account numbers yet. Add one to a meter (Meters tab → Settings) so uploaded bills find it automatically.</div>}
        <div className="sub" style={{ marginTop: 8 }}>Upload bills under <Link to="/data/purchased_electricity?via=bills">Add data → Electricity → Bills</Link> (fuel and waste bills under their own tabs).</div>
      </fieldset>

      <fieldset className="box"><legend>Certificates & contracts usable here · market-based Scope 2</legend>
        {certs.length ? (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Instrument</th><th>Applies to</th><th>Vintage</th><th className="num">MWh</th><th className="num">Left</th></tr></thead>
            <tbody>{certs.map((c) => (
              <tr key={c.id}><td>{c.standard ?? c.instrument} · {c.technology}<div className="muted small">{c.reference ?? c.supplier ?? ''}</div></td>
                <td>{c.facility_id ? 'this facility' : <span className="chip grey">whole company</span>}</td>
                <td className="small">{c.vintage_from.slice(0, 7)} – {c.vintage_to.slice(0, 7)}</td>
                <td className="num">{num(Number(c.mwh))}</td><td className="num">{num(Number(c.mwh) - Number(c.claimed_mwh))}</td></tr>))}</tbody>
          </table></div>
        ) : <div className="sub">None. Without certificates or contracts, market-based Scope 2 uses the supplier factor or the residual mix.</div>}
        <div className="sub" style={{ marginTop: 8 }}>{isAdmin ? <>Managed under <Link to="/energy">Setup → Energy certificates & suppliers</Link>.</> : 'Managed by an admin under Setup → Energy certificates & suppliers.'}</div>
      </fieldset>
    </div>
  );
}
