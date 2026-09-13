import type { SqlValue } from "sql.js";
import { uid } from "./repository";
import { nowISO } from "../dates";

/**
 * Lightweight audit helper. The current actor (user + device) is set from
 * DataProvider whenever a session loads; repository functions embed audit
 * rows in the same transaction as the mutation they describe.
 */

let ctx: { userId: string; deviceId: string } = { userId: "system", deviceId: "unknown" };

export function setAuditCtx(userId: string, deviceId: string): void {
  ctx = { userId, deviceId };
}

export type AuditAction =
  | "customer.created"
  | "customer.updated"
  | "customer.archived"
  | "customer.deleted"
  | "customer.undeleted"
  | "plan.created"
  | "plan.updated"
  | "plan.deactivated"
  | "installation.created"
  | "installation.updated"
  | "installation.status"
  | "installation.archived"
  | "invoice.generated"
  | "invoice.voided"
  | "payment.created"
  | "payment.voided"
  | "payment.reversal_requested"
  | "request.created"
  | "request.decided"
  | "user.created"
  | "user.pin_reset"
  | "user.pin_changed"
  | "user.deactivated"
  | "user.activated"
  | "db.seeded"
  | "db.wiped"
  | "db.restored";

/** Returns an INSERT statement to embed in a runBatch transaction. */
export function auditStatement(
  action: AuditAction,
  entity: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
): { sql: string; params: SqlValue[] } {
  const beforeJson = before == null ? null : safeJson(before);
  const afterJson = after == null ? null : safeJson(after);
  return {
    sql: `INSERT INTO audit_log (id, ts, user_id, action, entity, entity_id, before_json, after_json, device_id)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    params: [uid(), nowISO(), ctx.userId, action, entity, entityId, beforeJson, afterJson, ctx.deviceId],
  };
}

/** Standalone audit insert (used where no domain mutation accompanies it). */
export async function auditNow(
  action: AuditAction,
  entity: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
): Promise<void> {
  // Deferred import avoids a circular dependency on database.ts.
  const { run } = await import("./database");
  await run(auditStatement(action, entity, entityId, before, after).sql, auditStatement(action, entity, entityId, before, after).params, {
    immediate: true,
  });
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}