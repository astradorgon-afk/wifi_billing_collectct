"use client";

import { useRef, useState } from "react";
import type { SqlValue } from "sql.js";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  listCustomers,
  listInvoices,
  listPayments,
  listInstallations,
  listAuditLog,
} from "@/lib/db/repository";
import {
  listUsers,
  createUser,
  setUserActive,
  resetUserPin,
  authenticate,
} from "@/lib/db/users";
import { exportDbBytes } from "@/lib/db/database";
import {
  buildBackup,
  downloadJSON,
  downloadCSV,
  downloadBytes,
  backupFilename,
  parseBackupFile,
} from "@/lib/backup";
import { fmtDate } from "@/lib/dates";
import { Card, Button, Badge, Spinner, Modal, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { supabaseProjectRef } from "@/lib/supabase";
import type { AuditLogEntry, User, UserRole } from "@/lib/types";

export default function SettingsPage() {
  const { state, isDemo, seedDemo, wipeAll, user, syncState, syncEnabled, syncNow } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [guard, setGuard] = useState<{ action: "wipe" | "restore"; file?: File } | null>(null);

  const users = useQuery<User[]>(() => listUsers(), []);
  const audit = useQuery<AuditLogEntry[]>(() => listAuditLog(200), []);

  const isOwner = user?.role === "owner";

  if (state === "loading") return <Spinner label="Opening local database…" />;

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onRestoreFile(file: File) {
    setGuard({ action: "restore", file });
  }

  async function restoreJsonBackup(backup: Awaited<ReturnType<typeof buildBackup>>) {
    const { getDb, saveNow } = await import("@/lib/db/database");
    const db = await getDb();
    type BackupRow = Record<string, SqlValue>;
    const t = {
      plans: backup.tables.plans as unknown as BackupRow[],
      customers: backup.tables.customers as unknown as BackupRow[],
      installations: backup.tables.installations as unknown as BackupRow[],
      invoices: backup.tables.invoices as unknown as BackupRow[],
      payments: backup.tables.payments as unknown as BackupRow[],
      users: (backup.tables.users ?? []) as unknown as BackupRow[],
      audit_log: (backup.tables.audit_log ?? []) as unknown as BackupRow[],
      meta: (backup.tables.meta ?? []) as unknown as BackupRow[],
    };
    db.run("BEGIN");
    try {
      db.run(`DELETE FROM payments`);
      db.run(`DELETE FROM invoices`);
      db.run(`DELETE FROM installations`);
      db.run(`DELETE FROM customers`);
      db.run(`DELETE FROM plans`);
      if (t.users.length) db.run(`DELETE FROM users`);
      if (t.audit_log.length) db.run(`DELETE FROM audit_log`);

      for (const r of t.plans)
        db.run(
          `INSERT INTO plans (id,name,monthly_price,speed_mbps,active) VALUES (?,?,?,?,?)`,
          [r.id, r.name, r.monthly_price, r.speed_mbps, r.active],
        );
      for (const r of t.customers)
        db.run(
          `INSERT INTO customers (id,full_name,phone,address,plan_id,status,archived,archived_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [r.id, r.full_name, r.phone, r.address, r.plan_id, r.status, r.archived ?? 0, r.archived_at ?? null, r.created_at],
        );
      for (const r of t.installations)
        db.run(
          `INSERT INTO installations (id,customer_id,scheduled_date,started_at,completed_date,installer,status,installation_fee,notes,archived,archived_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.customer_id, r.scheduled_date, r.started_at ?? null, r.completed_date, r.installer, r.status, r.installation_fee, r.notes, r.archived ?? 0, r.archived_at ?? null, r.created_at],
        );
      for (const r of t.invoices)
        db.run(
          `INSERT INTO invoices (id,customer_id,period_start,period_end,amount,type,status,due_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [r.id, r.customer_id, r.period_start, r.period_end, r.amount, r.type, r.status, r.due_date, r.created_at],
        );
      for (const r of t.payments)
        db.run(
          `INSERT INTO payments (id,invoice_id,amount,method,paid_at,reference,notes,recorded_by,device_id,cancelled,cancelled_at,cancel_reason,cancelled_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.invoice_id, r.amount, r.method, r.paid_at, r.reference, r.notes, r.recorded_by ?? null, r.device_id ?? null, r.cancelled ?? 0, r.cancelled_at ?? null, r.cancel_reason ?? null, r.cancelled_by ?? null, r.created_at],
        );
      for (const r of t.users)
        db.run(
          `INSERT OR IGNORE INTO users (id,username,name,role,pin_hash,active,must_change_pin,created_at) VALUES (?,?,?,?,?,?,?,?)`,
          [r.id, r.username, r.name, r.role, r.pin_hash, r.active ?? 1, r.must_change_pin ?? 0, r.created_at],
        );
      for (const r of t.audit_log)
        db.run(
          `INSERT OR IGNORE INTO audit_log (id,ts,user_id,action,entity,entity_id,before_json,after_json,device_id) VALUES (?,?,?,?,?,?,?,?,?)`,
          [r.id, r.ts, r.user_id, r.action, r.entity, r.entity_id, r.before_json, r.after_json, r.device_id],
        );
      for (const r of t.meta)
        db.run(
          `INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)`,
          [r.key, r.value],
        );

      db.run("COMMIT");
      await saveNow();
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Backups, users, audit trail, and maintenance.</p>
      </div>

      {msg && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-500/15 dark:text-blue-300">
          <Icon name={msg.startsWith("⚠️") ? "alert" : "check"} size={15} className="mt-0.5 shrink-0" />
          <span>{msg.replace(/^[✅⚠️]\s*/, "")}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* -------- User Accounts -------- */}
        <Card
          title="User accounts"
          subtitle="Who can sign in to this device"
          action={
            isOwner ? (
              <Button variant="secondary" onClick={() => setCreateOpen(true)} disabled={!!busy}>
                <Icon name="plus" size={14} />
                Add user
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-2">
            {(users.data ?? []).map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{u.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    @{u.username}
                    {u.must_change_pin && <span className="ml-1 text-amber-600 dark:text-amber-400">(PIN not changed)</span>}
                    {!u.active && <span className="ml-1 text-red-600 dark:text-red-400">(inactive)</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={u.role === "owner" ? "blue" : "slate"}>{u.role === "owner" ? "Owner" : "Collector"}</Badge>
                  {isOwner && u.id !== user?.id && (
                    <>
                      <Button variant="ghost" title="Reset PIN" onClick={async () => { setBusy("pin"); try { await resetUserPin(u.id); setMsg("✅ User must set a new PIN at next login."); users.refresh(); } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(null); } }}>
                        <Icon name="settings" size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        title={u.active ? "Deactivate" : "Activate"}
                        onClick={async () => { setBusy("act"); try { await setUserActive(u.id, !u.active); setMsg(`✅ User ${u.active ? "deactivated" : "activated"}.`); users.refresh(); } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(null); } }}
                      >
                        <Icon name={u.active ? "ban" : "check"} size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-slate-400 dark:text-slate-500">
              Collectors can manage customers and record payments; the owner has
              full access.
            </p>
          </div>
        </Card>

        {/* -------- Backup -------- */}
        <Card title="Backup" subtitle="Download a portable copy of your data">
          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={!!busy}
              onClick={() =>
                withBusy("json", async () => {
                  const backup = await buildBackup();
                  downloadJSON(backupFilename("json"), backup);
                  setMsg("✅ JSON backup downloaded.");
                })
              }
            >
              <Icon name="download" size={15} />
              Download backup (.json)
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              disabled={!!busy}
              onClick={() =>
                withBusy("sqlite", async () => {
                  const bytes = await exportDbBytes();
                  downloadBytes(backupFilename("sqlite"), bytes);
                  setMsg("✅ SQLite file downloaded.");
                })
              }
            >
              <Icon name="database" size={15} />
              Download database (.sqlite)
            </Button>
            <p className="pt-1 text-xs text-slate-400 dark:text-slate-500">
              Data lives only in this browser (IndexedDB). Keep regular backups —
              clearing browser data will erase it.
            </p>
          </div>
        </Card>

        {/* -------- Restore -------- */}
        <Card title="Restore" subtitle="Bring data back from a backup">
          <div className="space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  onRestoreFile(f);
                  e.target.value = "";
                }
              }}
            />
            <Button
              className="w-full"
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="restore" size={15} />
              Restore from .json backup
            </Button>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Restoring replaces <strong>all</strong> current data with the backup
              contents. A safety backup is downloaded automatically first.
            </p>
          </div>
        </Card>

        {/* -------- Audit log -------- */}
        <Card
          title="Audit log"
          subtitle="Recent data-changing actions"
          action={
            audit.data?.length ? (
              <Button variant="secondary" disabled={!!busy}
                onClick={() => withBusy("csv-audit", async () => downloadCSV(backupFilename("audit.csv"), (audit.data ?? []).map(r => ({ ts: r.ts, action: r.action, entity: r.entity, entity_id: r.entity_id, user_id: r.user_id, device_id: r.device_id }))))}
              >
                <Icon name="download" size={14} />
                CSV
              </Button>
            ) : undefined
          }
        >
          {audit.loading ? <Spinner /> : audit.data && audit.data.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">No actions logged yet.</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {(audit.data ?? []).slice(0, 100).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2 rounded px-2 py-1 text-xs">
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{(r.action as string).replace(".", " ")}</span>
                    {r.entity && <span className="ml-1 text-slate-400 dark:text-slate-500">on {r.entity}</span>}
                  </div>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">{fmtDate(r.ts.slice(0, 10))}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* -------- Online sync (Supabase) -------- */}
      <Card
        title="Online sync (Supabase)"
        subtitle="Share billing data between your PC, phone, and other devices"
        action={
          syncState.configured ? (
            <Badge tone={syncState.enabled ? "blue" : "slate"}>
              {syncState.enabled ? "Sync ON" : "Sync OFF"}
            </Badge>
          ) : undefined
        }
      >
        {!syncState.configured ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Not configured. Add <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env.local</code>, restart the dev server (or rebuild),
            and run <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">supabase/schema.sql</code> in the Supabase SQL editor.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">
                Project: <strong>{supabaseProjectRef() ?? "?"}</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Mode: public access (anon key, no login)
              </span>
            </div>

            {syncState.lastSync && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Last synced: {new Date(syncState.lastSync).toLocaleString()}
              </p>
            )}
            {syncState.lastError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Last sync failed: {syncState.lastError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => syncNow()} disabled={syncState.syncing || !syncState.enabled} className="min-w-36">
                <Icon name="refresh" size={15} />
                {syncState.syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                variant={syncState.enabled ? "secondary" : undefined}
                disabled={syncState.syncing}
                onClick={() => syncEnabled(!syncState.enabled)}
              >
                <Icon name={syncState.enabled ? "ban" : "check"} size={15} />
                {syncState.enabled ? "Pause sync" : "Turn sync on"}
              </Button>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500">
              Changes sync automatically (last-write-wins) whenever the app is open and online.
              User accounts and PINs are never uploaded. Because access is public, anyone with the
              anon key can read your billing data — keep the secret keys private.
            </p>
          </div>
        )}
      </Card>

      {/* -------- Export CSV -------- */}
      <Card title="Export CSV" subtitle="Spreadsheet-friendly exports">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="secondary" disabled={!!busy}
            onClick={() => withBusy("csv-c", async () => downloadCSV(backupFilename("customers.csv"), await listCustomers("")))}>
            Customers
          </Button>
          <Button variant="secondary" disabled={!!busy}
            onClick={() => withBusy("csv-i", async () => downloadCSV(backupFilename("invoices.csv"), await listInvoices()))}>
            Invoices
          </Button>
          <Button variant="secondary" disabled={!!busy}
            onClick={() => withBusy("csv-p", async () => downloadCSV(backupFilename("payments.csv"), await listPayments(100000)))}>
            Payments
          </Button>
          <Button variant="secondary" disabled={!!busy}
            onClick={() => withBusy("csv-s", async () => downloadCSV(backupFilename("installations.csv"), await listInstallations()))}>
            Installations
          </Button>
        </div>
      </Card>

      {/* -------- Maintenance -------- */}
      <Card title="Maintenance" subtitle="Demo data and danger zone">
        <div className="space-y-2">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!!busy}
            onClick={() =>
              withBusy("seed", async () => {
                if (!window.confirm("Replace current data with demo data?")) return;
                await seedDemo();
                setMsg("✅ Demo data loaded.");
              })
            }
          >
            <Icon name="refresh" size={15} />
            Load demo data
          </Button>
          <Button
            variant="danger"
            className="w-full"
            disabled={!!busy}
            onClick={() => setGuard({ action: "wipe" })}
          >
            <Icon name="trash" size={15} />
            Wipe all data
          </Button>
          {isDemo && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Demo data is currently loaded.</p>
          )}
        </div>
      </Card>

      <Card title="About">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <strong>WiFi Billing &amp; Collections</strong> — offline-first PWA.
          Your data lives in SQLite inside this browser; when online sync is enabled
          it also mirrors to your Supabase project so your devices stay in step.
        </p>
      </Card>

      {isOwner && (
        <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); users.refresh(); }} />
      )}

      <ReauthModal
        open={!!guard}
        action={(guard?.action ?? "wipe") as "wipe" | "restore"}
        onCancel={() => setGuard(null)}
        onConfirm={() => {
          const g = guard;
          setGuard(null);
          if (!g) return;
          if (g.action === "wipe") {
            withBusy("wipe", async () => {
              await wipeAll();
              setMsg("✅ All data wiped.");
            });
          } else if (g.file) {
            withBusy("restore", async () => {
              const pre = await buildBackup();
              downloadJSON(backupFilename("json"), pre);
              const backup = await parseBackupFile(g.file as File);
              await restoreJsonBackup(backup);
              setMsg("✅ Backup restored (a safety backup was downloaded first).");
            });
          }
        }}
      />
    </div>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("collector");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await createUser({ username, name, role, pin });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Add user" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" />
        </Field>
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="collector">Collector</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
        <Field label="Initial PIN" hint="The user will be required to change this PIN at first login.">
          <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
        </Field>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !username || !name || !pin}>{busy ? "Creating…" : "Create user"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ReauthModal({
  open,
  action,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  action: "wipe" | "restore";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { user } = useData();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!user) return;
    setBusy(true);
    setErr(null);
    try {
      const ok = await authenticate(user.username, pin);
      if (!ok) {
        setErr("Incorrect PIN. Try again.");
        setPin("");
        return;
      }
      setPin("");
      onConfirm();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={action === "wipe" ? "Confirm wipe" : "Confirm restore"} onClose={onCancel}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {action === "wipe"
            ? "Enter your PIN to delete ALL data. This cannot be undone."
            : "Enter your PIN to restore the backup and replace all current data."}
        </p>
        <Field label="Your PIN">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </Field>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={action === "wipe" ? "danger" : undefined} onClick={submit} disabled={busy || !pin}>
            {busy ? "Checking…" : "Continue"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}