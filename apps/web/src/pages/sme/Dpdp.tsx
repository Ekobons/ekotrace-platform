/** DPDP Act readiness: the platform's checklist, ticked by the company; progress comes from the server. */
import { useSme } from './store';
import { Kpi, Kpis, SmeHead } from './ui';
import { dmy, f0 } from '../../lib/sme';
import './comply.css';

interface Item { key: string; title: string; hint?: string }

function monthsUntil(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`), t = new Date();
  let m = (d.getFullYear() - t.getFullYear()) * 12 + d.getMonth() - t.getMonth();
  if (d.getDate() < t.getDate()) m--;
  return Math.max(0, m);
}

export function SmeDpdp() {
  const { d, get, set } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const items = (d.config.dpdp?.items ?? []) as Item[];
  const deadline = (d.config.dpdp?.deadline ?? '') as string;
  const ticked = items.filter((x) => !!get(`dpdp.${x.key}`)).length;
  // ticks show at once; the server's figure follows on save
  const pct = items.length ? (ticked / items.length) * 100 : Number(d.results.dpdpPct ?? 0);
  const next = items.find((x) => !get(`dpdp.${x.key}`));

  return (
    <>
      <SmeHead lede="The Digital Personal Data Protection Act applies to every business that holds personal data, including employee, customer, vendor and CCTV records. Most duties apply from May 2027." />
      <Kpis>
        <Kpi label="Checklist done" value={`${f0(pct)}%`} unit={`${ticked} of ${items.length} steps`} good={pct >= 80} />
        <Kpi label="Months left" value={deadline ? monthsUntil(deadline) : '—'} unit={deadline ? `to ${dmy(deadline)}` : ''} />
        <Kpi label="Next step" value={<span style={{ fontSize: 15 }}>{next ? next.title : 'All done'}</span>} />
      </Kpis>

      <div className="cmp-main">
        <div className="card">
          <div className="cmp-h2row"><h2>Readiness checklist</h2><span className="muted small">{ticked} of {items.length}</span></div>
          <div className="cmp-prog" style={{ margin: '10px 0 6px' }}><b style={{ width: `${pct}%` }} /></div>
          <div className="cmp-checks">
            {items.map((x, i) => {
              const on = !!get(`dpdp.${x.key}`);
              return (
                <div key={x.key} className={`cmp-check${on ? ' on' : ''}`}>
                  <input id={`dp-${x.key}`} type="checkbox" checked={on} disabled={!d.canEdit} onChange={(e) => set(`dpdp.${x.key}`, e.target.checked)} />
                  <label htmlFor={`dp-${x.key}`}>{x.title}{x.hint && <small>{x.hint}</small>}</label>
                  <span className="num">{i + 1}</span>
                </div>);
            })}
            {!items.length && <p className="empty">The checklist is not set up yet.</p>}
          </div>
        </div>

        <div className="cmp-stack">
          <div className="card"><h2>What the law asks</h2>
            <ul className="cmp-time">
              <li><b>Notice</b><span>Tell people what you collect, why, and how to withdraw consent.</span></li>
              <li><b>Consent</b><span>Get clear consent, and keep a record of it.</span></li>
              <li><b>Safeguards</b><span>Protect the data, keep it only as long as needed, then delete it.</span></li>
              <li><b>Breaches</b><span>Inform the Data Protection Board and the people affected.</span></li>
              <li><b>Rights</b><span>Let people see, correct and erase their data, and name a contact for questions.</span></li>
            </ul>
          </div>
          
          <p className="muted small" style={{ margin: 0 }}>{d.config.dpdp?.note}</p>
        </div>
      </div>
    </>);
}
