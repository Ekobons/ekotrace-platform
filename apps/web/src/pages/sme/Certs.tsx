/** Certifications: what the company holds and when each expires. Renewals appear in the calendar. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead } from './ui';
import { dmy } from '../../lib/sme';
import { Evidence, ProofCount, useProofCounts } from './Evidence';
import './carbon.css';
import { t, tn } from './i18n';

interface Cert { id: string; name: string; level?: string; expiry?: string }

const OPTS: Record<string, [string, string][]> = {
  zed: [['none', 'Not held'], ['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold']],
  ecovadis: [['none', 'Not held'], ['committed', 'Committed'], ['bronze', 'Bronze'], ['silver', 'Silver'], ['gold', 'Gold'], ['platinum', 'Platinum']],
};
const DEFAULT: [string, string][] = [['none', 'Not held'], ['inprogress', 'In progress'], ['held', 'Held']];
const WHY: Record<string, string> = {
  zed: 'Government support on cost; helps PSU and large-buyer vendor ratings',
  iso14001: t('Counts in your ESG score and SRMM'),
  iso45001: t('Shows a working safety system'),
  iso50001: t('Supports energy-efficiency loans'),
  iso27001: t('Asked for by IT and data-heavy buyers'),
};
const pending = (l?: string) => !l || ['none', 'inprogress', 'committed'].includes(l);

/** Days from today to an ISO date (negative when past). */
const daysTo = (s: string) => Math.round((new Date(`${s}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);

function status(c: Cert): [string, string] {
  if (!c.level || c.level === 'none') return ['watch', 'Not held'];
  if (pending(c.level)) return ['soon', c.level === 'committed' ? t('Committed') : t('In progress')];
  if (!c.expiry) return ['soon', 'Add expiry date'];
  const n = daysTo(c.expiry);
  if (n < 0) return ['overdue', 'Expired'];
  if (n <= 90) return ['soon', `Renew in ${n} day${n === 1 ? '' : 's'}`];
  return ['good', 'Valid'];
}

export function SmeCerts() {
  const { d, get, set, setModule, error } = useSme();
  const [newName, setNewName] = useState('');
  const proofs = useProofCounts('certs');
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">{t('Loading your data…')}</div>;
  const certs = ((get('certs') ?? []) as Cert[]);
  const can = d.canEdit;
  const held = certs.filter((c) => !pending(c.level)).length;
  const progress = certs.filter((c) => c.level === 'inprogress' || c.level === 'committed').length;
  const renew = certs.filter((c) => !pending(c.level) && c.expiry && daysTo(c.expiry) <= 90).length;
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    setModule('certs', [...certs, { id: `custom-${Date.now().toString(36)}`, name, level: 'none', expiry: '' }]);
    setNewName('');
  };
  const removable = (c: Cert) => c.id.startsWith('custom-');
  const listed = certs.filter((c) => c.level && c.level !== 'none');
  const withProof = listed.filter((c) => (proofs?.[c.id] ?? 0) > 0).length;
  return (
    <div className="cb-stack">
      <SmeHead lede={t('Track what you hold and when it expires. Renewal dates appear in your calendar.')} />
      <Kpis>
        <Kpi label={t('Held')} value={held} unit={`of ${certs.length} listed`} good={held > 0} />
        <Kpi label={t('In progress')} value={progress} unit={t('being worked on')} />
        <Kpi label={t('Renew soon')} value={renew} unit={t('expired or within 90 days')} />
      </Kpis>

      <div className="card">
        <div className="sme-ev-head"><h2>{t('Your certifications')}</h2>{listed.length > 0 && proofs && <ProofCount have={withProof} of={listed.length} what={listed.length === 1 ? t('has a copy of the certificate attached') : t('have a copy of the certificate attached')} />}</div>
        <div className="sme-scroll"><table className="sme-tbl cb-certs">
          <thead><tr><th>{t('Certification')}</th><th>{t('Status')}</th><th>{t('Valid until')}</th><th /></tr></thead>
          <tbody>
            {certs.map((c, i) => {
              const [kind, label] = status(c), opts = OPTS[c.id] ?? DEFAULT;
              return (
                <tr key={c.id}>
                  <td><b style={{ fontWeight: 600 }}>{c.name}</b>{WHY[c.id] && <><br /><span className="muted" style={{ fontSize: 12 }}>{WHY[c.id]}</span></>}
                    {c.level && c.level !== 'none' && <div className="sme-ev-row"><Evidence module="certs" item={c.id} label={pending(c.level) ? t('Papers') : t('Certificate')} /></div>}</td>
                  <td>{can
                    ? <select className="input" aria-label={`${c.name} status`} value={c.level || 'none'} onChange={(e) => set(`certs.${i}.level`, e.target.value)}>
                        {opts.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                        {c.level && !opts.some(([v]) => v === c.level) && <option value={c.level}>{c.level}</option>}
                      </select>
                    : (opts.find(([v]) => v === (c.level || 'none'))?.[1] ?? c.level)}</td>
                  <td>{can
                    ? <input className="input" type="date" aria-label={`${c.name} valid until`} disabled={!c.level || c.level === 'none'} value={c.expiry || ''} onChange={(e) => set(`certs.${i}.expiry`, e.target.value)} />
                    : dmy(c.expiry)}</td>
                  <td className="r"><Pill kind={kind}>{label}</Pill>
                    {can && removable(c) && <><br /><button type="button" className="btn xs ghost danger" onClick={() => setModule('certs', certs.filter((_, j) => j !== i))}>{t('Remove')}</button></>}</td>
                </tr>);
            })}
            {!certs.length && <tr><td colSpan={4} className="muted">{t('No certifications listed.')}</td></tr>}
          </tbody>
        </table></div>
        {can && (
          <div className="cb-actions">
            <input className="input" style={{ flex: '1 1 220px' }} placeholder={t('Another certification, e.g. SA8000 or FSC')} aria-label={t('Certification name')} value={newName} maxLength={80}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button type="button" className="btn" disabled={!newName.trim()} onClick={add}>{t('Add')}</button>
          </div>)}
      </div>

      <div className="sme-callout">{tn('MSME ZED certification comes with government support on certification cost, and a higher ZED level helps in PSU and large-buyer vendor ratings. See {a}. Expiry dates show up in the {b}.', { a: <Link to="/sme/schemes">{t('Schemes')}</Link>, b: <Link to="/sme/calendar">{t('Calendar')}</Link> })}</div>
    </div>);
}
