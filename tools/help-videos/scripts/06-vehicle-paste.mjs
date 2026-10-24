export const name = 'data-entry-vehicle-paste';
export const title = 'Vehicles: paste a table';
export const subtitle = 'Rows from any spreadsheet, in everyday words';

const HEAD = ['Month', 'Vehicle', 'No.', 'Km / litres each', 'Unit'];
const ROWS = [
  ['2026-09', 'van diesel', 3, 2400, 'km'],
  ['2026-09', 'car petrol', 2, 1650, 'km'],
  ['2026-09', 'large car diesel', 1, 2100, 'km'],
  ['2026-09', 'motorbike petrol', 4, 1800, 'km'],
  ['2026-09', 'forklift LPG', 2, 320, 'litres'],
];

export async function setup(v) { v.fac = await v.facility('Al Qusais Packaging Plant'); }

export async function run(v) {
  const p = v.page;
  await v.go(`/data/mobile_combustion?facility=${v.fac}&year=2026&via=paste`);
  await v.say('Vehicles → Paste a table: for hired or pool vehicles, or a log kept in Excel.', 3200);
  await v.click(p.getByRole('button', { name: 'Collapse the menu' }), 500);
  await v.scroll(300);
  await v.excel('Transport log Sep.xlsx', HEAD, ROWS, -1, 600);
  await v.say('Copy the rows — with their header row — from the spreadsheet…', 2800);
  await v.excelClose();
  const first = p.locator('table.t tbody tr').first().locator('input').first();
  await v.paste(first, [HEAD, ...ROWS].map((r) => r.join('\t')).join('\n'), 2400);
  await v.say('…and paste into the first cell. The header names tell which column is which.', 3400);
  await v.point(p.locator('table.t thead th', { hasText: 'Read as' }), 600);
  await v.say('Each row is read in plain words: “van diesel” becomes the right vehicle type and factor.', 3600);
  await v.say('Change the type on any row if it guessed wrong; rows with a problem stay to be fixed.', 3200);
  await v.click(p.getByRole('button', { name: /^Save \d+ row/ }), 1600);
  await v.say('Saved as drafts for September, ready to submit for approval.', 2600);
  await v.top(500);
  await v.point(p.locator('button.meth', { hasText: 'Excel / CSV' }), 600);
  await v.say('Bigger files? Excel / CSV gives a template for the facility and months — fill it, upload it.', 3400);
}
