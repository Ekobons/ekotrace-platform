/**
 * Create a platform admin (Ekobon staff) and print a temporary password once.
 *
 *   npm run admin:create -- --email you@ekobon.com --name "Your Name"
 *
 * The password must be changed at first login.
 */
import { parseArgs } from 'node:util';
import { platformTx, pool } from '../db/pool.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (!values.email || !values.name) {
  console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name"');
  process.exit(1);
}
const pw = temporaryPassword();
try {
  await platformTx(async (c) => {
    const exists = (await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [values.email])).rowCount;
    if (exists) throw new Error('An account with this email already exists');
    await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash) VALUES (NULL, $1, $2, 'platform_admin', $3)`,
      [values.email!.toLowerCase(), values.name, await hashPassword(pw)]);
    await c.query(`INSERT INTO audit_log (action, detail) VALUES ('platform_admin.create', $1)`, [JSON.stringify({ email: values.email })]);
  });
  console.log(`\nPlatform admin created: ${values.email}\nTemporary password (shown once, change it at first login): ${pw}\n`);
} catch (e) {
  console.error('Could not create the admin:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
