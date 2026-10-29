/** EPR: plastic packaging obligation (placed on market, target, certificates bought), with e-waste and battery checks. */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Choice, Kpi, Kpis, Num, Pill, Req, SmeHead, Toggle } from './ui';
import { dmy, f1, n } from '../../lib/sme';
import './comply.css';

const ROLES: [string, string][] = [['', 'Choose'], ['Brand owner', 'Brand owner'], ['Producer', 'Producer'], ['Importer', 'Importer']];

export function SmeEpr() {
  const { d, get } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const e = d.results.epr as { total: number; need: number; gap: number; registered: boolean };
  const plastics = !!get('profile.plastics'), ewaste = !!get('profile.ewaste'), battery = !!get('profile.battery');
  const bought = n(get('epr.bought'));
  const pct = e.need > 0 ? Math.min(100, (bought / e.need) * 100) : 0;
  const due = (d.results.calendar as { id: string; date: string; status: string }[]).find((x) => x.id === 'epr');
  const covered = e.registered && e.need > 0 && e.gap <= 0;

  return (
    <>
      <SmeHead lede="Extended Producer Responsibility: if you put plastic packaging, electrical goods or batteries on the Indian market, you must register with CPCB and cover your share of recycling each year." />

      {plastics ? (
        <Kpis>
          <Kpi label="Plastic placed on market" value={f1(e.total)} unit="tonnes this year" />
          <Kpi label="Certificates needed" value={f1(e.need)} unit="tonnes" />
          <Kpi label="Certificates bought" value={f1(bought)} unit="tonnes" />
          <Kpi label="Gap to close" value={f1(e.gap)} unit="tonnes" good={covered} />
        </Kpis>
      ) : (
        <div className="sme-callout">Plastic EPR applies when you sell goods in plastic packaging under your brand, make plastic packaging or import it. Turn on <b>We use plastic packaging</b> below if that is you.</div>
      )}

      <div className="sme-grid2">
        <div className="card">
          <div className="cmp-h2row"><h2>Plastic packaging</h2>{plastics && <Pill kind={!e.registered ? 'overdue' : e.gap > 0 ? 'soon' : 'done'}>{!e.registered ? 'Not registered' : e.gap > 0 ? 'Gap open' : 'Covered'}</Pill>}</div>
          <Toggle path="profile.plastics" label="We use plastic packaging" hint="Saved to your profile too" />
          {plastics && <>
            <Choice path="epr.role" label="Your role" options={ROLES} hint="Brand owner: your brand on the pack. Producer: you make the packaging. Importer: you import it." />
            <Toggle path="epr.registered" label="Registered on the CPCB EPR portal" />
            <Num path="epr.c1" label="Category I: rigid plastic" hint="Bottles, containers, trays" unit="t" />
            <Num path="epr.c2" label="Category II: flexible plastic" hint="Single-layer films, pouches, carry bags" unit="t" />
            <Num path="epr.c3" label="Category III: multi-layer plastic" hint="Laminates with at least one plastic layer" unit="t" />
            <Num path="epr.c4" label="Category IV: compostable plastic" unit="t" />
            <Num path="epr.target" label="Recycling target for this year" hint="From the Plastic Waste Management Rules schedule for your role" unit="%" />
            <Num path="epr.bought" label="EPR certificates bought" hint="From registered plastic waste processors" unit="t" />
          </>}
        </div>

        <div className="cmp-stack">
          {plastics && (
            <div className="card"><h2>Your position</h2>
              {e.need > 0 ? <>
                <div className={`cmp-prog${e.gap > 0 ? ' warn' : ''}`} style={{ marginTop: 12 }}><b style={{ width: `${pct}%` }} /></div>
                <div className="cmp-progl"><span>{f1(bought)} t bought</span><span>{f1(e.need)} t needed</span></div>
              </> : <p className="cmp-sub">Add the plastic you placed on the market and your target to see what you need to cover.</p>}
              <div style={{ marginTop: 12 }}>
                {!e.registered ? <div className="sme-callout warn">Register on the CPCB centralised EPR portal before you file the annual return. Selling without registration can attract environmental compensation.</div>
                  : e.gap > 0 ? <div className="sme-callout warn">Buy <b>{f1(e.gap)} t</b> of EPR certificates from registered plastic waste processors before the annual return.</div>
                  : e.need > 0 ? <div className="sme-callout">Your plastic EPR obligation is covered for this year.</div> : null}
              </div>
              {due && <p className="cmp-sub" style={{ marginTop: 12 }}>Annual return due <b>{dmy(due.date)}</b> on the CPCB EPR portal. <Link to="/sme/calendar">Calendar</Link></p>}
            </div>)}

          <div className="card"><h2>E-waste and batteries</h2>
            <Toggle path="profile.ewaste" label="We make or import electrical or electronic goods" hint="Saved to your profile too" />
            <Toggle path="profile.battery" label="We make or import batteries, or goods with batteries" hint="Saved to your profile too" />
            {ewaste && <Req title="E-waste EPR" pill="Check" kind="likely">Producers under the E-Waste (Management) Rules, 2022 register on the CPCB e-waste EPR portal, meet yearly recycling targets through registered recyclers and file an annual return.</Req>}
            {battery && <Req title="Battery EPR" pill="Check" kind="likely">Producers under the Battery Waste Management Rules, 2022 register with CPCB, meet collection and recycling targets by battery type and file an annual return.</Req>}
            {!ewaste && !battery && <p className="cmp-sub" style={{ marginTop: 10 }}>Neither applies to you at the moment. Tyre and used-oil EPR apply only to producers and importers of those goods.</p>}
          </div>
        </div>
      </div>
    </>);
}
