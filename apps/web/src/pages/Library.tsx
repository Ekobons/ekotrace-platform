/**
 * Factor library (platform admin): five tabs.
 *   Factors      per item: every year, unit and part, with the gas split; add a corrected version
 *   Catalogue    add / rename / move / switch off subcategories and items; per-company visibility
 *   Units        the conversion matrix (one size per unit) and new units
 *   Gases & GWP  68 gases with AR4 / AR5 / AR6 values
 *   Sources      factor sources, DESNZ upload with preview, import review
 */
import { useState } from 'react';
import { FactorsTab } from './library/FactorsTab';
import { CatalogueTab } from './library/CatalogueTab';
import { UnitsTab } from './library/UnitsTab';
import { GasesTab } from './library/GasesTab';
import { SourcesTab } from './library/SourcesTab';

const TABS = [
  ['factors', 'Factors'], ['catalogue', 'Categories & items'], ['units', 'Units & conversions'], ['gases', 'Gases & GWP'], ['sources', 'Sources & import'],
] as const;
type Tab = (typeof TABS)[number][0];

export function Library() {
  const [tab, setTab] = useState<Tab>('factors');
  return (
    <div className="page">
      <div className="head">
        <div>
          <div className="eyebrow">Setup · Platform admin</div>
          <h1>Factor library</h1>
          <p className="sub">Shared by every company. Factors are stored per unit and per gas; corrections are saved as new versions, old ones are kept.</p>
        </div>
      </div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'factors' && <FactorsTab />}
      {tab === 'catalogue' && <CatalogueTab />}
      {tab === 'units' && <UnitsTab />}
      {tab === 'gases' && <GasesTab />}
      {tab === 'sources' && <SourcesTab />}
    </div>
  );
}
