/**
 * ⓘ next to a part of an emission (Scope 1, Scope 2 location / market, T&D, upstream, biogenic, memo…): opens the
 * paragraph of the user manual that explains it (Factors & methodology → Parts of an emission).
 */
import { Link } from 'react-router-dom';
import type { Basis } from '../lib/api';
import { manualSlug } from '../lib/manualSlug';

const HEAD: Record<Basis | 'parts' | 'wtt_td' | 'gases', string> = {
  parts: 'Parts of an emission', direct: 'Scope 1 — direct emissions', scope2: 'Scope 2 — location-based', scope2_market: 'Scope 2 — market-based',
  td_loss: 'T&D losses (Scope 3.3)', wtt: 'Upstream / well-to-tank (Scope 3.3)', wtt_td: 'WTT of T&D losses', scope3: 'Scope 3 — other categories',
  outside_scopes: 'Biogenic CO₂ (outside the scopes)', memo: 'Memo: non-Kyoto gases (ozone-depleting refrigerants)', gases: 'Gases and GWP',
};
// headings are slugged from the rendered HTML, where & is &amp;
export const partHref = (part: keyof typeof HEAD) => `/help?c=${manualSlug('Factors & methodology')}&s=${manualSlug(HEAD[part].replace(/&/g, '&amp;'))}`;

export function PartInfo({ part, label }: { part: keyof typeof HEAD; label?: string }) {
  return <Link className="partinfo" to={partHref(part)} title={`What is ${label ?? HEAD[part]}? — user manual`} aria-label={`What is ${label ?? HEAD[part]}? Open the user manual`}
    onClick={(e) => e.stopPropagation()}>ⓘ</Link>;
}
