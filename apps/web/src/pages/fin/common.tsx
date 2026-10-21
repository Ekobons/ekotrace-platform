/**
 * EKOFIN shared pieces: the score chip, the portfolio + reporting date picker (kept in the address
 * and remembered on this browser), and a drawer shell.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { fin, SCORE_C, SCORE_SHORT, type FinPortfolio, type Score } from '../../lib/ekofin';

export function ScoreChip({ score, forced }: { score: Score | null; forced?: boolean }) {
  if (!score) return <span className="chip grey" title="No result: not enough data">—</span>;
  return (
    <span className="fscore" style={{ background: SCORE_C[score] }} title={`PCAF score ${score}: ${SCORE_SHORT[score]}${forced ? ' (chosen by a user)' : ''}`}>
      {score}{forced ? '*' : ''}
    </span>
  );
}

/** Portfolio and reporting date chosen on the page (?p=&d=), remembered on this browser. */
export function usePeriodChoice() {
  const [sp, setSp] = useSearchParams();
  const [portfolios, setPortfolios] = useState<FinPortfolio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { fin.portfolios().then((r) => setPortfolios(r.portfolios)).catch((e) => setError((e as Error).message)); }, [tick]);
  const remembered = (() => { try { return JSON.parse(localStorage.getItem('eko_fin_choice') ?? '{}') as { p?: string; d?: string }; } catch { return {}; } })();
  const live = (portfolios ?? []).filter((p) => !p.archived);
  const pId = sp.get('p') ?? remembered.p;
  const portfolio = live.find((p) => p.id === pId) ?? (portfolios ?? []).find((p) => p.id === pId) ?? live[0] ?? null;
  const dId = sp.get('d') ?? (portfolio?.id === remembered.p ? remembered.d : undefined);
  const period = portfolio?.periods.find((x) => x.id === dId) ?? portfolio?.periods[0] ?? null;
  const choose = (p: string | null, d: string | null) => {
    const n = new URLSearchParams(sp);
    if (p) n.set('p', p); else n.delete('p');
    if (d) n.set('d', d); else n.delete('d');
    setSp(n, { replace: true });
    try { localStorage.setItem('eko_fin_choice', JSON.stringify({ p, d })); } catch { /* not kept */ }
  };
  return { portfolios, portfolio, period, choose, reload: () => setTick((t) => t + 1), error };
}

export function PeriodPicker({ portfolios, portfolio, period, choose }: Pick<ReturnType<typeof usePeriodChoice>, 'portfolio' | 'period' | 'choose'> & { portfolios: FinPortfolio[] }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <label className="field" style={{ minWidth: 220 }}><span>Portfolio</span>
        <select className="input" value={portfolio?.id ?? ''} onChange={(e) => choose(e.target.value, null)}>
          {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
        </select></label>
      <label className="field" style={{ minWidth: 150 }}><span>Reporting date</span>
        <select className="input" value={period?.id ?? ''} onChange={(e) => choose(portfolio?.id ?? null, e.target.value)} disabled={!portfolio?.periods.length}>
          {!portfolio?.periods.length && <option value="">No dates yet</option>}
          {portfolio?.periods.map((d) => <option key={d.id} value={d.id}>{dateLabel(d.as_of)}{d.status === 'locked' ? ' · locked' : ''}</option>)}
        </select></label>
    </div>
  );
}

export const dateLabel = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');

/** A side drawer that opens on mount and calls onClose when it closes. */
export function Drawer({ eyebrow, title, wide, onClose, children, foot }: { eyebrow?: string; title: string; wide?: boolean; onClose: () => void; children: ReactNode; foot?: (close: () => void) => ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const close = () => dlg.current?.close();
  return (
    <dialog ref={dlg} className={`drawer${wide ? ' wide' : ''}`} onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow">{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
          <button className="btn ghost" onClick={close} aria-label="Close"><Icon name="x" /></button></div>
        {children}
        {foot && <div className="row">{foot(close)}</div>}
      </div>
    </dialog>
  );
}

export const ASSET_SHORT: Record<string, string> = { listed_equity: 'Listed equity', corporate_bond: 'Corporate bond', business_loan: 'Business loan', unlisted_equity: 'Unlisted equity' };
