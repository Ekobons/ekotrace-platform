import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE = join(dirname(fileURLToPath(import.meta.url)), '../files/Site-log-Q3-2026-DEMO.xlsx');

export const name = 'data-entry-smart-import';
export const title = 'Smart import';
export const subtitle = 'Any spreadsheet of activity data, in your own layout';

export async function run(v) {
  const p = v.page;
  await v.go('/import');
  await v.say('Capture → Smart import: drop a spreadsheet in your own layout — fuel, electricity, refrigerants, water, waste.', 3600);
  await v.upload(p.locator('input[type=file]').first(), FILE, p.locator('.card', { hasText: 'Drop an Excel' }).first(), 600);
  await p.waitForURL(/\/import\/.+/, { timeout: 60000 });
  await p.waitForLoadState('networkidle').catch(() => {});
  await v.wait(1500);
  await v.say('The layout of each sheet is read: which column is the site, the month, the activity, the quantity and unit.', 3800);
  await v.point(p.locator('.kgrid4').first(), 300);
  await v.say('Every row is checked and calculated: ready, to check, or with a problem to fix.', 3400);
  await v.scroll(380);
  await v.say('Activities found: each description is matched to an activity — confirm or change it, and it is remembered.', 3800);
  // fix the two weak matches: change the activity in its list
  const pick = async (rowText, re) => {
    const sel = p.locator('tr', { hasText: rowText }).locator('select').first();
    const label = await sel.evaluate((el, src) => [...el.options].find((o) => new RegExp(src, 'i').test(o.text))?.value ?? '', re);
    if (label) await v.select(sel, label, 1000);
  };
  await v.say('“Municipal water” was matched to tanker water, and the cardboard to nothing: pick the right ones.', 1200);
  await pick('Municipal water', '^Mains water — desalinated');
  await pick('Cardboard recycled', '^Paper and board: board · Closed-loop recycling');
  await v.wait(1200);
  const confirmAll = p.locator('button', { hasText: /^Confirm/ });
  for (let i = 0; i < 6 && (await confirmAll.count()); i++) await v.click(confirmAll.first(), 900);
  await v.scroll(380);
  await v.say('Facilities found are matched the same way. Rows below: each with its month, quantity and tCO₂e.', 3400);
  await v.top(400);
  await v.click(p.getByRole('button', { name: /^Create and submit \d+/ }), 2000);
  await v.say('Create and submit: the ready rows become entries, sent for approval, with the file kept as evidence.', 3800);
}
