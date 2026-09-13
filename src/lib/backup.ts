import { all, one } from "./db/database";
import { todayISO } from "./dates";

export type BackupFile = {
  app: "wifi-billing";
  version: 1 | 2;
  exported_at: string;
  device: string;
  tables: {
    plans: Record<string, unknown>[];
    customers: Record<string, unknown>[];
    installations: Record<string, unknown>[];
    invoices: Record<string, unknown>[];
    payments: Record<string, unknown>[];
    users?: Record<string, unknown>[];
    audit_log?: Record<string, unknown>[];
    meta?: Record<string, unknown>[];
  };
};

export async function buildBackup(): Promise<BackupFile> {
  const [plans, customers, installations, invoices, payments, users, audit, meta, dev] =
    await Promise.all([
      all(`SELECT * FROM plans ORDER BY rowid`),
      all(`SELECT * FROM customers ORDER BY rowid`),
      all(`SELECT * FROM installations ORDER BY rowid`),
      all(`SELECT * FROM invoices ORDER BY rowid`),
      all(`SELECT * FROM payments ORDER BY rowid`),
      all(`SELECT * FROM users ORDER BY rowid`),
      all(`SELECT * FROM audit_log ORDER BY rowid`),
      all(`SELECT * FROM meta ORDER BY rowid`),
      one(`SELECT value FROM meta WHERE key = 'device_id'`),
    ]);
  return {
    app: "wifi-billing",
    version: 2,
    exported_at: new Date().toISOString(),
    device: (dev?.value as string) ?? "unknown",
    tables: { plans, customers, installations, invoices, payments, users, audit_log: audit, meta },
  };
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCSV<T extends object>(filename: string, rows: T[]): void {
  const records = rows as unknown as Record<string, unknown>[];
  if (!records.length) {
    window.alert("Nothing to export.");
    return;
  }
  const headers = Object.keys(records[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...records.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function backupFilename(ext: string): string {
  return `wifi-billing-backup-${todayISO()}.${ext}`;
}

/** Validate + parse an uploaded backup file. Accepts v1 and v2. Throws on malformed input. */
export async function parseBackupFile(file: File): Promise<BackupFile> {
  const text = await file.text();
  const data = JSON.parse(text) as BackupFile;
  if (
    !data ||
    data.app !== "wifi-billing" ||
    !data.tables ||
    typeof data.version !== "number" ||
    data.version < 1 ||
    data.version > 2
  ) {
    throw new Error("Not a valid WiFi Billing backup file.");
  }
  return data;
}