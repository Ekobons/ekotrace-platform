/**
 * Supply chain factor files (no database): versions in order (release candidates just below the
 * release), the .xlsx as published read like the CSV, and the same factors recognised in either form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseEpa, parseEpaXlsx, versionRank } from '../src/import/epa.js';

const HEAD = ['2017 NAICS Code', '2017 NAICS Title', 'GHG', 'Unit', 'Supply Chain Emission Factors without Margins', 'Margins of Supply Chain Emission Factors', 'Supply Chain Emission Factors with Margins', 'Reference USEEIO Code'];
const ROWS: (string | number)[][] = [
  [111110, 'Soybean Farming', 'All GHGs', 'kg CO2e/2024 USD, purchaser price', 0.55, 0.05, 0.6, '1111A0'],
  [322230, 'Stationery Product Manufacturing', 'All GHGs', 'kg CO2e/2024 USD, purchaser price', 0.3, 0.1, 0.4, '322230'],
];

test('versions: 1.2 < 1.3 < 1.4.0-rc.1 < 1.4.0-rc.2 < 1.4.0 < 1.4.1', () => {
  const order = ['1.2', '1.3.0', '1.4.0-rc.1', '1.4.0-rc.2', '1.4.0', '1.4.1'].map(versionRank);
  for (let i = 1; i < order.length; i++) assert.ok(order[i]! > order[i - 1]!, `${i}`);
});

test('the .xlsx (sheet CO2e, plus byGHG) reads like the CSV; version and price year from the file', async () => {
  const wb = new ExcelJS.Workbook();
  const gas = wb.addWorksheet('byGHG'); gas.addRow(HEAD); gas.addRow([111110, 'Soybean Farming', 'Carbon dioxide', 'kg/2024 USD, purchaser price', 0.1, 0.01, 0.11, '1111A0']);
  const ws = wb.addWorksheet('CO2e'); ws.addRow(HEAD); for (const r of ROWS) ws.addRow(r);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const x = await parseEpaXlsx(buf, 'SupplyChainGHGEmissionFactorsv1.4.0.xlsx');
  assert.equal(x.version, '1.4.0'); assert.equal(x.priceYear, 2024); assert.equal(x.rows.length, 2);
  assert.equal(x.rows[1]!.naics, '322230'); assert.equal(x.rows[1]!.withMargins, 0.4); assert.equal(x.rows[1]!.withoutMargins, 0.3);
  const csv = [HEAD.map((h) => `"${h}"`).join(','), ...ROWS.map((r) => r.map((v) => (typeof v === 'string' ? `"${v}"` : v)).join(','))].join('\n');
  const c = parseEpa(csv, 'SupplyChainGHGEmissionFactors_v1.4.0_NAICS_CO2e_USD2024.csv');
  assert.equal(c.sha256, x.sha256, 'same factors, same fingerprint, whatever the file type');
  assert.equal(parseEpa(csv, 'SupplyChainGHGEmissionFactorsv1.4.0-rc.1.csv').version, '1.4.0-rc.1');
});
