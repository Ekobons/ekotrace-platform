export const name = 'data-entry-fleet';
export const title = 'Vehicles: the whole fleet';
export const subtitle = 'Every vehicle of the facility, month by month — typed or pasted from Excel';

const FLEET = [
  ['Delivery van 1', 'DXB-T 41207', 330, 'distance'],
  ['Delivery van 2', 'DXB-T 41208', 330, 'distance'],
  ['Pallet truck 18 t', 'DXB-T 50992', 347, 'distance'],
  ['Forklift (LPG)', null, 3, 'fuel'],
  ['Site manager EV', 'DXB-P 70115', 300, 'distance'],
];
const DATA = [[2840, 3105, 2960], [2615, 2790, 2580], [4120, 3980, 4310], [610, 585, 640], [1430, 1515, 1390]];

export async function setup(v) {
  v.fac = await v.facility('Al Qusais Packaging Plant');
  for (const [name, registration, itemId, defaultMethod] of FLEET)
    await v.api('POST', `/api/facilities/${v.fac}/vehicles`, { name, registration, itemId, defaultMethod, inServiceFrom: '2025-01-01', charging: itemId === 300 ? 'elsewhere' : undefined });
}

export async function run(v) {
  const p = v.page;
  await v.go(`/data/mobile_combustion?facility=${v.fac}&year=2026&via=fleet`);
  await v.say('Vehicles → Whole fleet: every vehicle of the facility is a row, the months across.', 3400);
  await v.click(p.getByRole('button', { name: 'Collapse the menu' }), 700);
  await v.scroll(380);
  // the grid's own order of vehicles, for the pasted block
  const names = await p.locator('table.fleetyear tbody tr td:first-child b').allTextContents();
  const order = names.map((n) => FLEET.findIndex((f) => f[0] === n));
  await v.say('Method and unit once per vehicle: distance in km, or the fuel used.', 3000);
  await v.point(p.locator('table.fleetyear tbody tr', { hasText: 'Forklift' }).locator('select').first(), 1200);
  const cell = (r, m) => p.locator('table.fleetyear tbody tr').nth(r).locator('td').nth(2 + m).locator('input');
  await v.say('Type a month’s reading in its cell…', 600);
  await v.type(cell(0, 6), String(DATA[order[0]][0]), 900);
  await v.excel('Fleet log Q3.xlsx', ['Vehicle', 'Jul', 'Aug', 'Sep'], order.map((i) => [FLEET[i][0], ...DATA[i]]), -1, 600);
  await v.say('…or copy a block from Excel — vehicles down, months across…', 2600);
  await v.excelClose();
  await v.paste(cell(0, 6), order.map((i) => DATA[i].join('\t')).join('\n'), 1200);
  await v.say('…and paste it into the first cell. Each line is calculated as you go.', 3200);
  await v.point(p.locator('span.sub', { hasText: 'vehicle-months' }), 1200);
  await v.click(p.getByRole('button', { name: /^Save \d+ vehicle-month/ }), 1600);
  await v.say('Saved as drafts. Submit them for approval when the month is complete.', 3000);
  const submit = p.getByRole('button', { name: /Review and submit/ });
  if (await submit.count()) await v.point(submit, 1500);
}
