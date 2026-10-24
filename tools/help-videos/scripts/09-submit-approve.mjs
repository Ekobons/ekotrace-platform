export const name = 'data-entry-submit-approve';
export const title = 'Submit, approve or send back';
export const subtitle = 'From draft to approved: what the preparer and the approver do';

export async function setup(v) { v.fac = await v.facility('Al Qusais Packaging Plant'); }

export async function run(v) {
  const p = v.page;
  await v.go(`/data/stationary_combustion?facility=${v.fac}&year=2026`);
  await v.click(p.getByRole('button', { name: 'Clear' }), 400);
  for (const m of ['Jul', 'Aug']) await v.click(p.locator('.mbtn', { hasText: m }).first(), 300);
  for (const [m, x] of [['Jul', '1250'], ['Aug', '1180']]) await v.type(p.locator(`input[aria-label="${m} quantity"]`), x);
  await v.say('Not finished yet? Save as draft — only you see a draft, and nothing counts yet.', 2600);
  await v.click(p.getByRole('button', { name: 'Save as draft' }), 1600);
  await v.click(p.getByRole('button', { name: /Review and submit/ }), 1200);
  await v.say('Step 2, Review: the drafts and everything waiting for approval for these months.', 3200);
  await v.click(p.getByRole('button', { name: /^Submit \d+ draft/ }), 1600);
  await v.say('Submitted: the entries go to the facility’s approver and the months show “In review”.', 3200);
  await v.go('/approvals');
  await v.say('The approver opens Capture → Entries & approvals: everything sent for the facilities they look after.', 3600);
  const row = p.locator('table tbody tr', { has: p.getByRole('button', { name: 'Approve', exact: true }) });
  await v.point(row.first().locator('td').nth(4), 300);
  await v.say('Each entry shows the quantity, the tCO₂e, who sent it and a check against earlier months.', 3400);
  await v.click(row.first().getByRole('button', { name: 'How calculated' }), 2800);
  await p.keyboard.press('Escape'); await v.wait(500);
  await v.say('Right? Approve — the entry counts in reports and dashboards.', 1400);
  await v.click(row.first().getByRole('button', { name: 'Approve', exact: true }), 1600);
  await v.say('Something wrong? Send it back with a note: the preparer corrects it and submits again.', 1400);
  const r2 = row.first();
  await v.click(r2.getByRole('button', { name: 'Send back', exact: true }), 600);
  await v.type(p.getByPlaceholder('What needs fixing?'), 'Please attach the delivery note for this month', 400);
  await v.click(p.getByRole('button', { name: 'Send back', exact: true }).first(), 1600);
  await v.say('Approved entries leave the list; find them under Entries & results, with their status.', 3200);
}
