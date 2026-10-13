/**
 * Data progress (as in the prototype): each facility × month of the year. A month is approved when
 * every category the facility reports is approved; in review when everything is in and some of it
 * waits for approval; partial when some categories are missing, drafts or sent back; missing when
 * nothing is in. Click a month to open Add data for that facility and month.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type HomeData } from '../lib/api';
import { MN } from '../components/DashCharts';
import { ViewBar, useView } from '../components/ViewBar';
import { useApp } from '../App';

type St = 'approved' | 'review' | 'partial' | 'missing' | 'future' | 'none';
const MSTYLE: Record<St, [string, string]> = { approved: ['Approved', 'c-ok'], review: ['In review', 'c-warn'], partial: ['Partial', 'c-info'], missing: ['Missing', 'c-bad'], future: ['Future', 'c-n'], none: ['Not reported', 'c-n'] };
const CST: Record<string, string> = { approved: 'approved', submitted: 'waiting for approval', draft: 'draft', returned: 'sent back', missing: 'missing' };
const CAT_ROUTE: Record<string, string> = { waste: 'waste_generated', water: 'water_supply' };

export function DataProgress() {
  const v = useView();
  const { d } = v;
  const { role } = useApp();
  const nav = useNavigate();
  const [h, setH] = useState<HomeData | null>(null);
  useEffect(() => { if (d) api.home({ year: d.year, node: v.group ? undefined : v.node || undefined, group: v.group || undefined }).then(setH).catch(() => setH(null)); }, [d?.year, v.node, v.group]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = new Date(), y = d?.year ?? now.getFullYear();
  const open = y < now.getFullYear() ? 12 : y > now.getFullYear() ? 0 : now.getMonth();     // months that can be due
  const catName = (c: string) => (c === 'waste' ? 'Waste' : c === 'water' ? 'Water' : d?.categories.find((k) => k.code === c)?.name ?? c);
  const catSt = (f: string, c: string, m: number) => {
    const x = h?.cells.find((z) => z.f === f && z.cat === c && z.m === m);
    if (!x) return 'missing';
    return x.rejected ? 'returned' : x.draft && !x.submitted && !x.approved ? 'draft' : x.submitted || x.draft ? 'submitted' : 'approved';
  };
  const monthSt = (f: HomeData['facilities'][number], m: number): St => {
    if (m > open) return 'future';
    if (!f.usual.length) return 'none';
    const s = f.usual.map((c) => catSt(f.id, c, m));
    if (s.every((x) => x === 'approved')) return 'approved';
    if (s.every((x) => x === 'missing')) return 'missing';
    if (s.every((x) => x === 'approved' || x === 'submitted')) return 'review';
    return 'partial';
  };
  const canEnter = role !== 'verifier';
  const go = (f: HomeData['facilities'][number], m: number) => {
    const first = f.usual.find((c) => catSt(f.id, c, m) !== 'approved') ?? f.usual[0] ?? 'stationary_combustion';
    nav(`/data/${CAT_ROUTE[first] ?? first}?facility=${f.id}&year=${y}&month=${m}`);
  };
  const tot = h ? h.facilities.reduce((a, f) => { for (let m = 1; m <= open; m++) a[monthSt(f, m)]++; return a; }, { approved: 0, review: 0, partial: 0, missing: 0, future: 0, none: 0 } as Record<St, number>) : null;
  return (
    <div className="page">
      <ViewBar v={v} />
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>Data progress · {y}</h1><div className="muted">A month is approved when every category the facility reports is approved. Click a month to add its data.</div></div>
        <span className="grow" />
        {tot && open > 0 && <div className="row" style={{ gap: 6 }}>{(['approved', 'review', 'partial', 'missing'] as St[]).map((k) => <span key={k} className={`chip ${MSTYLE[k][1]}`}>{tot[k]} {MSTYLE[k][0].toLowerCase()}</span>)}</div>}
      </div>
      <section className="card tacard">
        {!h ? <div className="empty">Loading…</div> : (
          <div className="scrollx"><table className="t progt">
            <thead><tr><th>Facility</th>{MN.map((m) => <th key={m} style={{ textAlign: 'center' }}>{m}</th>)}<th className="num">Approved</th></tr></thead>
            <tbody>{h.facilities.map((f) => {
              const appr = Array.from({ length: open }, (_, i) => monthSt(f, i + 1)).filter((s) => s === 'approved').length;
              return (
                <tr key={f.id}>
                  <td style={{ minWidth: 220 }}><b>{f.name}</b><div className="muted small">{f.type ?? 'Facility'}{f.manager ? ` · ${f.manager}` : ''}</div></td>
                  {MN.map((mn, i) => {
                    const m = i + 1, st = monthSt(f, m), live = st !== 'future' && st !== 'none' && canEnter;
                    const tip = `${f.name} · ${mn} ${y} · ${MSTYLE[st][0]}${st !== 'future' && f.usual.length ? '\n' + f.usual.map((c) => `${catName(c)}: ${CST[catSt(f.id, c, m)]}`).join('\n') : ''}`;
                    return <td key={mn} style={{ padding: 4 }}><button className={`pbtn ${st}`} disabled={!live} title={tip} onClick={() => go(f, m)}><small className={MSTYLE[st][1]}>{MSTYLE[st][0]}</small></button></td>;
                  })}
                  <td className="num"><b>{appr}/{open}</b></td>
                </tr>);
            })}
            {!h.facilities.length && <tr><td colSpan={14} className="muted">No facilities in this view.</td></tr>}</tbody>
          </table></div>)}
        <div className="row" style={{ gap: 8 }}>{(Object.keys(MSTYLE) as St[]).map((k) => <span key={k} className={`chip ${MSTYLE[k][1]}`}>{MSTYLE[k][0]}</span>)}
          <span className="muted small">The categories a facility reports are the ones with data this year or last. Hover a month to see each category.</span></div>
      </section>
    </div>);
}
