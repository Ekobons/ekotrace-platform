/**
 * Platform admins (Ekobon staff) on this server: list them, or reset one's password.
 * Run on the server only (needs the database settings in .env); nothing here is reachable from the web.
 *
 *   npm run admin:list
 *   npm run admin:reset -- --email you@ekobon.com     prints a temporary password once; it must be changed at sign-in
 *
 * A reset also unlocks the account and ends its open sessions. MFA stays as it is (use the recovery codes if the phone is lost).
 */
import { parseArgs } from 'node:util';
import { platformTx, pool } from '../db/pool.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';

const { values, positionals } = parseArgs({ options: { email: { type: 'string' } }, allowPositionals: true });
const cmd = positionals[0];
try {
  if (cmd === 'list') {
    const rows = await platformTx(async (c) => (await c.query(
      `SELECT email, name, disabled, last_login_at, mfa_enabled_at IS NOT NULL AS mfa FROM app_user WHERE role = 'platform_admin' ORDER BY created_at`)).rows);
    if (!rows.length) console.log('\nNo platform admin yet. Create one: npm run admin:create -- --email you@ekobon.com --name "Your Name"\n');
    else {
      console.log('\nPlatform admins on this server:');
      for (const r of rows) console.log(`  ${r.email}  (${r.name})${r.disabled ? '  DISABLED' : ''}  · MFA ${r.mfa ? 'on' : 'off'} · last sign-in ${r.last_login_at ? new Date(r.last_login_at).toISOString().slice(0, 16).replace('T', ' ') : 'never'}`);
      console.log('');
    }
  } else if (cmd === 'reset') {
    if (!values.email) throw new Error('Usage: npm run admin:reset -- --email you@ekobon.com');
    const pw = temporaryPassword();
    await platformTx(async (c) => {
      const u = (await c.query(`SELECT id FROM app_user WHERE lower(email) = lower($1) AND role = 'platform_admin'`, [values.email])).rows[0];
      if (!u) throw new Error(`No platform admin with the email ${values.email} (see: npm run admin:list)`);
      await c.query(`UPDATE app_user SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, disabled = false WHERE id = $1`, [u.id, await hashPassword(pw)]);
      await c.query(`DELETE FROM session WHERE user_id = $1`, [u.id]);
      await c.query(`INSERT INTO audit_log (action, detail) VALUES ('platform_admin.password_reset', $1)`, [JSON.stringify({ email: values.email, via: 'server command' })]);
    });
    console.log(`\nPassword reset for ${values.email}\nTemporary password (shown once, change it at sign-in): ${pw}\n`);
  } else throw new Error('Usage: npm run admin:list  |  npm run admin:reset -- --email you@ekobon.com');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
