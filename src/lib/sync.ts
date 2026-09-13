"use client";

import { all, one, run, runBatch, onMutate, type Row } from "./db/database";
import type { SqlValue } from "sql.js";
import { getSupabase, supabaseConfigured, supabaseProjectRef } from "./supabase";
import { getDeviceId } from "./device";
import { nowISO } from "./dates";
import type { SyncState } from "./types";

/**
 * Online sync engine (Supabase mirror of the local SQLite tables).
 *
 * Model: reconcile each table — compare every local row against the remote
 * copy and move the data in the direction of the newer `updated_at`
 * (last-write-wins). The writer's own timestamp is authoritative: `updated_at`
 * is NOT re-stamped by the server, and the server discards any UPDATE older
 * than the stored row, so an out-of-order push from an offline device can
 * never clobber a newer change. The local apply uses the same guard
 * (`ON CONFLICT ... WHERE excluded.updated_at >= local.updated_at`).
 *
 * Hard-deleted rows are recorded in `sync_tombstones` locally and pushed up
 * as soft-deletes (`deleted_at`), so deletions propagate to other devices.
 */

const META_ENABLED = "sync.enabled";
const META_LAST = "sync.last";
const META_ERROR = "sync.error";

interface TableDef {
  local: string;
  remote: string;
  /** Columns (excluding updated_at) transported in both directions. */
  cols: string[];
  /** Local-integer columns that are booleans remotely. */
  bools?: string[];
  /** Local `payload_json` text column maps to remote `payload` jsonb. */
  payloadJsonToRemote?: boolean;
  /** Supports remote soft-deletes that propagate locally. */
  tombstone?: boolean;
}

/** Tables synced online. users/audit_log/meta stay device-local by design. */
const TABLES: TableDef[] = [
  {
    local: "plans",
    remote: "plans",
    bools: ["active"],
    cols: ["id", "name", "monthly_price", "speed_mbps", "active"],
  },
  {
    local: "customers",
    remote: "customers",
    bools: ["archived"],
    tombstone: true,
    cols: [
      "id", "full_name", "phone", "address", "plan_id", "status",
      "archived", "archived_at", "created_at",
    ],
  },
  {
    local: "installations",
    remote: "installations",
    bools: ["archived"],
    cols: [
      "id", "customer_id", "scheduled_date", "started_at", "completed_date",
      "installer", "status", "installation_fee", "notes", "archived",
      "archived_at", "created_at",
    ],
  },
  {
    local: "invoices",
    remote: "invoices",
    cols: [
      "id", "customer_id", "period_start", "period_end", "amount", "type",
      "status", "due_date", "created_at",
    ],
  },
  {
    local: "payments",
    remote: "payments",
    bools: ["cancelled"],
    cols: [
      "id", "invoice_id", "amount", "method", "paid_at", "reference",
      "notes", "recorded_by", "device_id", "cancelled", "cancelled_at",
      "cancel_reason", "cancelled_by", "created_at",
    ],
  },
  {
    local: "requests",
    remote: "requests",
    payloadJsonToRemote: true,
    cols: [
      "id", "type", "payload_json", "status", "requested_by", "requested_at",
      "decided_by", "decided_at", "decision_note",
    ],
  },
];

/* ------------------------------------------------------------- timers -- */

let inSync = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(ms = 1500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    reconcileAll().catch((err) => console.error("Sync failed:", err));
  }, ms);
}

function onMutation(): void {
  if (inSync) return; // changes we made while reconciling need no re-trigger
  scheduleSync();
}

function onVisible(): void {
  if (typeof document !== "undefined" && !document.hidden) scheduleSync(0);
}

/* -------------------------------------------------------- meta helpers -- */

async function getMetaValue(key: string): Promise<string | null> {
  const r = await one(`SELECT value FROM meta WHERE key = ?`, [key]);
  return r ? String(r.value ?? "") : null;
}

async function setMetaValue(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/* ------------------------------------------------------ state for UI -- */

type SyncListener = (s: SyncState) => void;
const listeners = new Set<SyncListener>();

export function subscribeSyncState(l: SyncListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function buildState(): Promise<SyncState> {
  const configured = supabaseConfigured();
  let enabled = false;
  let lastSync: string | null = null;
  let lastError: string | null = null;
  if (configured) {
    const [en, last, err] = await Promise.all([
      getMetaValue(META_ENABLED),
      getMetaValue(META_LAST),
      getMetaValue(META_ERROR),
    ]);
    enabled = en === "1";
    lastSync = last && last !== "" ? last : null;
    lastError = err && err !== "" ? err : null;
  }
  return {
    configured,
    enabled,
    syncing: inSync,
    lastSync,
    lastError,
  };
}

async function emitState(): Promise<void> {
  const s = await buildState();
  for (const l of [...listeners]) {
    try {
      l(s);
    } catch {
      /* listener errors must not break the loop */
    }
  }
}

/** Hook wired once from the DataProvider: enables registry + initial sync. */
export function initSync(): Promise<void> {
  if (initDone) return initDone;
  initDone = doInit();
  return initDone;
}
let initDone: Promise<void> | null = null;

async function doInit(): Promise<void> {
  onMutate(onMutation);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  if (supabaseConfigured()) {
    // Public-access mode: sync is ON by default unless explicitly disabled.
    const cur = await getMetaValue(META_ENABLED);
    if (cur === null) await setMetaValue(META_ENABLED, "1");
  }
  await emitState();
  scheduleSync(500);
}

export function setSyncEnabled(enabled: boolean): Promise<void> {
  return setMetaValue(META_ENABLED, enabled ? "1" : "0").then(() => {
    if (enabled) scheduleSync(150);
    return emitState();
  });
}

/** Force an immediate full reconcile (the Settings "Sync now" button). */
export async function syncNow(): Promise<void> {
  emitState().catch(() => undefined);
  await reconcileAll();
  await emitState();
}

/* ------------------------------------------------------------ reconcile -- */

function tsMs(v: unknown): number {
  if (typeof v !== "string" || !v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function intBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function localToRemote(def: TableDef, l: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { updated_at: String(l.updated_at ?? "") };
  if (def.tombstone) out.deleted_at = null;
  for (const c of def.cols) {
    if (def.bools?.includes(c)) {
      out[c] = intBool(l[c]);
    } else if (def.payloadJsonToRemote && c === "payload_json") {
      try {
        out.payload = JSON.parse(String(l[c] ?? "{}"));
      } catch {
        out.payload = {};
      }
    } else {
      out[c] = l[c] ?? null;
    }
  }
  return out;
}

function remoteToLocal(def: TableDef, r: Record<string, unknown>): Row {
  const row: Row = {};
  for (const c of def.cols) {
    if (def.bools?.includes(c)) {
      row[c] = intBool(r[c]) ? 1 : 0;
    } else if (def.payloadJsonToRemote && c === "payload_json") {
      row[c] = r.payload == null ? "{}" : JSON.stringify(r.payload);
    } else {
      row[c] = (r[c] as string | null) ?? null;
    }
  }
  row.updated_at = typeof r.updated_at === "string" ? r.updated_at : nowISO();
  return row;
}

/**
 * UPSERT (id conflict) preserving child rows — safer than INSERT OR REPLACE.
 * The WHERE clause is the local LWW guard: an arriving row older than the row
 * we already hold is ignored (matching the server-side stale guard).
 */
function upsertStatements(
  def: TableDef,
  rows: Row[],
): Array<{ sql: string; params: SqlValue[] }> {
  if (!rows.length) return [];
  const cols = [...def.cols, "updated_at"];
  const sets = cols.map((c) => `${c} = excluded.${c}`);
  const sql = `INSERT INTO ${def.local} (${cols.join(", ")})
               VALUES (${cols.map(() => "?").join(", ")})
               ON CONFLICT(id) DO UPDATE SET ${sets.join(", ")}
               WHERE excluded.updated_at >= ${def.local}.updated_at`;
  return rows.map((row) => ({
    sql,
    params: cols.map((c) => (row[c] ?? null) as SqlValue),
  }));
}

async function reconcileTable(def: TableDef): Promise<{ pushed: number; pulled: number }> {
  const sb = getSupabase();
  if (!sb) return { pushed: 0, pulled: 0 };

  const localRows = await all(`SELECT * FROM ${def.local}`);
  const localMap = new Map<string, Row>(localRows.map((r) => [String(r.id), r]));

  const { data, error } = await sb.from(def.remote).select("*");
  if (error) throw new Error(`fetch ${def.remote}: ${error.message}`);
  const remoteRows = (data ?? []) as unknown as Record<string, unknown>[];
  const remoteMap = new Map<string, Record<string, unknown>>(
    remoteRows.map((r) => [String(r.id), r]),
  );

  const toPush: Record<string, unknown>[] = [];
  let pushed = 0;
  const localUpserts: Row[] = [];
  const localDeletes: string[] = [];
  let pulled = 0;

  // Rows this device deliberately deleted. They must never be pulled back here
  // (they are propagated up as soft-deletes by pushTombstones below).
  const tombRows = def.tombstone
    ? await all(`SELECT id FROM sync_tombstones WHERE tbl = ?`, [def.local])
    : [];
  const tombSet = new Set(tombRows.map((r) => String(r.id)));

  // Local -> remote (the local copy is the newer author).
  for (const l of localRows) {
    const id = String(l.id);
    const r = remoteMap.get(id);
    const lms = tsMs(l.updated_at);
    const rms = r ? tsMs(r.updated_at) : -1;
    const rDeleted = r ? tsMs(r.deleted_at) > 0 : false;
    if (!r || lms > rms || (lms > 0 && rDeleted && tsMs(r.deleted_at) < lms)) {
      toPush.push(localToRemote(def, l));
      pushed++;
    }
  }

  // Remote -> local.
  for (const r of remoteRows) {
    const id = String(r.id);
    const l = localMap.get(id);
    const rms = tsMs(r.updated_at);
    const rDeleted = tsMs(r.deleted_at) > 0;
    if (!l) {
      if (rDeleted || tombSet.has(id)) continue; // already gone locally
      localUpserts.push(remoteToLocal(def, r));
      pulled++;
      continue;
    }
    const lms = tsMs(l.updated_at);
    if (rms > lms) {
      if (rDeleted) {
        // Soft-deleted remotely -> gone for everyone, including this device.
        localDeletes.push(id);
      } else {
        localUpserts.push(remoteToLocal(def, r));
        pulled++;
      }
    }
  }

  // Apply local changes first so reads are consistent before pushing.
  await applyLocal(def, localUpserts, localDeletes);

  // Push changes up (unconditional conflict-update; server clock settles LWW).
  if (toPush.length) {
    const { error: upsertError } = await sb.from(def.remote).upsert(toPush, {
      onConflict: "id",
    });
    if (upsertError) throw new Error(`push ${def.remote}: ${upsertError.message}`);
  }

  // Propagate hard-deletes recorded on this device.
  if (def.tombstone) await pushTombstones(def, sb);

  return { pushed, pulled };
}

async function applyLocal(
  def: TableDef,
  upserts: Row[],
  deletes: string[],
): Promise<void> {
  const statements: Array<{ sql: string; params: SqlValue[] }> = upsertStatements(def, upserts);
  deletes.forEach((id) =>
    statements.push({ sql: `DELETE FROM ${def.local} WHERE id = ?`, params: [id] }),
  );
  if (!statements.length) return;
  try {
    await runBatch(statements);
  } catch (err) {
    // A single unroutable row (e.g. unique-invoice conflict) shouldn't block
    // the rest of the table; fall back to row-by-row and skip failures.
    console.warn(`Bulk apply for ${def.local} failed; retrying row-by-row.`, err);
    for (const s of statements) {
      try {
        await runBatch([s]);
      } catch (rowErr) {
        console.warn(`Skipping unroutable ${def.local} row:`, rowErr);
      }
    }
  }
}

async function pushTombstones(
  def: TableDef,
  sb: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<void> {
  const tombstones = await all(`SELECT * FROM sync_tombstones WHERE tbl = ?`, [def.local]);
  if (!tombstones.length) return;

  const { data: remoteRows } = await sb.from(def.remote).select("id, updated_at, deleted_at");
  const remoteMap = new Map<string, Record<string, unknown>>(
    ((remoteRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), r]),
  );

  for (const t of tombstones) {
    const id = String(t.id);
    const r = remoteMap.get(id);
    if (!r || tsMs(r.deleted_at) > 0 || tsMs(r.updated_at) >= tsMs(t.at)) {
      // Nothing online to delete, or it was already changed/deleted remotely.
      await run(`DELETE FROM sync_tombstones WHERE tbl = ? AND id = ?`, [def.local, id]);
      continue;
    }
    const { error } = await sb.from(def.remote).update({ deleted_at: String(t.at) }).eq("id", id);
    if (!error) {
      await run(`DELETE FROM sync_tombstones WHERE tbl = ? AND id = ?`, [def.local, id]);
    }
  }
}

/* ------------------------------------------------------------- driver -- */

export async function reconcileAll(): Promise<void> {
  if (!supabaseConfigured()) return;
  const enabledRaw = await getMetaValue(META_ENABLED);
  if (enabledRaw !== "1") return;

  if (inSync) {
    pending = true;
    return;
  }
  inSync = true;
  await emitState();
  try {
    for (const def of TABLES) {
      await reconcileTable(def);
    }
    await setMetaValue(META_LAST, nowISO());
    await setMetaValue(META_ERROR, "");

    // Provenance: record when this device last talked to the server.
    const sb = getSupabase();
    if (sb) {
      try {
        await sb
          .from("device_metadata")
          .upsert(
            { device_id: getDeviceId(), last_seen: new Date().toISOString() },
            { onConflict: "device_id" },
          );
      } catch {
        /* non-fatal provenance update */
      }
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    console.error("Sync error:", msg);
    await setMetaValue(META_ERROR, msg).catch(() => undefined);
  } finally {
    inSync = false;
    await emitState();
    if (pending) {
      pending = false;
      scheduleSync(150);
    }
  }
}

/* ------------------------------------------------------------ exports -- */

export { supabaseProjectRef };
export type { SyncState };