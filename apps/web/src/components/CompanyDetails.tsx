/**
 * Organisation → Company details & logo: the reporting entity printed on every report (legal name, registration,
 * LEI, country and region, sector and its code, regulator / registry ID, contact, net revenue for intensity
 * figures, financial year end) and the company logo.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, type RepEntity, type RepSettings } from '../lib/api';

const FIELDS: [keyof RepEntity, string, string][] = [
  ['legal', 'Legal name', 'as registered'], ['licence', 'Company registration no.', 'e.g. Companies House, trade licence, CIN'], ['lei', 'LEI (Legal Entity Identifier)', '20 characters'],
  ['region', 'Region / state / province', ''], ['sector', 'Sector', 'e.g. Waste management'], ['sectorCode', 'Sector code (NACE / ISIC / NAICS)', 'e.g. NACE E38.1'],
  ['mrvId', 'Regulator / registry ID', 'e.g. EU ETS operator ID, national MRV ID'], ['contact', 'Reporting contact', 'name, email'], ['website', 'Website', ''],
];

export function CompanyDetails() {
  const { toast, tenant, reload } = useApp();
  const [st, setSt] = useState<RepSettings | null>(null);
  const [e, setE] = useState<RepEntity>({});
  const [v, setV] = useState(0);
  useEffect(() => { api.reportSettings().then((r) => { setSt(r); setE(r.entity); }).catch((x) => toast((x as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <div className="card empty">Loading…</div>;
  const can = st.canEntity, canLogo = st.canEdit;
  const save = async () => { try { await api.saveReportSettings({ entity: e }); toast('Company details saved'); } catch (x) { toast((x as Error).message); } };
  const logo = async (f: File | undefined) => {
    if (!f) return; if (f.size > 1024 * 1024) { toast('Use a logo under 1 MB'); return; }
    try { await api.uploadLogo(f); toast('Logo saved'); setV((x) => x + 1); await reload(); } catch (x) { toast((x as Error).message); }
  };
  return (
    <div className="tagrid2">
      <section className="card tacard">
        <h2>Reporting entity</h2>
        <p className="muted small">Printed on the cover of every report and used by the disclosure formats (ISO 14064-1, ESRS E1, IFRS S2, CDP, GRI 305, SECR…).</p>
        <div className="formgrid">
          {FIELDS.map(([k, l, ph]) => <label key={k} className="field"><span>{l}</span><input className="input" disabled={!can} value={(e[k] as string) ?? ''} maxLength={300} placeholder={k === 'legal' ? st.company.name : ph} onChange={(x) => setE({ ...e, [k]: x.target.value })} /></label>)}
          <label className="field"><span>Net revenue (for intensity per revenue)</span><input className="input num" disabled={!can} inputMode="decimal" value={e.revenue ?? ''} onChange={(x) => setE({ ...e, revenue: x.target.value === '' ? null : Number(x.target.value.replace(/[^0-9.]/g, '')) })} /></label>
          <label className="field"><span>Revenue currency</span><input className="input" disabled={!can} maxLength={3} placeholder={st.company.currency ?? 'USD'} value={e.revenueCurrency ?? ''} onChange={(x) => setE({ ...e, revenueCurrency: x.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></label>
          <label className="field"><span>Financial year end (MM-DD)</span><input className="input" disabled={!can} placeholder="12-31" maxLength={5} value={e.fyEnd ?? ''} onChange={(x) => setE({ ...e, fyEnd: x.target.value })} /></label>
        </div>
        <div className="row"><span className="muted small">Country {st.company.country} · consolidation {st.company.consolidation} · GWP {st.company.gwp} (Methodology & boundaries)</span><span className="grow" />
          {can && <button className="btn p" onClick={() => void save()}>Save</button>}</div>
      </section>
      <section className="card tacard">
        <h2>Company logo</h2>
        <div className="logobox">{tenant?.has_logo ? <img src={`/api/tenant/logo?v=${v}`} alt="Company logo" /> : <span className="muted small">No logo yet</span>}</div>
        {canLogo && <div className="row" style={{ gap: 8 }}><label className="btn">Upload PNG or JPEG<input type="file" accept="image/png,image/jpeg" hidden onChange={(x) => void logo(x.target.files?.[0])} /></label>
          {tenant?.has_logo && <button className="btn ghost" onClick={async () => { await api.removeLogo().catch(() => {}); await reload(); }}>Remove</button>}</div>}
        <span className="muted small">Shown on the report cover and page headers. A wide logo on a white or transparent background works best (at least 400 px wide, under 1 MB).</span>
      </section>
    </div>);
}
