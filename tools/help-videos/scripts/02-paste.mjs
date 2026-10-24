export const name = 'data-entry-paste';
export const title = 'Paste a year of data from Excel';
export const subtitle = 'Copy a column in Excel, paste it into the first month';
export async function run(v) {
  const fac = await v.facility('Al Qusais Packaging Plant');
  await v.go(`/data/stationary_combustion?facility=${fac}&year=2026`);
  await v.say('Your monthly figures are already in a spreadsheet? Paste them.', 2600);
  await v.click(v.page.getByRole('button', { name: 'Clear' }), 300);
  await v.say('“All open months” picks every month not entered yet.', 900);
  await v.click(v.page.getByRole('button', { name: 'All open months' }), 1200);
  await v.say('Choose the fuel class and the unit used in your sheet.', 600);
  await v.select(v.page.locator('label.field', { hasText: 'Fuel class' }).locator('select'), { label: 'Gaseous fuels' });
  await v.select(v.page.locator('label.field', { hasText: 'Unit' }).first().locator('select'), 'm3');
  const vals = [18420, 17110, 16980, 15020, 14600, 13950, 13310, 13020, 14150, 15880];
  await v.excel('Gas meter 2026.xlsx', ['Month', 'Natural gas (m³)'], ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct'].map((m, i) => [m, vals[i]]), 1, 2000);
  await v.say('Copy the column in Excel (Ctrl+C)…', 1800);
  await v.excelClose();
  await v.say('…click the first month’s quantity and paste (Ctrl+V): every month fills in.', 600);
  await v.paste(v.page.locator('input[aria-label$="quantity"]').first(), vals.join('\n'), 1500);
  await v.scroll(380, 1600);
  await v.say('Check the totals and the usual-range column, then submit.', 2600);
  await v.click(v.page.getByRole('button', { name: 'Submit for approval' }), 1500);
  await v.top();
  await v.point(v.page.locator('.months'), 300);
  await v.say('Ten months entered in one go — each one an entry with its own calculation, now waiting for approval.', 3400);
}
