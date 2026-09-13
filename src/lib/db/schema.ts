import type { Database } from "sql.js";

export const SCHEMA_VERSION = 3;

/**
 * Base schema (v1). Newer columns/tables are added in runMigrations so the
 * same code path upgrades both fresh and existing databases.
 */
export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  monthly_price INTEGER NOT NULL,
  speed_mbps    INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  full_name  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  address    TEXT NOT NULL,
  plan_id    TEXT REFERENCES plans(id),
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installations (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  scheduled_date   TEXT,
  completed_date   TEXT,
  installer        TEXT,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  installation_fee INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  type         TEXT NOT NULL DEFAULT 'monthly',
  status       TEXT NOT NULL DEFAULT 'unpaid',
  due_date     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(customer_id, period_start, type)
);

CREATE TABLE IF NOT EXISTS payments (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount     INTEGER NOT NULL,
  method     TEXT NOT NULL DEFAULT 'cash',
  paid_at    TEXT NOT NULL,
  reference  TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_install_customer  ON installations(customer_id);
`;

const USERS_DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'collector', -- 'owner' | 'collector'
  pin_hash   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
`;

/** v3: audit trail, approval requests, metadata + tracked/soft-delete columns. */
function runMigration3(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      ts          TEXT NOT NULL,
      user_id     TEXT,
      action      TEXT NOT NULL,
      entity      TEXT NOT NULL,
      entity_id   TEXT,
      before_json TEXT,
      after_json  TEXT,
      device_id   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

    CREATE TABLE IF NOT EXISTS requests (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      payload_json  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
      requested_by  TEXT NOT NULL,
      requested_at  TEXT NOT NULL,
      decided_by    TEXT,
      decided_at    TEXT,
      decision_note TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // NOTE: ALTER TABLE ADD COLUMN is safe here because v1/v2 DDL above did not
  // include these columns, so every database passes through the same path.
  db.run(`ALTER TABLE customers ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  db.run(`ALTER TABLE customers ADD COLUMN archived_at TEXT`);

  db.run(`ALTER TABLE installations ADD COLUMN started_at TEXT`);
  db.run(`ALTER TABLE installations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  db.run(`ALTER TABLE installations ADD COLUMN archived_at TEXT`);

  db.run(`ALTER TABLE payments ADD COLUMN recorded_by TEXT`);
  db.run(`ALTER TABLE payments ADD COLUMN device_id TEXT`);
  db.run(`ALTER TABLE payments ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0`);
  db.run(`ALTER TABLE payments ADD COLUMN cancelled_at TEXT`);
  db.run(`ALTER TABLE payments ADD COLUMN cancel_reason TEXT`);
  db.run(`ALTER TABLE payments ADD COLUMN cancelled_by TEXT`);

  db.run(`ALTER TABLE users ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 0`);
}

/**
 * Runs pending migrations based on PRAGMA user_version.
 * Future schema changes: bump SCHEMA_VERSION and add a step here.
 */
export function runMigrations(db: Database): void {
  const res = db.exec("PRAGMA user_version");
  let current = Number(res[0]?.values?.[0]?.[0] ?? 0);

  if (current < 1) {
    db.run(DDL);
    current = 1;
  }

  if (current < 2) {
    db.run(USERS_DDL);
    current = 2;
  }

  if (current < 3) {
    runMigration3(db);
    current = 3;
  }

  if (current > 1) {
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  // Foreign key enforcement protects against orphaned records. sql.js opens
  // FKs off by default, so enable explicitly on every freshly opened engine.
  db.run("PRAGMA foreign_keys = ON");
}