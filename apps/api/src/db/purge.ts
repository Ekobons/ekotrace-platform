/**
 * Removing everything a company holds (demo reset; secure deletion at the end of a contract).
 * The audit log is not touched: it is append-only and its records go when their retention ends.
 */
import type { Tx } from './pool.js';

const ORDERED = [
  'DELETE FROM carbon_credit_retirement WHERE tenant_id = $1', 'DELETE FROM carbon_credit_lot WHERE tenant_id = $1', 'DELETE FROM base_restatement WHERE tenant_id = $1', 'DELETE FROM notification WHERE tenant_id = $1', 'DELETE FROM reminder_log WHERE tenant_id = $1', 'DELETE FROM email_outbox WHERE tenant_id = $1', 'DELETE FROM collection_exception WHERE tenant_id = $1',
  'DELETE FROM metric_change WHERE tenant_id = $1', 'DELETE FROM metric_version WHERE tenant_id = $1', 'DELETE FROM metric WHERE tenant_id = $1',
  'DELETE FROM announcement_read WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)', 'DELETE FROM announcement WHERE $1 = ANY(tenant_ids) AND cardinality(tenant_ids) = 1',
  'DELETE FROM message_read WHERE tenant_id = $1', 'DELETE FROM message WHERE tenant_id = $1', 'DELETE FROM message_thread WHERE tenant_id = $1',
  'DELETE FROM period_lock WHERE tenant_id = $1', 'DELETE FROM document_link WHERE tenant_id = $1', 'DELETE FROM assurance_finding WHERE tenant_id = $1', 'DELETE FROM assurance_sample WHERE tenant_id = $1',
  'DELETE FROM assurance_engagement WHERE tenant_id = $1', 'DELETE FROM waste_scan WHERE tenant_id = $1', 'DELETE FROM waste_bin WHERE tenant_id = $1', 'DELETE FROM contractor_statement WHERE tenant_id = $1',
  'DELETE FROM contractor_session WHERE tenant_id = $1', 'DELETE FROM waste_contractor WHERE tenant_id = $1', 'DELETE FROM certificate_claim WHERE tenant_id = $1', 'DELETE FROM energy_certificate WHERE tenant_id = $1',
  'DELETE FROM supplier_factor WHERE tenant_id = $1', 'DELETE FROM job WHERE tenant_id = $1', 'UPDATE purchase_line SET activity_id = NULL WHERE tenant_id = $1', 'DELETE FROM activity_result WHERE tenant_id = $1',
  'DELETE FROM activity WHERE tenant_id = $1', 'DELETE FROM purchase_batch WHERE tenant_id = $1', 'DELETE FROM purchase_rule WHERE tenant_id = $1', 'DELETE FROM purchase_profile WHERE tenant_id = $1',
  'DELETE FROM supplier_ef WHERE tenant_id = $1', 'DELETE FROM supplier WHERE tenant_id = $1', 'DELETE FROM fx_rate WHERE tenant_id = $1', 'DELETE FROM vehicle WHERE tenant_id = $1',
  'UPDATE tenant SET logo_id = NULL WHERE id = $1', 'DELETE FROM bill WHERE tenant_id = $1', 'DELETE FROM document WHERE tenant_id = $1', 'DELETE FROM meter_reading WHERE tenant_id = $1', 'DELETE FROM meter WHERE tenant_id = $1',
  'DELETE FROM api_key WHERE tenant_id = $1', 'DELETE FROM commute_record WHERE tenant_id = $1', 'DELETE FROM survey WHERE tenant_id = $1', 'DELETE FROM waste_deposit WHERE tenant_id = $1', 'DELETE FROM waste_site WHERE tenant_id = $1',
  'DELETE FROM price WHERE tenant_id = $1', 'DELETE FROM user_facility WHERE tenant_id = $1', 'DELETE FROM reduction_action WHERE tenant_id = $1', 'DELETE FROM scenario WHERE tenant_id = $1',
  'DELETE FROM target_objective WHERE tenant_id = $1', 'DELETE FROM lever_scenario WHERE tenant_id = $1', 'DELETE FROM sso_config WHERE tenant_id = $1', 'DELETE FROM scim_member WHERE tenant_id = $1', 'DELETE FROM scim_group WHERE tenant_id = $1', 'DELETE FROM scim_token WHERE tenant_id = $1', 'DELETE FROM sso_state WHERE tenant_id = $1',
  'DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)', 'DELETE FROM login_challenge WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)',
  'UPDATE org_node SET manager_user_id = NULL WHERE tenant_id = $1',
];
const LAST = ['DELETE FROM app_user WHERE tenant_id = $1', 'DELETE FROM tenant_catalogue WHERE tenant_id = $1',
  "DELETE FROM org_node WHERE tenant_id = $1 AND kind = 'facility'", "DELETE FROM org_node WHERE tenant_id = $1 AND kind = 'subgroup'", 'DELETE FROM org_node WHERE tenant_id = $1'];

/** Tables holding company rows (a tenant_id column), except the audit log. */
export async function tenantTables(c: Tx): Promise<string[]> {
  return (await c.query<{ t: string }>(`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
                                         WHERE c.table_schema = current_schema() AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'audit_log' ORDER BY 1`)).rows.map((r) => r.t);
}
export async function countRows(c: Tx, tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await tenantTables(c)) {
    const n = Number((await c.query(`SELECT count(*) AS n FROM "${t}" WHERE tenant_id = $1`, [tenantId])).rows[0].n);
    if (n) out[t] = n;
  }
  out.tenant = Number((await c.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [tenantId])).rows[0].n);
  return out;
}

/** Delete everything of the company (run as platform, inside one transaction). Throws if anything is left. */
export async function purgeTenant(c: Tx, tenantId: string) {
  for (const sql of ORDERED) await c.query(sql, [tenantId]);
  // anything the list does not name yet (newer tables): a few passes, children before parents
  for (let pass = 0; pass < 4; pass++) {
    let left = 0;
    for (const t of await tenantTables(c)) {
      if (['app_user', 'org_node', 'tenant_catalogue'].includes(t)) continue;
      await c.query('SAVEPOINT p');
      try { await c.query(`DELETE FROM "${t}" WHERE tenant_id = $1`, [tenantId]); await c.query('RELEASE SAVEPOINT p'); }
      catch { await c.query('ROLLBACK TO SAVEPOINT p'); left++; }
    }
    if (!left) break;
  }
  for (const sql of LAST) await c.query(sql, [tenantId]);
  await c.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  const rest = await countRows(c, tenantId);
  const remaining = Object.entries(rest).filter(([, n]) => n > 0);
  if (remaining.length) throw new Error(`Rows left after deletion: ${remaining.map(([t, n]) => `${t} ${n}`).join(', ')}`);
}
