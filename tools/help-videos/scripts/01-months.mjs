export const name = 'data-entry-months';
export const title = 'Enter several months at once';
export const subtitle = 'Add data: pick the months, type the quantities, submit';
export async function run(v) {
  const fac = await v.facility('Al Qusais Packaging Plant');
  await v.go(`/data/stationary_combustion?facility=${fac}&year=2026`);
  await v.say('Add data: the facility and year at the top, the categories on the left.', 3200);
  await v.point(v.page.locator('.months'));
  await v.click(v.page.getByRole('button', { name: 'Clear' }));
  await v.say('Pick the months to enter — several at once, side by side.', 1400);
  for (const m of ['Jul', 'Aug', 'Sep']) await v.click(v.page.locator('.mbtn', { hasText: m }).first(), 350);
  await v.say('Choose the fuel class and the unit — the same for every row.', 1500);
  await v.point(v.page.locator('label.field', { hasText: 'Fuel class' }).locator('select'), 900);
  await v.point(v.page.locator('label.field', { hasText: 'Unit' }).first().locator('select'), 900);
  await v.say('Type each month’s quantity: the emissions are calculated as you type.', 600);
  const vals = { Jul: '1250', Aug: '1180', Sep: '1310' };
  for (const [m, x] of Object.entries(vals)) await v.type(v.page.locator(`input[aria-label="${m} quantity"]`), x);
  await v.wait(900);
  await v.say('“How?” shows the factor, the split per gas and each step of the calculation.', 900);
  await v.click(v.page.getByText('How?').first(), 3000);
  await v.page.keyboard.press('Escape'); await v.wait(600);
  await v.say('Then Submit for approval — or Save as draft to finish later.', 1600);
  await v.click(v.page.getByRole('button', { name: 'Submit for approval' }), 1600);
  await v.top();
  await v.point(v.page.locator('.mbtn', { hasText: 'Aug' }).first(), 300);
  await v.say('The months now show “In review” until the facility’s approver approves them.', 3200);
}
