/** Product footprint: per-product emissions for buyer requests and export documents. Site emissions are shared out by production share. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Num, Sample, SmeHead, Text } from './ui';
import { f1, f2, n } from '../../lib/sme';
import './carbon.css';

interface Product { name?: string; share?: number | ''; steelPerT?: number | ''; zincKgPerT?: number | ''; packKgPerT?: number | ''; outTkm?: number | ''; pieceG?: number | '' }
interface Res { name: string; rows: [string, number][]; perTonne: number; perKg: number; per1000Pieces: number }

export function SmeFootprint() {
  const { d, get, setModule, error } = useSme();
  const [sel, setSel] = useState(0);
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading your data…</div>;
  const fp = (get('footprint') ?? {}) as { products?: Product[] };
  const products = fp.products ?? [];
  const res = (d.results.footprint ?? []) as Res[];
  const i = Math.min(sel, Math.max(0, products.length - 1));
  const r = res[i];
  const shareSum = products.reduce((a, p) => a + n(p.share), 0);
  const production = n(get('profile.production')), site = n(d.results.emissions?.total);
  const can = d.canEdit;
  const add = () => {
    const list = [...products, { name: `Product ${products.length + 1}`, share: '', steelPerT: '', zincKgPerT: '', packKgPerT: '', outTkm: '', pieceG: '' } as Product];
    setModule('footprint', { ...fp, products: list });
    setSel(list.length - 1);
  };
  const remove = () => {
    if (!window.confirm(`Remove “${products[i]?.name || `Product ${i + 1}`}”?`)) return;
    setModule('footprint', { ...fp, products: products.filter((_, j) => j !== i) });
    setSel(Math.max(0, i - 1));
  };
  const p = (k: string) => `footprint.products.${i}.${k}`;
  const max = Math.max(...(r?.rows ?? []).map((x) => x[1]), 0) || 1;
  return (
    <div className="cb-stack">
      <SmeHead lede="Per-product figures for buyer requests and export documents. Your site’s emissions are shared out by each product’s share of production." />

      {d.company.sector === 'svc' && <div className="sme-callout">Product footprints are built for manufactured goods. As a service company you can skip this page.</div>}

      <div className="cb-tabs" role="group" aria-label="Products">
        {products.map((x, j) => <button key={j} type="button" className={`btn sm${j === i ? ' on' : ''}`} aria-pressed={j === i} onClick={() => setSel(j)}>{x.name || `Product ${j + 1}`}</button>)}
        {can && <button type="button" className="btn sm ghost" onClick={add}>+ Add product</button>}
      </div>

      {!products.length && (
        <div className="card empty">
          <p style={{ margin: '0 0 12px' }}>No products yet. Add one to work out its footprint per tonne, per kg and per 1,000 pieces.</p>
          {can ? <button type="button" className="btn p" onClick={add}>Add a product</button> : <p className="small">Ask someone who can edit to add your products.</p>}
        </div>)}

      {products.length > 0 && (
        <>
          {(production <= 0 || site <= 0) && (
            <div className="sme-callout warn">
              {production <= 0 && <>Add your annual production in <Link to="/sme/profile">Profile</Link> so site emissions can be shared out per tonne. </>}
              {site <= 0 && <>Add your power and fuel bills in <Link to="/sme/emissions">Emissions</Link>; until then the site share is zero.</>}
            </div>)}
          {shareSum > 0 && Math.abs(shareSum - 100) > 0.5 && <div className="sme-callout warn">Production shares add up to {f1(shareSum)}%. They should add up to 100% across all products.</div>}

          <Kpis>
            <Kpi label="Per tonne" value={<>{f2(r?.perTonne)}{d.company.isExample && <Sample />}</>} unit="tCO₂e per tonne" />
            <Kpi label="Per kg" value={f2(r?.perKg)} unit="kgCO₂e per kg" />
            <Kpi label="Per 1,000 pieces" value={n(products[i]?.pieceG) > 0 ? f1(r?.per1000Pieces) : '—'} unit={n(products[i]?.pieceG) > 0 ? 'kgCO₂e' : 'Add the weight per piece'} />
          </Kpis>

          <div className="sme-grid2">
            <div className="card" key={i}>
              <div className="cb-h"><h2>Inputs</h2>{can && <button type="button" className="btn sm ghost danger" onClick={remove}>Remove product</button>}</div>
              <Text path={p('name')} label="Product name" />
              <Num path={p('share')} label="Share of site production" hint="By weight, across all products" unit="%" />
              <Num path={p('steelPerT')} label="Steel used per tonne of product" hint="Including scrap loss, e.g. 1.05" unit="t" />
              <Num path={p('zincKgPerT')} label="Zinc for plating per tonne" unit="kg" />
              <Num path={p('packKgPerT')} label="Plastic packaging per tonne" unit="kg" />
              <Num path={p('outTkm')} label="Road transport to customer, per tonne" hint="Distance in km (1 tonne × km)" unit="t·km" />
              <Num path={p('pieceG')} label="Weight per piece" hint="For the per-1,000-pieces figure" unit="g" />
            </div>
            <div className="card">
              <h2>Breakdown per tonne</h2>
              <table className="sme-tbl cb-brk" style={{ marginTop: 8 }}><tbody>
                {(r?.rows ?? []).map(([l, v]) => <tr key={l}><td>{l}<div className="cb-mini"><b style={{ width: `${(v / max) * 100}%` }} /></div></td><td className="r">{f2(v)} t</td></tr>)}
                <tr className="tot"><td>Total per tonne</td><td className="r">{f2(r?.perTonne)} t</td></tr>
              </tbody></table>
              <p className="cb-muted-note">Cradle to customer, simplified. A full product carbon footprint to ISO 14067 needs verified supplier data.</p>
            </div>
          </div>

          {products.length > 1 && (
            <div className="card"><h2>All products</h2>
              <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8 }}>
                <thead><tr><th>Product</th><th className="r">Share</th><th className="r">tCO₂e / t</th><th className="r">kgCO₂e / 1,000 pcs</th></tr></thead>
                <tbody>{products.map((x, j) => (
                  <tr key={j} className={j === i ? 'me' : ''}><td><button type="button" className="btn xs ghost" style={{ padding: 0 }} onClick={() => setSel(j)}>{x.name || `Product ${j + 1}`}</button></td>
                    <td className="r">{f1(x.share)}%</td><td className="r">{f2(res[j]?.perTonne)}</td><td className="r">{n(x.pieceG) > 0 ? f1(res[j]?.per1000Pieces) : '—'}</td></tr>))}
                </tbody></table></div>
            </div>)}
        </>)}
    </div>);
}
