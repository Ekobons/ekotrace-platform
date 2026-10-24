export const name = 'data-entry-meters';
export const title = 'Meter readings';
export const subtitle = 'Connected meters send them; or paste the readings into the meter';

// weekly register readings of a sub-meter, 1 Jul – 7 Oct 2026 (made up)
const READ = [];
{ let r = 284_150; const d = new Date(Date.UTC(2026, 6, 1));
  for (let i = 0; i < 15; i++) { READ.push([d.toISOString().slice(0, 10), r]); r += 9_200 + ((i * 7919) % 1700); d.setUTCDate(d.getUTCDate() + 7); } }

export async function setup(v) {
  v.fac = await v.facility('Al Qusais Packaging Plant');
  const m = await v.api('POST', '/api/meters', { facilityId: v.fac, name: 'Production hall sub-meter', readingType: 'cumulative', frequency: 'week', unit: 'kWh_e', itemId: 6, template: {} });
  v.meter = m.id;
}

export async function run(v) {
  const p = v.page;
  await v.go(`/data/purchased_electricity?facility=${v.fac}&year=2026&via=readings`);
  await v.say('Meters connected to a building system or a logger send readings through the API.', 3200);
  await v.point(p.locator('.card', { hasText: 'Readings received through the API' }).first(), 300);
  await v.say('Each batch waits here with a preview until someone publishes it.', 3000);
  await v.go(`/meters?id=${v.meter}`);
  await v.select(p.locator('label.field', { hasText: 'Facility' }).locator('select'), v.fac, 900);
  await v.say('No connection? Open the meter (Capture → Meters) and paste its readings.', 3200);
  await v.click(p.locator('.tabs button', { hasText: /^Readings/ }), 800);
  await v.excel('Sub-meter log.xlsx', ['Date', 'Reading (kWh)'], READ.map(([d, r]) => [d, r.toLocaleString('en')]), 1, 2200);
  await v.say('Copy the date and reading columns from the logger’s export…', 2000);
  await v.excelClose();
  const box = p.locator('fieldset.box textarea');
  await v.point(box, 400);
  await box.fill(READ.map(([d, r]) => `${d} 00:00\t${r}`).join('\n'));
  await v.say('…and paste them here: one line per reading, time and value.', 2600);
  await v.click(p.getByRole('button', { name: /^Save \d+ readings/ }), 1600);
  await v.click(p.locator('.tabs button', { hasText: 'Months' }), 1000);
  await v.scroll(220);
  await v.say('Each ended month is worked out from the readings: coverage, gaps and its consumption…', 3600);
  const months = p.locator('table.t', { hasText: 'For the entry' });
  await v.point(months.locator('tbody tr').nth(1).locator('td').nth(4), 300);
  await v.say('…and becomes that month’s entry, as a draft.', 2400);
  await v.point(months.locator('tbody tr').nth(1).locator('td').nth(5), 300);
  await v.say('Submit the drafts in Add data, like any other entry, for approval.', 3200);
}
