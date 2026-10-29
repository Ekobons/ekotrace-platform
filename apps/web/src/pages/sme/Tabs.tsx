/**
 * The section bar at the top of every SME page: the section (colour, icon, name) and its pages as tabs.
 * Pages that do not apply to this company (from its Profile) are tucked behind "More".
 */
import { useState, type CSSProperties } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { SME_PAGES, groupOf, relevant } from './nav';

export function SmeTabs() {
  const { d } = useSme();
  const key = useLocation().pathname.split('/')[2] ?? 'home';
  const g = groupOf(key);
  const [more, setMore] = useState(false);
  if (g.key === 'home') return null;
  const shown = g.pages.filter((k) => k === key || more || relevant(k, d?.data, d?.results));
  const hidden = g.pages.length - g.pages.filter((k) => relevant(k, d?.data, d?.results)).length;
  return (
    <nav className="sme-tabs" aria-label={g.title} style={{ '--gc': g.color, '--gs': g.soft } as CSSProperties}>
      <div className="sme-tabs-h"><span className="sme-tabs-i"><Icon name={g.icon} /></span><div><b>{g.title}</b><small>{g.sub}</small></div></div>
      <div className="sme-tabs-l" role="list">
        {shown.map((k) => (
          <NavLink key={k} to={`/sme/${k}`} role="listitem" className={({ isActive }) => `sme-tab${isActive ? ' on' : ''}${relevant(k, d?.data, d?.results) ? '' : ' na'}`}>
            <Icon name={SME_PAGES[k]!.icon} /><span>{SME_PAGES[k]!.title}</span>
          </NavLink>))}
        {hidden > 0 && <button type="button" className="sme-tab more" onClick={() => setMore(!more)} title="Pages your Profile says do not apply to you">{more ? 'Show less' : `+${hidden} not for you`}</button>}
      </div>
    </nav>);
}
