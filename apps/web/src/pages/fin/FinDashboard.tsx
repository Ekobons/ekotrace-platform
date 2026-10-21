/**
 * EKOFIN portfolio dashboard: financed emissions of a portfolio at a reporting date (PCAF), intensity,
 * WACI, the weighted data quality score and how much of the portfolio has reported data, where the
 * emissions sit (asset class, sector, top counterparties) and which counterparties to ask for data first.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarList } from '../../components/Charts';
import { fin, money, pct, SCORE_C, SCORE_SHORT, tco2, type FinPeriodData, type Score } from '../../lib/ekofin';
import { ASSET_SHORT, dateLabel, PeriodPicker, ScoreChip, usePeriodChoice } from './common';

export function FinDashboard() {
  const pc = usePeriodChoice();
  const nav = useNavigate();
  const [d, setD] = useState<FinPeriodData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null); setErr(null);
    if (pc.period) fin.period(pc.period.id).then(setD).catch((e) => setErr((e as Error).message));
  }, [pc.period?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pc.error) return <div className="page"><div className="card note bad">{pc.error}</div></div>;
  if (!pc.portfolios) return <div className="page"><div className="card empty">Loading…</div></div>;
  if (!pc.portfolios.length || !pc.portfolio) return (
    <div className="page">
      <div><span className="lbl">EKOFIN</span><h1>Financed emissions</h1></div>
      <div className="card empty"><h2>No portfolio yet</h2>
        <p className="sub">Create a portfolio (a loan book, a fund or a mandate), add a reporting date and upload the holdings. Financed emissions are calculated straight away.</p>
        <p><Link className="btn p" to="/fin/portfolios">Go to portfolios</Link></p></div>
    </div>);

  const S = d?.summary, cur = d?.portfolio.currency ?? pc.portfolio.currency;
  // the counterparties to ask for reported data first: estimated (score 4–5) and largest financed emissions
  const plan = (d?.lines ?? []).filter((l) => (l.result.score ?? 9) >= 4 && l.result.financed).sort((a, b) => b.result.financed!.total - a.result.financed!.total).slice(0, 10);
  const planShare = S && S.financed.total ? plan.reduce((a, l) => a + l.result.financed!.total, 0) / S.financed.total : 0;
  const byScore = S ? ([1, 2, 3, 4, 5] as Score[]).map((s) => ({ s, out: S.byScore.find((b) => b.key === String(s))?.outstanding ?? 0 })) : [];
  const none = S?.byScore.find((b) => b.key === 'none')?.outstanding ?? 0;
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="grow"><span className="lbl">EKOFIN · {pc.portfolio.name}</span><h1>Financed emissions</h1>
          <div className="muted">PCAF Global GHG Accounting and Reporting Standard, Part A. Scope 1 and 2 of the companies financed, attributed by outstanding amount; Scope 3 shown separately.</div></div>
        <PeriodPicker portfolios={pc.portfolios} portfolio={pc.portfolio} period={pc.period} choose={pc.choose} />
      </div>
      {!pc.period ? <div className="card empty">This portfolio has no reporting date yet. <Link to={`/fin/portfolios?p=${pc.portfolio.id}`}>Add one and upload the holdings.</Link></div>
        : err ? <div className="card note bad">{err}</div>
        : !d || !S ? <div className="card empty">Calculating…</div> : (<>
          {d.warnings.map((w) => <div key={w} className="note warn small">{w}</div>)}
          <div className="kgrid4">
            <div className="card kpi"><span className="muted small">Financed emissions · Scope 1+2</span><b>{tco2(S.financed.total)} <small className="muted">tCO₂e</small></b>
              <span className="muted small">{d.portfolio.includeScope3 ? `Scope 3: ${tco2(S.financed.s3)} t (${S.financed.s3Holdings} holdings) · ` : ''}{dateLabel(d.period.asOf)}{d.locked ? ' · locked' : ''}</span></div>
            <div className="card kpi"><span className="muted small">Economic intensity</span><b>{tco2(S.intensity)} <small className="muted">t / {cur}m</small></b>
              <span className="muted small">per million outstanding · {money(S.outstanding, cur)} in {S.holdings} holdings</span></div>
            <div className="card kpi"><span className="muted small">Weighted average carbon intensity</span><b>{tco2(S.waci.value)} <small className="muted">t / {cur}m</small></b>
              <span className="muted small">per million of revenue, weighted by holding · covers {pct(S.waci.coverage, 0)} of outstanding</span></div>
            <div className="card kpi"><span className="muted small">Data quality score (1 best, 5 worst)</span><b>{S.score == null ? '—' : S.score.toFixed(2)}</b>
              <span className="muted small">{pct(S.coverage.reported, 0)} of outstanding on reported data · {pct(S.coverage.any, 0)} with a result</span></div>
          </div>

          <div className="ccgrid">
            <div className="card">
              <h3 style={{ margin: '0 0 8px' }}>Data quality across the portfolio</h3>
              <div className="fqbar" aria-label="Share of outstanding by PCAF score">
                {byScore.filter((x) => x.out > 0).map((x) => <i key={x.s} style={{ width: `${(x.out / S.outstanding) * 100}%`, background: SCORE_C[x.s] }} title={`Score ${x.s} · ${SCORE_SHORT[x.s]}: ${pct(x.out / S.outstanding)}`} />)}
                {none > 0 && <i style={{ width: `${(none / S.outstanding) * 100}%`, background: 'repeating-linear-gradient(45deg,#EEF2EF 0 4px,#DDE5E0 4px 8px)' }} title={`No result: ${pct(none / S.outstanding)}`} />}
              </div>
              <div className="lgd" style={{ marginTop: 8 }}>
                {byScore.map((x) => <span key={x.s}><i style={{ background: SCORE_C[x.s] }} />{x.s} · {SCORE_SHORT[x.s]} {pct(S.outstanding ? x.out / S.outstanding : 0, 0)}</span>)}
                {none > 0 && <span><i style={{ background: '#DDE5E0' }} />No result {pct(none / S.outstanding, 0)}</span>}
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>Share of outstanding by PCAF data quality score. Scores 1–3 use the company's own figures; 4–5 are sector estimates.</div>
            </div>
            <div className="card">
              <h3 style={{ margin: '0 0 8px' }}>By asset class</h3>
              <BarList rows={S.byAssetClass.map((b) => ({ key: b.key, label: ASSET_SHORT[b.key] ?? b.key, sub: `${b.holdings} holding${b.holdings === 1 ? '' : 's'} · ${money(b.outstanding, cur)}`, value: b.financed }))} format={tco2} unit="t" empty="No holdings." color="var(--s1)" />
            </div>
          </div>

          <div className="ccgrid">
            <div className="card">
              <h3 style={{ margin: '0 0 8px' }}>By sector</h3>
              <BarList rows={S.bySector.map((b) => ({ key: b.key, label: b.key, sub: `${b.holdings} holding${b.holdings === 1 ? '' : 's'} · ${money(b.outstanding, cur)}`, value: b.financed }))} format={tco2} unit="t" max={10} empty="No holdings." color="var(--s2)" />
            </div>
            <div className="card">
              <h3 style={{ margin: '0 0 4px' }}>Ask for data first</h3>
              <div className="muted small" style={{ marginBottom: 8 }}>{plan.length ? `These ${plan.length} counterparties are estimated from sector averages and carry ${pct(planShare, 0)} of financed emissions. Their reported figures would lift the data quality most.` : 'Every holding with a result uses reported or activity-based data.'}</div>
              {plan.length > 0 && <table className="t"><tbody>{plan.map((l) => (
                <tr key={l.id} className="click" onClick={() => nav(`/fin/counterparties/${l.counterpartyId}`)}>
                  <td><b>{l.name}</b><div className="muted small">{l.sector ?? 'No sector'}</div></td>
                  <td className="ctr"><ScoreChip score={l.result.score} forced={!!l.forceScore} /></td>
                  <td className="num">{tco2(l.result.financed!.total)} t</td>
                </tr>))}</tbody></table>}
            </div>
          </div>

          <div className="card flush">
            <div className="row vfilters"><h3 className="grow" style={{ margin: 0 }}>Largest financed emissions</h3><Link className="btn sm" to={`/fin/portfolios?p=${pc.portfolio.id}&d=${pc.period.id}`}>All holdings</Link></div>
            <div className="scrollx"><table className="t">
              <thead><tr><th>Counterparty</th><th>Sector</th><th className="num">Outstanding ({cur})</th><th className="ctr">Score</th><th className="num">Financed tCO₂e</th><th className="num">Share</th></tr></thead>
              <tbody>{S.top.map((x) => (
                <tr key={x.id}><td><b>{x.name}</b></td><td className="small">{x.sector ?? '—'}</td><td className="num">{money(x.outstanding)}</td>
                  <td className="ctr"><ScoreChip score={x.score} /></td><td className="num">{tco2(x.financed)}</td><td className="num">{pct(x.share)}</td></tr>))}
                {!S.top.length && <tr><td colSpan={6} className="empty">No results yet.</td></tr>}</tbody>
            </table></div>
          </div>
        </>)}
    </div>);
}
