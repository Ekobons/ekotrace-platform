import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILE = join(dirname(fileURLToPath(import.meta.url)), '../files/Purchases-Q3-2026-DEMO.csv');

export const name = 'data-entry-purchases';
export const title = 'Upload a purchase file';
export const subtitle = 'An ERP export, any layout: map the columns, review by impact, publish';

export async function setup(v) { v.fac = await v.facility('Al Qusais Packaging Plant'); }

export async function run(v) {
  const p = v.page;
  await v.go(`/data/purchased_goods?facility=${v.fac}&year=2026`);
  await v.say('Purchases → Upload Excel / CSV: an export from the ERP or finance system, any layout.', 3200);
  await v.upload(p.locator('input[type=file]').first(), FILE, p.locator('.card.drop').first(), 2000);
  await v.say('Say which column is which. The best guess is already filled in.', 3200);
  await v.scroll(300);
  await v.say('Only the description and the amount are needed — date, supplier, account and facility make it better.', 3800);
  await v.say('The layout is remembered for the next file with the same columns.', 2400);
  await v.click(p.getByRole('button', { name: 'Read the whole file' }), 1000);
  await v.say('The file is read in the background: lines grouped into kinds of purchase, each matched to a spend category.', 1000);
  await p.getByRole('button', { name: /^Publish \d+ ready lines/ }).waitFor({ timeout: 60000 });
  await p.waitForFunction(() => !/Reading|Mapping|Calculating|queued|running/i.test(document.querySelector('.head h1')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
  await v.wait(2400);
  await v.top(300);
  await v.say('Review by impact: the largest kinds of purchase wait under “To confirm”.', 3200);
  await v.scroll(420);
  await v.say('Each shows its spend, the category found and how sure — change it if needed.', 3400);
  const confirm = p.getByRole('button', { name: /^Confirm these \d+/ });
  if (await confirm.count()) { await v.say('When they look right, confirm them; the small rest is accepted as it is.', 1400); await v.click(confirm, 1800); }
  await v.click(p.locator('.tabs button', { hasText: 'Summary' }), 1400);
  await v.say('The summary by Scope 3 category: the freight went to 3.4 and the laptops to capital goods (3.2) by themselves.', 4000);
  await v.top(300);
  await v.click(p.getByRole('button', { name: /^Publish \d+ ready lines/ }), 2400);
  await v.say('Publish: the lines become entries per facility, month and category — submitted for approval.', 3600);
}
