"use client";

import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { runMigrations } from "./schema";

/**
 * SQLite-in-the-browser via sql.js (WASM), persisted as a single binary
 * blob in IndexedDB. Every mutating batch bumps a monotonic `revision`;
 * the blob and the revision are written together in one IndexedDB
 * transaction so readers can detect stale overwrites across tabs.
 */

const DB_KEY = "wifi-billing-db-v1";
const META_KEY = "wifi-billing-meta-v1";
const IDB_NAME = "wifi-billing";
const IDB_STORE = "kv";
const SAVE_DEBOUNCE_MS = 300;
const SYNC_CHANNEL = "wifi-billing:db-sync";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let idb: IDBDatabase | null = null;
let idbReady: Promise<IDBDatabase> | null = null;

/** Revision this engine loaded from disk (the baseline we build on). */
let baseRevision = 0;
/** Revision including our own unsaved writes. */
let currentRevision = 0;

/** Called whenever a persistence failure/conflict is detected so the UI can warn. */
let onSaveFailure: ((msg: string) => void) | null = null;
export function setSaveFailureHandler(fn: (msg: string) => void): void {
  onSaveFailure = fn;
}

/* ------------------------------------------------------ mutation hooks -- */

/** Notified after every successful DB write (used by the online sync engine). */
type MutationCb = () => void;
const mutationCbs: MutationCb[] = [];
export function onMutate(cb: MutationCb): () => void {
  mutationCbs.push(cb);
  return () => {
    const i = mutationCbs.indexOf(cb);
    if (i >= 0) mutationCbs.splice(i, 1);
  };
}

function fireMutation(): void {
  for (const cb of mutationCbs) {
    try {
      cb();
    } catch {
      /* a hook must never break the write */
    }
  }
}

/**
 * BroadcastChannel so open tabs reload after another tab persists.
 * A tab does not receive its own messages, so writers are unaffected.
 */
const dbSync =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(SYNC_CHANNEL)
    : null;

export { dbSync };

/* ----------------------------------------------------------- IndexedDB -- */

function openIDB(): Promise<IDBDatabase> {
  if (idb) return Promise.resolve(idb);
  if (idbReady) return idbReady;
  idbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      idb = req.result;
      resolve(idb);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return idbReady;
}

function idbTxnGet(keys: string[]): Promise<Record<string, unknown>> {
  return openIDB().then(
    (conn) =>
      new Promise((resolve, reject) => {
        const tx = conn.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const out: Record<string, unknown> = {};
        keys.forEach((k) => {
          const req = store.get(k);
          req.onsuccess = () => {
            out[k] = req.result;
          };
          req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
        });
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read tx failed"));
      }),
  );
}

async function idbGet(key: string): Promise<unknown> {
  const all = await idbTxnGet([key]);
  return all[key];
}

/** Persist the blob + meta atomically in a single IndexedDB transaction. */
async function idbCommit(blobKey: string, blob: Uint8Array, metaKey: string, meta: string): Promise<void> {
  const conn = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    store.put(blob, blobKey);
    store.put(meta, metaKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB commit failed"));
  });
}

/* ------------------------------------------------------------- engine --- */

async function createEngine(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      file.endsWith(".wasm") ? `/sqljs/${file}` : file,
  });

  const stored = await idbTxnGet([DB_KEY, META_KEY]);
  const saved = stored[DB_KEY];
  const metaRaw = stored[META_KEY];
  const database = saved ? new SQL.Database(saved as Uint8Array) : new SQL.Database();
  runMigrations(database);
  baseRevision = parseMetaRevision(metaRaw);
  currentRevision = baseRevision;
  return database;
}

function parseMetaRevision(metaRaw: unknown): number {
  try {
    const meta = JSON.parse(String(metaRaw ?? "{}")) as { revision?: number };
    return typeof meta.revision === "number" ? meta.revision : 0;
  } catch {
    return 0;
  }
}

/** Returns the singleton database, initializing on first call. */
export function getDb(): Promise<Database> {
  if (!initPromise) {
    initPromise = createEngine().then((d) => {
      db = d;
      return d;
    });
  }
  return initPromise;
}

function reportFailure(msg: string): void {
  try {
    onSaveFailure?.(msg);
  } catch {
    /* handler is best-effort */
  }
}

/**
 * Dump + persist the database blob and its revision to IndexedDB.
 * If another tab has already advanced the persisted revision past the
 * baseline this engine loaded, we refuse to overwrite (protecting that
 * tab's data) and reload instead — surfaced to the UI as a conflict.
 */
export async function saveNow(): Promise<void> {
  if (!db) return;

  const stored = (await idbGet(META_KEY)) ?? null;
  const storedRevision = parseMetaRevision(stored);

  if (storedRevision > baseRevision) {
    reportFailure(
      "Another tab updated this database. Your last change was not saved — reloading to the latest data.",
    );
    await reloadDb();
    throw new Error(
      "DB conflict: another tab updated the database first; this tab reloaded to avoid overwriting it.",
    );
  }

  const data = db.export();
  const meta = JSON.stringify({ revision: currentRevision, savedAt: new Date().toISOString() });
  await idbCommit(DB_KEY, data, META_KEY, meta);
  baseRevision = currentRevision;
  dbSync?.postMessage("db-changed");
}

/**
 * Dispose the in-memory database and reload the persisted copy.
 * Used by other tabs after a write so every tab shares the same state.
 */
export async function reloadDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      file.endsWith(".wasm") ? `/sqljs/${file}` : file,
  });
  const stored = await idbTxnGet([DB_KEY, META_KEY]);
  const saved = stored[DB_KEY];
  const metaRaw = stored[META_KEY];
  const next = saved ? new SQL.Database(saved as Uint8Array) : new SQL.Database();
  runMigrations(next);
  db?.close();
  db = next;
  const revision = parseMetaRevision(metaRaw);
  baseRevision = revision;
  currentRevision = revision;
  initPromise = Promise.resolve(next);
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow().catch((err) => {
      console.error("DB autosave failed:", err);
      reportFailure("Autosave failed. Open Settings and download a backup, then retry.");
    });
  }, SAVE_DEBOUNCE_MS);
}

/** Flush any pending autosave (call on visibilitychange/beforeunload). */
export function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow().catch((err) => console.error("DB flush failed:", err));
  }
}

/* ------------------------------------------------------------- helpers -- */

export type Row = Record<string, SqlValue>;

/** SELECT returning typed row objects. */
export async function all<T extends Row = Row>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  const d = await getDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

/** SELECT returning the first row or null. */
export async function one<T extends Row = Row>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  const rows = await all<T>(sql, params);
  return rows[0] ?? null;
}

function bumpRevision(): void {
  currentRevision += 1;
}

/**
 * INSERT/UPDATE/DELETE inside an implicit transaction, then autosave.
 * Pass `{ immediate: true }` for money-critical ops so the blob is
 * persisted before the caller reports success.
 */
export async function run(
  sql: string,
  params: SqlValue[] = [],
  opts: { immediate?: boolean } = {},
): Promise<void> {
  const d = await getDb();
  d.run("BEGIN");
  try {
    d.run(sql, params);
    d.run("COMMIT");
  } catch (err) {
    d.run("ROLLBACK");
    throw err;
  }
  bumpRevision();
  fireMutation();
  if (opts.immediate) await saveNow().catch((e) => console.error("Immediate save failed:", e));
  else scheduleSave();
}

/** Run a batch of statements in one transaction, then autosave. */
export async function runBatch(
  statements: Array<{ sql: string; params?: SqlValue[] }>,
  opts: { immediate?: boolean } = {},
): Promise<void> {
  const d = await getDb();
  d.run("BEGIN");
  try {
    for (const s of statements) d.run(s.sql, s.params ?? []);
    d.run("COMMIT");
  } catch (err) {
    d.run("ROLLBACK");
    throw err;
  }
  bumpRevision();
  fireMutation();
  if (opts.immediate) await saveNow().catch((e) => console.error("Immediate save failed:", e));
  else scheduleSave();
}

/* ------------------------------------------------------- backup helpers - */

/** Raw SQLite file bytes (for .sqlite download). */
export async function exportDbBytes(): Promise<Uint8Array> {
  const d = await getDb();
  return d.export();
}

/** Replace the entire database with a .sqlite file's contents. */
export async function importDbBytes(bytes: Uint8Array): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => (file.endsWith(".wasm") ? `/sqljs/${file}` : file),
  });
  const next = new SQL.Database(bytes);
  runMigrations(next);
  db?.close();
  db = next;
  initPromise = Promise.resolve(next);
  // The imported snapshot supersedes whatever revision this browser had;
  // persist it immediately so the new blob becomes the baseline.
  const stored = (await idbGet(META_KEY)) ?? null;
  baseRevision = parseMetaRevision(stored);
  currentRevision = baseRevision;
  await saveNow();
}

/** Wipe everything (drop all rows + fresh schema), used by Settings danger zone. */
export async function resetDb(): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => (file.endsWith(".wasm") ? `/sqljs/${file}` : file),
  });
  const next = new SQL.Database();
  db?.close();
  db = next;
  runMigrations(next);
  baseRevision = 0;
  currentRevision = 0;
  initPromise = Promise.resolve(next);
  await saveNow();
}