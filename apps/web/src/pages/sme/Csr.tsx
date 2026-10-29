/** CSR (Companies Act s.135): does the 2% rule apply, how much to spend, how much is left. */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, SmeHead } from './ui';
import { dmy, f2, lakh, n } from '../../lib/sme';
import './comply.css';

const cr = (v: number) => `₹${f2(v)} Cr`;

export function SmeCsr() {
  const { d, get } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const c = d.results.csr as { applies: boolean; avgProfit: number; obligation: number; left: number; committeeNeeded: boolean };
  const nw = n(get('csr.netWorth')), to = n(get('profile.turnover')), p3 = n(get('csr.profit3')), spent = n(get('csr.spent'));
  const filled = ['csr.netWorth', 'csr.profit1', 'csr.profit2', 'csr.profit3'].some((k) => get(k) !== undefined && get(k) !== '');
  const tests: [string, string, boolean, string][] = [
    ['Net worth ₹500 crore or more', nw ? `Yours: ${cr(nw)}` : 'Add net worth', nw >= 500, 'csr'],
    ['Turnover ₹1,000 crore or more', to ? `Yours: ${cr(to)} (from Profile)` : 'Add turnover in Profile', to >= 1000, 'profile'],
    ['Net profit ₹5 crore or more last year', p3 ? `Yours: ${cr(p3)}` : 'Add last year’s profit', p3 >= 5, 'csr'],
  ];
  const pct = c.obligation > 0 ? Math.min(100, (spent / c.obligation) * 100) : 0;
  const due = (d.results.calendar as { id: string; date: string }[]).find((x) => x.id === 'csr');

  return (
    <>
      <SmeHead lede="Section 135 of the Companies Act: once any one threshold is crossed, the company must spend 2% of its average net profit of the last three years on CSR." />
      <Kpis>
        <Kpi label="Does CSR apply?" value={filled || to ? (c.applies ? 'Yes' : 'No') : '—'} unit={c.applies ? 'a threshold is crossed' : filled ? 'no threshold crossed' : 'add your figures'} />
        <Kpi label="2% obligation" value={c.applies ? lakh(c.obligation * 1e7) : '—'} unit="this year" />
        <Kpi label="Spent so far" value={c.applies ? lakh(spent * 1e7) : '—'} />
        <Kpi label="Still to spend" value={c.applies ? lakh(c.left * 1e7) : '—'} good={c.applies && c.left <= 0} />
      </Kpis>

      <div className="sme-grid2">
        <div className="card"><h2>Your figures</h2>
          <p className="cmp-sub">From your audited accounts, in ₹ crore. Net profit is as worked out under section 198.</p>
          <Num path="csr.netWorth" label="Net worth" unit="₹ Cr" />
          <Num path="csr.profit1" label="Net profit, three years ago" unit="₹ Cr" />
          <Num path="csr.profit2" label="Net profit, two years ago" unit="₹ Cr" />
          <Num path="csr.profit3" label="Net profit, last year" unit="₹ Cr" />
          <Num path="csr.spent" label="CSR spent so far this year" unit="₹ Cr" />
        </div>

        <div className="cmp-stack">
          <div className="card"><h2>The three tests</h2>
            <p className="cmp-sub">Crossing any one of them in the previous year brings in CSR.</p>
            <div className="cmp-tests">
              {tests.map(([t, sub, ok, go]) => (
                <div key={t} className="cmp-test"><span>{t}</span><Pill kind={ok ? 'likely' : 'watch'}>{ok ? 'Crossed' : 'Not crossed'}</Pill>
                  <small>{sub}{go === 'profile' && !to && <> · <Link to="/sme/profile">Profile</Link></>}</small></div>))}
            </div>
          </div>

          {c.applies ? (
            <div className="card"><h2>What you need to do</h2>
              <div className="cmp-prog" style={{ marginTop: 12 }}><b style={{ width: `${pct}%` }} /></div>
              <div className="cmp-progl"><span>{lakh(spent * 1e7)} spent</span><span>{lakh(c.obligation * 1e7)} to spend</span></div>
              <ul className="cmp-time" style={{ marginTop: 14 }}>
                <li><b>Obligation</b><span>Average profit of the last three years is {cr(c.avgProfit)}; 2% of that is {lakh(c.obligation * 1e7)}.</span></li>
                <li><b>Committee</b><span>{c.committeeNeeded ? 'The obligation is ₹50 lakh or more, so the board must form a CSR committee.' : 'Below ₹50 lakh, the board itself can run CSR without a separate committee.'}</span></li>
                <li><b>Deadline</b><span>Spend by the end of the financial year{due ? ` (${dmy(due.date)})` : ''}. Unspent money goes to a Schedule VII fund within six months, or to an Unspent CSR Account for an ongoing project.</span></li>
                <li><b>Where to spend</b><span>Water, skilling or renewable energy projects near your plant also lift your <Link to="/sme/esg">ESG score</Link>.</span></li>
              </ul>
            </div>
          ) : (
            <div className="sme-callout">{filled || to ? 'CSR does not apply at your current figures. Check again each year after the accounts are audited.' : 'Add your net worth and the last three years’ net profit to check whether CSR applies.'}</div>
          )}
        </div>
      </div>
    </>);
}
