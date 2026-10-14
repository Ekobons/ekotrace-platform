/**
 * Security alerts, raised from the sealed audit records by rules — so they cover every way in
 * (screens, API, SCIM). Each alert is also written to the audit log as "alert.<rule>", so it reaches the
 * SIEM with a higher syslog severity. One alert per key per hour (no floods).
 *
 *   high     many failed sign-ins from one address · MFA no longer required · a new super admin ·
 *            a company's data deleted · the audit chain broken
 *   medium   an account locked by wrong passwords / codes · MFA switched off or reset · full data export ·
 *            company sign-in settings changed · a new SCIM token · company sign-ins failing repeatedly ·
 *            a sync tried to remove the last super admin
 *   low      a new API client
 */
import { platformTx, type Tx } from '../db/pool.js';
import { PRODUCT } from './brand.js';

export type Severity = 'low' | 'medium' | 'high';
interface Ev { seal_seq: string; id: string; tenant_id: string | null; user_id: string | null; user_name: string | null; action: string; entity_id: string | null; detail: Record<string, unknown> | null; ip: string | null; at: string }
interface Hit { rule: string; severity: Severity; title: string; dedup: string; tenant: string | null; detail?: Record<string, unknown> }

const who = (e: Ev) => e.user_name ?? 'someone';
async function rules(c: Tx, e: Ev): Promise<Hit[]> {
  const t = e.tenant_id, d = e.detail ?? {}, out: Hit[] = [];
  const hit = (rule: string, severity: Severity, title: string, key = e.id, tenant = t, detail?: Record<string, unknown>) => out.push({ rule, severity, title, dedup: `${rule}:${tenant ?? '-'}:${key}`, tenant, detail });
  switch (e.action) {
    case 'login.failed': case 'login.mfa_failed': case 'login.locked': {
      if (e.ip) {
        const n = Number((await c.query(`SELECT count(*) AS n FROM audit_log WHERE action IN ('login.failed','login.mfa_failed','login.locked') AND ip = $1 AND seal_seq <= $2 AND at > (SELECT at FROM audit_log WHERE seal_seq = $2) - interval '10 minutes'`, [e.ip, e.seal_seq])).rows[0].n);
        if (n >= 10) hit('failed_signins_ip', 'high', `${n} failed sign-ins from ${e.ip} in 10 minutes`, e.ip, null, { ip: e.ip, count: n });
      }
      if (e.user_id) {
        const n = Number((await c.query(`SELECT count(*) AS n FROM audit_log WHERE action IN ('login.failed','login.mfa_failed') AND user_id = $1 AND seal_seq <= $2 AND at > (SELECT at FROM audit_log WHERE seal_seq = $2) - interval '15 minutes'`, [e.user_id, e.seal_seq])).rows[0].n);
        if (n >= 5) hit('account_locked', 'medium', `${who(e)}'s account was locked after ${n} wrong ${e.action === 'login.mfa_failed' ? 'codes' : 'passwords'}`, e.user_id, t, { ip: e.ip });
      }
      break;
    }
    case 'login.sso_failed': {
      const n = Number((await c.query(`SELECT count(*) AS n FROM audit_log WHERE action = 'login.sso_failed' AND tenant_id IS NOT DISTINCT FROM $1 AND seal_seq <= $2 AND at > (SELECT at FROM audit_log WHERE seal_seq = $2) - interval '10 minutes'`, [t, e.seal_seq])).rows[0].n);
      if (n >= 5) hit('sso_failures', 'medium', `${n} company sign-ins refused in 10 minutes`, 'burst', t, { last: d.reason });
      break;
    }
    case 'mfa.disable': hit('mfa_off', 'medium', `${who(e)} switched multi-factor authentication off`); break;
    case 'mfa.reset': hit('mfa_reset', 'medium', `${who(e)} reset ${String(d.name ?? 'someone')}'s multi-factor authentication`); break;
    case 'security.mfa_policy': if (d.required === false) hit('mfa_policy_off', 'high', `${who(e)} stopped requiring multi-factor authentication`); break;
    case 'security.sso': hit('sso_changed', 'medium', `${who(e)} changed company sign-in${d.enabled === false ? ' (switched off)' : d.enforce === false ? '' : ' (company sign-in only)'}`); break;
    case 'company.export': hit('data_export', 'medium', `${who(e)} downloaded all of the company's data`); break;
    case 'scim.token': hit('scim_token', 'medium', `${who(e)} made a new account-sync (SCIM) token`); break;
    case 'api_key.create': hit('api_client', 'low', `${who(e)} added an API client "${String(d.name ?? '')}" (${(d.scopes as string[] | undefined)?.join(', ') ?? ''})`); break;
    case 'user.create': case 'user.update': if (d.role === 'super_admin') hit('new_super_admin', 'high', `${who(e)} made ${String(d.email ?? 'someone')} a super admin`); break;
    case 'scim.access': if (d.role === 'super_admin') hit('new_super_admin', 'high', 'The identity provider gave someone super admin rights (group mapping)', e.entity_id ?? e.id); break;
    case 'scim.kept_last_super_admin': hit('scim_last_super_admin', 'medium', 'Account sync tried to remove the last super admin (kept)', e.entity_id ?? e.id); break;
    case 'company.destroy': hit('company_destroyed', 'high', `${who(e)} deleted all data of ${String(d.company ?? 'a company')}`, e.id, null); break;
    case 'audit.verify': if (d.ok === false) hit('audit_chain', 'high', 'The audit log chain check failed', e.id, null); break;
  }
  return out;
}

/** Check new sealed audit records against the rules. Returns how many alerts were raised. */
export async function runAlerts(): Promise<number> {
  return platformTx(async (c) => {
    const cur = Number((await c.query(`INSERT INTO siem_cursor (name) VALUES ('alerts') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING last_seq`)).rows[0].last_seq);
    const evs = (await c.query(`SELECT seal_seq, id::text, tenant_id, user_id, user_name, action, entity_id, detail, ip, at FROM audit_log WHERE seal_seq > $1 AND action NOT LIKE 'alert.%' ORDER BY seal_seq LIMIT 2000`, [cur])).rows as Ev[];
    let n = 0;
    for (const e of evs) {
      for (const h of await rules(c, e)) {
        const dup = (await c.query(`SELECT 1 FROM security_alert WHERE dedup = $1 AND at > now() - interval '1 hour'`, [h.dedup])).rowCount;
        if (dup) continue;
        await c.query(`INSERT INTO security_alert (tenant_id, rule, severity, title, detail, dedup, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [h.tenant, h.rule, h.severity, h.title, JSON.stringify({ ...h.detail, by: e.user_name, ip: e.ip, record: Number(e.seal_seq) }), h.dedup, e.seal_seq]);
        await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, detail, ip) VALUES ($1,$5,$2,$3,$4)`,
          [h.tenant, `alert.${h.rule}`, JSON.stringify({ severity: h.severity, title: h.title, record: Number(e.seal_seq) }), e.ip, `${PRODUCT} alerts`]);
        n++;
      }
    }
    const last = evs.length ? Number(evs[evs.length - 1]!.seal_seq) : cur;
    if (last !== cur) await c.query(`UPDATE siem_cursor SET last_seq = $1, updated_at = now() WHERE name = 'alerts'`, [last]);
    return n;
  });
}
