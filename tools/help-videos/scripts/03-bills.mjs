import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const FILES = join(dirname(fileURLToPath(import.meta.url)), '../files');
const ACCOUNT = 'HPW-7730-4412';
const BILLS = ['07', '08', '09'].map((m) => join(FILES, `Harbourline-${ACCOUNT}-2026-${m}.pdf`));

export const name = 'data-entry-bills';
export const title = 'Upload utility bills';
export const subtitle = 'Drop the PDFs, check what was read, publish';

/** the plant's electricity account, with the account number printed on its bills */
export async function setup(v) {
  const fac = await v.facility('Al Qusais Packaging Plant');
  const items = await v.api('GET', '/api/meters').catch(() => null);
  const grid = items?.meters?.find((m) => m.unit === 'kWh_e')?.item_id ?? 6;
  await v.api('POST', '/api/meters', { facilityId: fac, name: `Main supply (account ${ACCOUNT})`, readingType: 'interval', frequency: 'month', unit: 'kWh_e', itemId: grid, template: {}, accountNo: ACCOUNT });
  v.fac = fac;
  await v.pdfAsImage();
}

export async function run(v) {
  const p = v.page;
  const row = (m) => p.locator('table.t tbody tr', { hasText: `${ACCOUNT}-2026-${m}` });
  const checked = () => v.click(p.getByRole('button', { name: /Checked — add to preview/ }), 1400);
  await v.go(`/data/purchased_electricity?facility=${v.fac}&year=2026&via=bills`);
  await v.say('Electricity → Upload bills. Drop the PDF bills here — as many as you like.', 2600);
  await v.upload(p.locator('input[type=file]'), BILLS, p.locator('.card.drop'), 2200);
  await v.say('Each bill is read: account number, billing period, kWh and amount.', 3000);
  await v.scroll(330);
  await v.point(row('07').locator('td').nth(5), 300);
  await v.say('The account number matches the plant’s electricity account — so each bill finds its facility.', 3600);
  await v.click(row('07'), 1200);
  await v.say('Open a bill: the PDF beside what was read. Fill in or correct anything missing…', 2400);
  await v.type(p.locator('label.field', { hasText: 'Supplier' }).locator('input'), 'Harbourline Power & Water', 600);
  await v.point(p.locator('label.field', { hasText: 'Consumption' }).locator('input'), 300);
  await v.say('…compare the figures with the PDF, then confirm it.', 2000);
  await checked();
  const supplier = () => p.locator('label.field', { hasText: 'Supplier' }).locator('input').fill('Harbourline Power & Water');
  for (const m of ['08', '09']) { await v.click(row(m), 900); await supplier(); await v.wait(300); await checked(); }
  await v.top();
  await v.click(p.locator('.tabs button', { hasText: 'Ready to publish' }), 1000);
  await v.say('“Ready to publish” previews what each bill becomes: the months and the emissions.', 3400);
  await v.click(p.getByRole('button', { name: /^Publish \d+ bill/ }), 1800);
  await v.say('Published: each month becomes an entry — waiting for approval like any other.', 2400);
  await v.click(p.locator('.tabs button', { hasText: 'Published' }), 900);
  await v.point(row('09'), 300);
  await v.say('The published bills stay here, each one openable — the source behind the numbers.', 2800);
}
