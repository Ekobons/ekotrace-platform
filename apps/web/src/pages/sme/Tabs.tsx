/**
 * The section bar at the top of every SME page: the section (colour, icon, name) and its pages as tabs.
 * Pages that do not apply to this company (from its Profile) are tucked behind "More".
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { SME_PAGES, groupOf, relevant } from './nav';
import { t } from './i18n';

export function SmeTabs() {
  const { d } = useSme();
  const key = useLocation().pathname.split('/')[2] ?? 'home';
  const g = groupOf(key);
  const [more, setMore] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // on a phone the tabs scroll sideways: bring the open page's tab into view
  useEffect(() => { const el = list.current?.querySelector('.sme-tab.on') as HTMLElement | null; const l = list.current; if (el && l) l.scrollLeft = el.offsetLeft - (l.clientWidth - el.offsetWidth) / 2; }, [key]);
  if (g.key === 'home') return null;
  const shown = g.pages.filter((k) => k === key || more || relevant(k, d?.data, d?.results));
  const hidden = g.pages.length - g.pages.filter((k) => relevant(k, d?.data, d?.results)).length;
  return (
    <nav className="sme-tabs" aria-label={t(g.title)} style={{ '--gc': g.color, '--gs': g.soft } as CSSProperties}>
      <div className="sme-tabs-h"><span className="sme-tabs-i"><Icon name={g.icon} /></span><div><b>{t(g.title)}</b><small>{t(g.sub)}</small></div></div>
      <div className="sme-tabs-l" role="list" ref={list}>
        {shown.map((k) => (
          <NavLink key={k} to={`/sme/${k}`} role="listitem" className={({ isActive }) => `sme-tab${isActive ? ' on' : ''}${relevant(k, d?.data, d?.results) ? '' : ' na'}`}>
            <Icon name={SME_PAGES[k]!.icon} /><span>{t(SME_PAGES[k]!.title)}</span>
          </NavLink>))}
        {hidden > 0 && <button type="button" className="sme-tab more" onClick={() => setMore(!more)} title={t('Pages your Profile says do not apply to you')}>{more ? t('Show less') : t('+{n} not for you', { n: hidden })}</button>}
      </div>
    </nav>);
}
