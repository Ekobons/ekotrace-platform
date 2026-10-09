/**
 * Which facilities a person may see, enter data for and approve.
 *
 *                 see        enter      approve
 *  super_admin    all        all        all
 *  admin          own sub-group (and everything below it)
 *  manager        facilities they manage or are assigned to
 *  preparer       assigned   assigned   —
 *  verifier       all        —          —
 *  platform_admin all (of the company they opened)
 *
 * Runs inside a tenant transaction, so row-level security still applies.
 */
import type { Tx } from '../db/pool.js';
import type { User } from './auth.js';
import { forbidden } from './errors.js';

export interface Scope {
  see: Set<string>;
  enter: Set<string>;
  approve: Set<string>;
}

export async function scopeOf(c: Tx, user: User): Promise<Scope> {
  const all = (await c.query<{ id: string }>(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id);
  const allSet = new Set(all);
  switch (user.role) {
    case 'platform_admin':
    case 'super_admin':
      return { see: allSet, enter: allSet, approve: allSet };
    case 'verifier':
      return { see: allSet, enter: new Set(), approve: new Set() };
    case 'admin': {
      const ids = await subtreeFacilities(c, user.scopeNodeId);
      return { see: ids, enter: ids, approve: ids };
    }
    case 'manager': {
      const ids = new Set((await c.query<{ id: string }>(
        `SELECT id FROM org_node WHERE kind = 'facility' AND active AND manager_user_id = $1
         UNION SELECT node_id FROM user_facility WHERE user_id = $1`, [user.id])).rows.map((r) => r.id));
      return { see: ids, enter: ids, approve: ids };
    }
    case 'preparer': {
      const ids = new Set((await c.query<{ node_id: string }>('SELECT node_id FROM user_facility WHERE user_id = $1', [user.id])).rows.map((r) => r.node_id));
      return { see: ids, enter: ids, approve: new Set() };
    }
  }
}

/** Facilities at or below a node (a sub-group, or the group). */
export async function subtreeFacilities(c: Tx, nodeId: string | null): Promise<Set<string>> {
  if (!nodeId) return new Set();
  const r = await c.query<{ id: string }>(
    `WITH RECURSIVE t AS (SELECT id, kind FROM org_node WHERE id = $1
                          UNION ALL SELECT n.id, n.kind FROM org_node n JOIN t ON n.parent_id = t.id)
     SELECT id FROM t JOIN org_node USING (id) WHERE t.kind = 'facility' AND org_node.active`, [nodeId]);
  return new Set(r.rows.map((x) => x.id));
}

/** Nodes at or below a node, of any kind (used for Admin's right to edit the structure). */
export async function subtreeNodes(c: Tx, nodeId: string | null): Promise<Set<string>> {
  if (!nodeId) return new Set();
  const r = await c.query<{ id: string }>(
    `WITH RECURSIVE t AS (SELECT id FROM org_node WHERE id = $1 UNION ALL SELECT n.id FROM org_node n JOIN t ON n.parent_id = t.id) SELECT id FROM t`, [nodeId]);
  return new Set(r.rows.map((x) => x.id));
}

export function assertCan(scope: Set<string>, facilityId: string, what = 'this facility') {
  if (!scope.has(facilityId)) throw forbidden(`You do not have access to ${what}`);
}
