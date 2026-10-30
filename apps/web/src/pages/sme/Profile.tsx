/**
 * Profile: company details (owner / admin only), the financial year being worked on, and the
 * short list of yes/no answers that decide what applies (requirements, schemes, calendar).
 */
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Choice, Num, Pill, Sample, SmeHead, Toggle } from './ui';
import { f0, type SmeCompany } from '../../lib/sme';
import './carbon.css';
import { PlantsCard } from './Plants';
import { t, tn } from './i18n';

const CBAM_GOODS: [string, string][] = [['', 'Not chosen yet'], ['none', 'Not a CBAM good'], ['steel', 'Iron & steel products'], ['aluminium', 'Aluminium products'], ['cement', 'Cement'], ['fertiliser', 'Fertilisers']];
const EUDR: [string, string][] = [['none', 'None'], ['leather', 'Leather / cattle products'], ['rubber', 'Rubber'], ['coffee', 'Coffee'], ['wood', 'Wood, furniture or paper'], ['soya', 'Soya'], ['cocoa', 'Cocoa'], ['palm oil', 'Palm oil']];
const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/** "FY 2026-27" → 2026 */
const fyStart = (fy: string) => Number(/^FY (\d{4})/.exec(fy)?.[1] ?? 0);
const fyName = (s: number) => `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`;

/** Which financial year the screens show, and starting another one. */
export function FyPicker() {
  const { d, fy, setFy } = useSme(); const id = useId();
  const [adding, setAdding] = useState(false);
  if (!d) return null;
  const years = [...new Set([...d.years, fy])].sort().reverse();
  const newest = Math.max(...years.map(fyStart));
  const others = [newest + 1, ...Array.from({ length: 5 }, (_, i) => newest - i)].map(fyName).filter((y) => !years.includes(y));
  return (
    <div className="cb-fy">
      <label htmlFor={id} className="lbl">{t('Financial year')}</label>
      <select id={id} className="input" value={fy} onChange={(e) => setFy(e.target.value)}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {d.canEdit && !adding && <button type="button" className="btn sm ghost" onClick={() => setAdding(true)}>{t('Start another year')}</button>}
      {adding && (
        <select className="input" aria-label={t('Year to start')} defaultValue="" onChange={(e) => { if (e.target.value) { setAdding(false); setFy(e.target.value); } }}>
          <option value="" disabled>{t('Choose a year…')}</option>
          {others.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>)}
    </div>);
}

type Draft = { name: string; sector: SmeCompany['sector']; industry: string; state: string; udyamNo: string };
const fromCompany = (c: SmeCompany): Draft => ({ name: c.name, sector: c.sector, industry: c.industry ?? '', state: c.state ?? '', udyamNo: c.udyamNo ?? '' });

function CompanyCard() {
  const { d, saveCompany } = useSme();
  const c = d!.company, can = d!.canManage;
  const [f, setF] = useState<Draft>(() => fromCompany(c));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setF(fromCompany(c)); }, [c]);
  const states: string[] = d!.config.states ?? [];
  const base = fromCompany(c);
  const dirty = (Object.keys(f) as (keyof Draft)[]).some((k) => f[k] !== base[k]);
  const udyamBad = !!f.udyamNo.trim() && !UDYAM.test(f.udyamNo.trim().toUpperCase());
  const nameBad = f.name.trim().length < 2;
  const ids = { name: useId(), sector: useId(), industry: useId(), state: useId(), udyam: useId() };
  const up = (k: keyof Draft) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await saveCompany({ name: f.name.trim(), sector: f.sector, industry: f.industry.trim(), ...(f.state ? { state: f.state } : {}), udyamNo: f.udyamNo.trim() ? f.udyamNo.trim().toUpperCase() : null });
      setMsg({ ok: true, text: t('Company details saved.') });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <div className="card cb-form">
      <div className="cb-h"><h2>{t('Company')}</h2>{c.isExample && <Sample />}</div>
      {!can && <p className="cb-sub">{t('Only an owner or admin can change these details.')}</p>}
      <div className="sme-field wide" style={{ borderTop: 0 }}>
        <label htmlFor={ids.name}>{t('Company name')}</label>
        <input id={ids.name} className="input" value={f.name} disabled={!can} onChange={up('name')} />
        {can && nameBad && <div className="cb-err">{t('Enter the company name.')}</div>}
      </div>
      <div className="sme-field">
        <label htmlFor={ids.sector}>{t('Sector')}<small>{t('Decides which SRMM version and which modules fit you')}</small></label>
        <select id={ids.sector} className="input" value={f.sector} disabled={!can} onChange={up('sector')}>
          <option value="mfg">{t('Manufacturing')}</option><option value="svc">{t('Services')}</option>
        </select>
      </div>
      <div className="sme-field wide">
        <label htmlFor={ids.industry}>{t('Industry')}<small>{t('For example: fabricated metal products, textiles, IT services')}</small></label>
        <input id={ids.industry} className="input" value={f.industry} disabled={!can} onChange={up('industry')} />
      </div>
      <div className="sme-field">
        <label htmlFor={ids.state}>{t('State')}<small>{t('Sets solar yield and state due dates')}</small></label>
        <select id={ids.state} className="input" value={f.state} disabled={!can} onChange={up('state')}>
          {!f.state && <option value="">{t('Choose…')}</option>}
          {f.state && !states.includes(f.state) && <option value={f.state}>{f.state}</option>}
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="sme-field wide">
        <label htmlFor={ids.udyam}>{t('Udyam registration number')}<small>{t('Optional. Format UDYAM-XX-00-0000000')}</small></label>
        <input id={ids.udyam} className="input" autoComplete="off" value={f.udyamNo} disabled={!can} placeholder={t('UDYAM-MH-00-0000000')} onChange={up('udyamNo')} />
        {can && udyamBad && <div className="cb-err">{t('This does not look like a Udyam number. Check the format before saving.')}</div>}
      </div>
      {can && (
        <div className="cb-actions">
          <button type="button" className="btn p" disabled={!dirty || busy || nameBad} onClick={save}>{busy ? t('Saving…') : t('Save company details')}</button>
          {dirty && !busy && <button type="button" className="btn ghost" onClick={() => { setF(base); setMsg(null); }}>{t('Undo changes')}</button>}
          {msg && <span className={msg.ok ? 'muted small' : 'chip bad'} role="status">{msg.text}</span>}
        </div>)}
    </div>);
}

export function SmeProfile() {
  const { d, get, error } = useSme();
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading your data…')}</div>;
  const r = d.results, mfg = d.company.sector !== 'svc';
  const reqs = (r.requirements ?? []) as { status: string }[];
  const act = reqs.filter((x) => x.status === 'apply').length, check = reqs.filter((x) => x.status === 'likely').length;
  const exportsEu = !!get('profile.euExport'), exportsUk = !!get('profile.ukExport');
  const turnover = Number(get('profile.turnover')) || 0;
  return (
    <div className="cb-stack">
      <SmeHead lede={t('Who you are and what you do. These answers decide which rules, schemes and due dates show up for you.')}><FyPicker /></SmeHead>

      <div className="sme-grid2">
        <CompanyCard />
        <div className="card">
          <h2>{t('Size')}</h2>
          <p className="cb-sub">{t('For {fy}. Turnover sets your MSME class and some thresholds such as CSR.', { fy: d.fy })}</p>
          <Num path="profile.employees" label={t('Employees')} hint={t('Everyone on the payroll, including contract workers')} unit={t('people')} />
          <Num path="profile.turnover" label={t('Turnover')} hint={t('From your audited accounts or GST returns')} unit="₹ cr" />
          {mfg && <Num path="profile.production" label={t('Annual production')} hint={t('Used for product footprints and CBAM')} unit="t" />}
          <Toggle path="profile.udyam" label={t('Udyam registered')} hint={t('Needed for most MSME schemes')} />
          <div className="cb-facts">
            <div className="cb-fact">{t('MSME class')}<b>{turnover > 0 ? t('{cls} enterprise', { cls: t(r.msmeClass) }) : '—'}</b></div>
            {Number(get('profile.employees')) > 0 && <div className="cb-fact">{t('Employees')}<b>{f0(get('profile.employees'))}</b></div>}
          </div>
          {turnover <= 0 && <p className="cb-muted-note">{t('Add your turnover to see your MSME class.')}</p>}
        </div>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Customers and exports')}</h2>
          <p className="cb-sub">{t('Who you sell to decides most ESG data requests.')}</p>
          <Toggle path="profile.listedBuyer" label={t('We supply a listed company')} hint={t('Large customers who file BRSR ask suppliers for ESG data')} />
          <Toggle path="profile.listed" label={t('We are a listed company')} hint={t('Only listed companies file their own BRSR')} />
          <Toggle path="profile.euExport" label={t('We export to the EU')} />
          <Toggle path="profile.ukExport" label={t('We export to the UK')} />
          {(exportsEu || exportsUk) && <Choice path="profile.cbamGood" label={t('Main export product')} hint={t('Iron & steel, aluminium, cement and fertilisers are covered by CBAM')} options={CBAM_GOODS} />}
          {exportsEu && <Choice path="profile.eudr" label={t('Do you export any of these to the EU?')} hint={t('Covered by the EU Deforestation Regulation')} options={EUDR} />}
        </div>
        <div className="card">
          <h2>{t('Products and activities')}</h2>
          <p className="cb-sub">{t('These bring extended producer responsibility (EPR) and carbon-market rules.')}</p>
          <Toggle path="profile.plastics" label={t('We use plastic packaging')} hint={t('For the goods we sell, as brand owner, producer or importer')} />
          <Toggle path="profile.ewaste" label={t('We make electrical or electronic goods')} />
          <Toggle path="profile.battery" label={t('We make or import batteries')} />
          <Toggle path="profile.energyIntensive" label={t('We are in a CCTS-covered sector')} hint={t('Aluminium, cement, chlor-alkali, pulp & paper, iron & steel, petrochemicals, refining, textiles')} />
        </div>
      </div>

      <PlantsCard />

      <div className="sme-callout">
        {act || check
          ? <>{t('From these answers:')} {act > 0 && <><Pill kind="apply">{t('{n} to act on', { n: act })}</Pill> </>}{check > 0 && <Pill kind="likely">{t('{n} to check', { n: check })}</Pill>} {tn('See {link}.', { link: <Link to="/sme/applies">{t('What applies')}</Link> })}</>
          : <>{tn('Your answers update {a}, {b} and the {c} straight away.', { a: <Link to="/sme/applies">{t('What applies')}</Link>, b: <Link to="/sme/schemes">{t('Schemes')}</Link>, c: <Link to="/sme/calendar">{t('Calendar')}</Link> })}</>}
      </div>
    </div>);
}
