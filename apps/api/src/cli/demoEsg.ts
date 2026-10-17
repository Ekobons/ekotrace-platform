/**
 * ESG demo (DEMO, not real): a double materiality assessment for the base year (waste management; GRI, IFRS S1/S2
 * and ADX), every topic scored with invented figures, stakeholders, a few ESG data points; the two suppliers that
 * answered the portal also answer its ESG impact section.
 */
import type { Tx } from '../db/pool.js';
import { financialScore, impactScore } from '../lib/esg.js';

export async function demoEsg(c: Tx, t: string) {
  const year = (await c.query(`SELECT base_year FROM tenant WHERE id = $1`, [t])).rows[0].base_year as number;
  const mg = (await c.query(`SELECT id, name FROM app_user WHERE tenant_id = $1 AND email = 'manager@beeah.demo'`, [t])).rows[0];
  const a = (await c.query(
    `INSERT INTO esg_assessment (tenant_id, year, industry, frameworks, value_chain, methodology, stakeholders, updated_by, updated_name)
     VALUES ($1,$2,'waste',ARRAY['gri','issb','adx'],$3,$4,$5,$6,$7) RETURNING id`,
    [t, year, 'DEMO — Upstream: fleet fuel, equipment, construction contractors, purchased services. Own operations: collection, transfer, recycling, composting, landfill, waste-to-energy. Downstream: recycled materials and compost buyers, electricity to the grid.',
      'DEMO — Long list from the ESRS topics, screened with the industry; impacts and risks scored 1–5 by a cross-functional workshop and checked against stakeholder input and the suppliers\' answers; threshold 3.0 on either side.',
      JSON.stringify([{ group: 'Employees and contractors', method: 'Survey and focus groups', when: `${year}-05`, people: '420' }, { group: 'Municipal clients', method: 'Interviews', when: `${year}-06`, people: '8' },
        { group: 'Communities near landfill sites', method: 'Community meetings', when: `${year}-06`, people: '60' }, { group: 'Suppliers', method: 'Supplier portal ESG section', when: `${year}-07`, people: '2' }, { group: 'Investors and lenders', method: 'Interviews', when: `${year}-07`, people: '4' }]),
      mg.id, mg.name])).rows[0].id as string;
  const S: [string, object, object, string][] = [
    ['E1', { type: 'actual', nature: 'negative', scale: 4, scope: 4, irremediability: 4, where: ['own', 'upstream'], description: 'Landfill methane and fleet diesel are the main sources (DEMO).' }, { kind: 'risk', magnitude: 4, likelihood: 4, horizon: 'medium', description: 'Carbon pricing, client net-zero requirements, heat stress on outdoor work (DEMO).' }, ''],
    ['E2', { type: 'potential', nature: 'negative', scale: 4, scope: 3, irremediability: 3, likelihood: 3, where: ['own'], description: 'Leachate, odour and emissions from treatment sites (DEMO).' }, { kind: 'risk', magnitude: 3, likelihood: 3, horizon: 'short', description: 'Permit conditions and fines (DEMO).' }, ''],
    ['E3', { type: 'actual', nature: 'negative', scale: 3, scope: 2, irremediability: 3, where: ['own'], description: 'Water used for dust suppression and washing in a water-stressed region (DEMO).' }, { kind: 'risk', magnitude: 2, likelihood: 3, horizon: 'long', description: 'Desalinated water costs (DEMO).' }, ''],
    ['E4', { type: 'potential', nature: 'negative', scale: 2, scope: 2, irremediability: 3, likelihood: 2, where: ['own'], description: 'Land use of landfill sites (DEMO).' }, { kind: 'risk', magnitude: 1, likelihood: 2, horizon: 'long', description: '' }, ''],
    ['E5', { type: 'actual', nature: 'positive', scale: 5, scope: 4, where: ['own', 'downstream'], description: 'Diversion from landfill, recycling and compost (DEMO).' }, { kind: 'opportunity', magnitude: 5, likelihood: 4, horizon: 'medium', description: 'Circular-economy services and recycled materials revenue (DEMO).' }, ''],
    ['S1', { type: 'actual', nature: 'negative', scale: 4, scope: 3, irremediability: 4, where: ['own'], description: 'Injury risk in collection and plant operations (DEMO).' }, { kind: 'risk', magnitude: 3, likelihood: 3, horizon: 'short', description: 'Lost time and contract penalties (DEMO).' }, ''],
    ['S2', { type: 'potential', nature: 'negative', scale: 4, scope: 3, irremediability: 4, likelihood: 3, humanRights: true, where: ['upstream'], description: 'Contractor workers: recruitment fees, accommodation, heat (DEMO).' }, { kind: 'risk', magnitude: 2, likelihood: 2, horizon: 'medium', description: '' }, ''],
    ['S3', { type: 'actual', nature: 'negative', scale: 3, scope: 2, irremediability: 2, where: ['own'], description: 'Odour and traffic near communities (DEMO).' }, { kind: 'risk', magnitude: 2, likelihood: 3, horizon: 'medium', description: 'Licence to operate (DEMO).' }, ''],
    ['S4', { type: 'potential', nature: 'negative', scale: 2, scope: 2, irremediability: 2, likelihood: 2, where: ['downstream'], description: 'Service reliability for municipal clients (DEMO).' }, { kind: 'risk', magnitude: 2, likelihood: 2, horizon: 'short', description: '' }, ''],
    ['G1', { type: 'potential', nature: 'negative', scale: 3, scope: 3, irremediability: 2, likelihood: 2, where: ['own'], description: 'Public contracts: corruption risk (DEMO).' }, { kind: 'risk', magnitude: 4, likelihood: 2, horizon: 'medium', description: 'Contract loss and fines (DEMO).' }, ''],
  ];
  for (const [topic, i, f, r] of S)
    await c.query(`INSERT INTO esg_topic (tenant_id, assessment_id, topic, impact, financial, impact_score, financial_score, rationale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t, a, topic, JSON.stringify(i), JSON.stringify(f), impactScore(i), financialScore(f), r]);
  for (const [code, v, note] of [['E1.5', '412000', 'DEMO'], ['E1.6', '6', 'DEMO — solar at two sites'], ['E3.1', '880000', 'DEMO'], ['E5.1', '14200', 'DEMO'], ['E5.2', '38', 'DEMO'],
    ['S1.1', '5200', 'DEMO'], ['S1.2', '14', 'DEMO'], ['S1.5', '0.9', 'DEMO'], ['S1.6', '0', 'DEMO'], ['S1.9', '9', 'DEMO'], ['WM.1', '3100000', 'DEMO'], ['WM.2', '44', 'DEMO'], ['G1.1', 'yes', 'DEMO']] as [string, string, string][])
    await c.query(`INSERT INTO esg_answer (tenant_id, year, code, value, num, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,'demo')`, [t, year, code, v, /^\d/.test(v) ? Number(v) : null, note]);
  // the suppliers that answered the portal also give their ESG impact view
  const reqs = (await c.query(`SELECT id FROM supplier_request WHERE tenant_id = $1 AND status IN ('submitted', 'accepted') ORDER BY created_at`, [t])).rows;
  const views = [
    { industry: 'materials', topics: [['E1', 5, 4], ['E2', 4, 3], ['E3', 3, 2], ['E5', 3, 3], ['S1', 4, 3], ['S2', 3, 2], ['G1', 2, 2]], facts: { iso14001: true, iso45001: true, codeOfConduct: true, humanRights: false, antiCorruption: true, whistleblowing: true, womenPct: 6, ltifr: 1.4, fatalities: 0, renewablePct: 3 } },
    { industry: 'materials', topics: [['E1', 5, 5], ['E2', 3, 3], ['E3', 2, 2], ['E5', 4, 3], ['S1', 3, 3], ['S2', 4, 2], ['G1', 2, 2]], facts: { iso14001: true, iso45001: false, codeOfConduct: true, humanRights: true, antiCorruption: true, whistleblowing: false, womenPct: 9, ltifr: 2.1, fatalities: 0, renewablePct: 0 } },
  ];
  for (const [i, r] of reqs.slice(0, 2).entries()) {
    const v = views[i]!;
    const esg = { industry: v.industry, topics: v.topics.map(([topic, impact, financial]) => ({ topic, impact, financial, note: 'DEMO' })), facts: { ...v.facts, report: 'DEMO — invented answers' } };
    await c.query(`UPDATE supplier_request SET answers = jsonb_set(answers, '{esg}', $2::jsonb) WHERE id = $1`, [r.id, JSON.stringify(esg)]);
  }
  console.log(`ESG: DEMO double materiality assessment for ${year} (waste management; GRI, IFRS S1/S2, ADX), ${S.length} topics scored, 13 ESG data points, 2 suppliers' ESG impact answers.`);
}
