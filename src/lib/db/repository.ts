import { all, one, runBatch } from "./database";
import { addDays, monthRange, nowISO, todayISO } from "../dates";
import { auditStatement } from "./audit";
import type { SqlValue } from "sql.js";
import type {
  ApprovalRequest,
  AuditLogEntry,
  BillingHealth,
  Customer,
  CustomerInput,
  CustomerWithPlan,
  DashboardStats,
  Installation,
  InstallationInput,
  InstallationStatus,
  InstallationWithCustomer,
  InvoiceStatus,
  InvoiceType,
  InvoiceWithMeta,
  Payment,
  PaymentInput,
  PaymentMethod,
  PaymentWithMeta,
  Plan,
  PlanInput,
  RequestStatus,
  RequestType,
} from "../types";

/* ------------------------------------------------------------- helpers -- */

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

/** Payments that still count towards an invoice's balance. */
const ACTIVE_PAYMENTS = "p.cancelled = 0";

/* --------------------------------------------------------------- plans -- */

export async function listPlans(activeOnly = false): Promise<Plan[]> {
  const rows = await all(
    `SELECT * FROM plans ${activeOnly ? "WHERE active = 1" : ""} ORDER BY monthly_price ASC`,
  );
  return rows.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    monthly_price: num(r.monthly_price),
    speed_mbps: num(r.speed_mbps),
    active: num(r.active),
  }));
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  const plan: Plan = { id: uid(), active: 1, ...input };
  await runBatch(
    [
      {
        sql: `INSERT INTO plans (id, name, monthly_price, speed_mbps, active, updated_at) VALUES (?,?,?,?,?,?)`,
        params: [plan.id, plan.name, plan.monthly_price, plan.speed_mbps, plan.active, nowISO()],
      },
      auditStatement("plan.created", "plans", plan.id, null, plan),
    ],
    { immediate: true },
  );
  return plan;
}

/* ----------------------------------------------------------- customers -- */

/**
 * Outstanding balance for a customer = sum over unpaid/partial invoices of
 * (invoice amount − payments on THAT invoice). Payments made against paid
 * invoices must never be deducted from unpaid invoices, otherwise any
 * customer with a settled history shows a phantom zero balance.
 */
const CUSTOMER_BALANCE_SQL = `
  COALESCE((
    SELECT SUM(i.amount) - COALESCE((
      SELECT SUM(p.amount) FROM payments p
      WHERE ${ACTIVE_PAYMENTS} AND p.invoice_id IN (
        SELECT id FROM invoices i2
        WHERE i2.customer_id = c.id AND i2.status IN ('unpaid','partial')
      )
    ), 0)
    FROM invoices i
    WHERE i.customer_id = c.id AND i.status IN ('unpaid','partial')
  ), 0)
`;

export async function listCustomers(search = ""): Promise<CustomerWithPlan[]> {
  const q = `%${search.trim()}%`;
  const rows = await all(
    `SELECT c.*, pl.name AS plan_name, pl.monthly_price, pl.speed_mbps,
            ${CUSTOMER_BALANCE_SQL} AS balance
     FROM customers c
     LEFT JOIN plans pl ON pl.id = c.plan_id
     WHERE c.archived = 0 AND (? = '' OR c.full_name LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)
     ORDER BY c.full_name COLLATE NOCASE ASC`,
    [search.trim(), q, q, q],
  );
  return rows.map((r) => ({
    id: str(r.id),
    full_name: str(r.full_name),
    phone: str(r.phone),
    address: str(r.address),
    plan_id: (r.plan_id as string) ?? null,
    status: str(r.status) as Customer["status"],
    created_at: str(r.created_at),
    archived: num(r.archived),
    archived_at: (r.archived_at as string) ?? null,
    plan_name: (r.plan_name as string) ?? null,
    monthly_price: r.monthly_price == null ? null : num(r.monthly_price),
    speed_mbps: r.speed_mbps == null ? null : num(r.speed_mbps),
    balance: num(r.balance),
  }));
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const r = await one(`SELECT * FROM customers WHERE id = ?`, [id]);
  return r
    ? {
        id: str(r.id),
        full_name: str(r.full_name),
        phone: str(r.phone),
        address: str(r.address),
        plan_id: (r.plan_id as string) ?? null,
        status: str(r.status) as Customer["status"],
        created_at: str(r.created_at),
        archived: num(r.archived),
        archived_at: (r.archived_at as string) ?? null,
      }
    : null;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const c: Customer = { id: uid(), created_at: nowISO(), archived: 0, archived_at: null, ...input };
  await runBatch(
    [
      {
        sql: `INSERT INTO customers (id, full_name, phone, address, plan_id, status, archived, archived_at, created_at, updated_at)
             VALUES (?,?,?,?,?,?,0,NULL,?,?)`,
        params: [c.id, c.full_name, c.phone, c.address, c.plan_id, c.status, c.created_at, c.created_at],
      },
      auditStatement("customer.created", "customers", c.id, null, c),
    ],
    { immediate: true },
  );
  return c;
}

export async function updateCustomer(
  id: string,
  input: CustomerInput,
): Promise<void> {
  const before = await getCustomer(id);
  await runBatch(
    [
      {
        sql: `UPDATE customers SET full_name=?, phone=?, address=?, plan_id=?, status=?, updated_at=? WHERE id=?`,
        params: [input.full_name, input.phone, input.address, input.plan_id, input.status, nowISO(), id],
      },
      auditStatement("customer.updated", "customers", id, before, input),
    ],
    { immediate: true },
  );
}

/** Soft-delete: hides the customer from lists while preserving all history. */
export async function archiveCustomer(id: string): Promise<void> {
  const before = await getCustomer(id);
  if (!before) throw new Error("Customer not found");
  await runBatch(
    [
      {
        sql: `UPDATE customers SET archived=1, archived_at=?, updated_at=? WHERE id=?`,
        params: [nowISO(), nowISO(), id],
      },
      auditStatement("customer.archived", "customers", id, before, null),
    ],
    { immediate: true },
  );
}

/** Hard delete — allowed ONLY when no invoices/payments/installations exist. */
export async function deleteCustomer(id: string): Promise<void> {
  const r = await one(
    `SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id=?) +
            (SELECT COUNT(*) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.customer_id=?) +
            (SELECT COUNT(*) FROM installations WHERE customer_id=?) AS n`,
    [id, id, id],
  );
  if (num(r?.n) > 0) {
    throw new Error("Customer has billing or installation history — archive instead of deleting.");
  }
  const before = await getCustomer(id);
  await runBatch(
    [
      { sql: `DELETE FROM installations WHERE customer_id=?`, params: [id] },
      { sql: `DELETE FROM customers WHERE id=?`, params: [id] },
      {
        sql: `INSERT INTO sync_tombstones (tbl, id, at) VALUES ('customers', ?, ?)`,
        params: [id, nowISO()],
      },
      auditStatement("customer.deleted", "customers", id, before, null),
    ],
    { immediate: true },
  );
}

/* ------------------------------------------------------- installations -- */

export async function listInstallations(
  status?: InstallationStatus,
): Promise<InstallationWithCustomer[]> {
  const rows = await all(
    `SELECT ins.*, c.full_name AS customer_name, c.phone AS customer_phone
     FROM installations ins JOIN customers c ON c.id = ins.customer_id
     WHERE ins.archived = 0 AND (? IS NULL OR ins.status = ?)
     ORDER BY CASE WHEN ins.status = 'scheduled' THEN 0
                   WHEN ins.status = 'in_progress' THEN 1 ELSE 2 END,
              ins.scheduled_date ASC`,
    [status ?? null, status ?? null],
  );
  return rows.map((r) => ({
    id: str(r.id),
    customer_id: str(r.customer_id),
    scheduled_date: (r.scheduled_date as string) ?? null,
    started_at: (r.started_at as string) ?? null,
    completed_date: (r.completed_date as string) ?? null,
    installer: (r.installer as string) ?? null,
    status: str(r.status) as InstallationStatus,
    installation_fee: num(r.installation_fee),
    notes: (r.notes as string) ?? null,
    created_at: str(r.created_at),
    archived: num(r.archived),
    archived_at: (r.archived_at as string) ?? null,
    customer_name: str(r.customer_name),
    customer_phone: str(r.customer_phone),
  }));
}

export async function createInstallation(input: InstallationInput): Promise<Installation> {
  const ins: Installation = {
    id: uid(),
    scheduled_date: input.scheduled_date,
    started_at: null,
    completed_date: null,
    status: "scheduled",
    installation_fee: input.installation_fee,
    notes: input.notes,
    created_at: nowISO(),
    archived: 0,
    archived_at: null,
    customer_id: input.customer_id,
    installer: input.installer,
  };
  await runBatch(
    [
      {
        sql: `INSERT INTO installations
               (id, customer_id, scheduled_date, started_at, completed_date, installer, status, installation_fee, notes, archived, archived_at, created_at, updated_at)
             VALUES (?,?,?,NULL,NULL,?,?,?,?,0,NULL,?,?)`,
        params: [
          ins.id,
          ins.customer_id,
          ins.scheduled_date,
          ins.installer,
          ins.status,
          ins.installation_fee,
          ins.notes,
          ins.created_at,
          ins.created_at,
        ],
      },
      auditStatement("installation.created", "installations", ins.id, null, ins),
    ],
    { immediate: true },
  );
  return ins;
}

export async function updateInstallation(
  id: string,
  input: { scheduled_date: string | null; installer: string; installation_fee: number; notes: string },
): Promise<void> {
  const before = await one(`SELECT * FROM installations WHERE id=?`, [id]);
  await runBatch(
    [
      {
        sql: `UPDATE installations SET scheduled_date=?, installer=?, installation_fee=?, notes=?, updated_at=? WHERE id=?`,
        params: [input.scheduled_date, input.installer, input.installation_fee, input.notes, nowISO(), id],
      },
      auditStatement("installation.updated", "installations", id, before, input),
    ],
    { immediate: true },
  );
}

export async function setInstallationStatus(
  id: string,
  status: InstallationStatus,
): Promise<void> {
  const ins = await one(`SELECT * FROM installations WHERE id=?`, [id]);
  if (!ins) throw new Error("Installation not found");

  const statements: Array<{ sql: string; params?: SqlValue[] }> = [
    {
      sql: `UPDATE installations SET status=?, started_at=COALESCE(started_at, ?),
              completed_date=?, updated_at=? WHERE id=?`,
      params: [
        status,
        status === "in_progress" || status === "completed" ? nowISO() : null,
        status === "completed" ? todayISO() : null,
        nowISO(),
        id,
      ],
    },
  ];

  // Completing an install creates a one-time installation invoice (idempotent).
  if (status === "completed" && str(ins.status) !== "completed") {
    const fee = num(ins.installation_fee);
    if (fee > 0) {
      const today = todayISO();
      statements.push({
        sql: `INSERT OR IGNORE INTO invoices
                (id, customer_id, period_start, period_end, amount, type, status, due_date, created_at, updated_at)
              VALUES (?,?,?,?,?,'installation','unpaid',?,?,?)`,
        params: [uid(), str(ins.customer_id), today, today, fee, addDays(today, 7), nowISO(), nowISO()],
      });
    }
  }

  statements.push(
    auditStatement("installation.status", "installations", id, ins, { status }),
  );

  await runBatch(statements, { immediate: true });
}

/** Archived (soft-delete): preserves the job record + its invoices. */
export async function deleteInstallation(id: string): Promise<void> {
  const before = await one(`SELECT * FROM installations WHERE id=?`, [id]);
  await runBatch(
    [
      {
        sql: `UPDATE installations SET archived=1, archived_at=?, updated_at=? WHERE id=?`,
        params: [nowISO(), nowISO(), id],
      },
      auditStatement("installation.archived", "installations", id, before, null),
    ],
    { immediate: true },
  );
}

/* ------------------------------------------------------------- invoices -- */

function invoiceNo(id: string, createdAt: string): string {
  return `INV-${createdAt.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 6).toUpperCase()}`;
}

function mapInvoice(r: Record<string, SqlValue>): InvoiceWithMeta {
  const amount = num(r.amount);
  const paid = num(r.paid);
  return {
    id: str(r.id),
    customer_id: str(r.customer_id),
    period_start: str(r.period_start),
    period_end: str(r.period_end),
    amount,
    type: str(r.type) as InvoiceType,
    status: str(r.status) as InvoiceStatus,
    due_date: str(r.due_date),
    created_at: str(r.created_at),
    customer_name: str(r.customer_name),
    paid,
    balance: r.status === "void" ? 0 : amount - paid,
    invoice_no: invoiceNo(str(r.id), str(r.created_at)),
  };
}

export async function listInvoices(filters?: {
  status?: InvoiceStatus | "all";
  month?: string;
}): Promise<InvoiceWithMeta[]> {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (filters?.status && filters.status !== "all") {
    clauses.push(`i.status = ?`);
    params.push(filters.status);
  }
  if (filters?.month) {
    clauses.push(`i.period_start LIKE ?`);
    params.push(`${filters.month}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await all(
    `SELECT i.*, c.full_name AS customer_name,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE ${ACTIVE_PAYMENTS} AND p.invoice_id = i.id), 0) AS paid
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     ${where}
     ORDER BY i.created_at DESC, i.id DESC`,
    params,
  );
  return rows.map(mapInvoice);
}

export async function getInvoice(id: string): Promise<InvoiceWithMeta | null> {
  const r = await one(
    `SELECT i.*, c.full_name AS customer_name,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE ${ACTIVE_PAYMENTS} AND p.invoice_id = i.id), 0) AS paid
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.id = ?`,
    [id],
  );
  return r ? mapInvoice(r) : null;
}

/**
 * Generate monthly invoices for all active customers for `month` ("YYYY-MM").
 * Idempotent via UNIQUE(customer_id, period_start, type). Voided monthly
 * invoices are regenerated (void is reversible bookkeeping, not a billing lock).
 */
export async function generateMonthlyInvoices(
  month: string,
  dueDay = 15,
): Promise<number> {
  const { start, end } = monthRange(month);
  const customers = await all(
    `SELECT c.id, pl.monthly_price
     FROM customers c JOIN plans pl ON pl.id = c.plan_id
     WHERE c.status = 'active' AND c.archived = 0`,
  );
  const due = `${month}-${String(Math.min(dueDay, new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate())).padStart(2, "0")}`;

  const existing = await all(
    `SELECT customer_id FROM invoices WHERE type='monthly' AND period_start = ? AND status != 'void'`,
    [start],
  );
  const already = new Set(existing.map((r) => str(r.customer_id)));

  const statements: Array<{ sql: string; params?: SqlValue[] }> = customers
    .filter((c) => !already.has(str(c.id)))
    .map((c) => ({
      sql: `INSERT INTO invoices
              (id, customer_id, period_start, period_end, amount, type, status, due_date, created_at, updated_at)
            VALUES (?,?,?,?,?,'monthly','unpaid',?,?,?)`,
      params: [
        uid(),
        str(c.id),
        start,
        end,
        num(c.monthly_price),
        due,
        nowISO(),
        nowISO(),
      ],
    }));

  if (!statements.length) return 0;

  statements.push(
    auditStatement("invoice.generated", "invoices", null, null, {
      month,
      created: statements.length - 1,
    }),
  );
  await runBatch(statements, { immediate: true });
  return statements.length - 1;
}

export async function voidInvoice(id: string): Promise<void> {
  const inv = await one(`SELECT * FROM invoices WHERE id=?`, [id]);
  if (!inv) throw new Error("Invoice not found");
  const paid = await one(
    `SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE invoice_id=? AND cancelled=0`,
    [id],
  );
  if (num(paid?.n) > 0) {
    throw new Error(
      "This invoice has recorded payments. Reverse the payments first, then void it.",
    );
  }
  await runBatch(
    [
      { sql: `UPDATE invoices SET status='void', updated_at=? WHERE id=?`, params: [nowISO(), id] },
      auditStatement("invoice.voided", "invoices", id, inv, { status: "void" }),
    ],
    { immediate: true },
  );
}

/* ------------------------------------------------------------- payments -- */

export async function listPayments(limit = 100): Promise<PaymentWithMeta[]> {
  const rows = await all(
    `SELECT p.*, i.amount AS invoice_amount,
            c.full_name AS customer_name, c.id AS customer_id,
            u.name AS recorded_by_name,
            COALESCE((SELECT SUM(p2.amount) FROM payments p2
              WHERE ${ACTIVE_PAYMENTS} AND p2.invoice_id = p.invoice_id AND p2.rowid < p.rowid), 0) AS paid_before
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN customers c ON c.id = i.customer_id
     LEFT JOIN users u ON u.id = p.recorded_by
     ORDER BY p.paid_at DESC, p.rowid DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => {
    const amount = num(r.amount);
    return {
      id: str(r.id),
      invoice_id: str(r.invoice_id),
      amount,
      method: str(r.method) as PaymentMethod,
      paid_at: str(r.paid_at),
      reference: (r.reference as string) ?? null,
      notes: (r.notes as string) ?? null,
      created_at: str(r.created_at),
      recorded_by: (r.recorded_by as string) ?? null,
      device_id: (r.device_id as string) ?? null,
      cancelled: num(r.cancelled),
      cancelled_at: (r.cancelled_at as string) ?? null,
      cancel_reason: (r.cancel_reason as string) ?? null,
      cancelled_by: (r.cancelled_by as string) ?? null,
      invoice_no: invoiceNo(str(r.invoice_id), str(r.created_at)),
      customer_name: str(r.customer_name),
      customer_id: str(r.customer_id),
      invoice_amount: num(r.invoice_amount),
      invoice_balance: num(r.invoice_amount) - num(r.paid_before),
      recorded_by_name: (r.recorded_by_name as string) ?? null,
    };
  });
}

/** Balance of an invoice right now (counting only live payments). */
export async function invoiceBalance(invoiceId: string): Promise<number> {
  const r = await one(
    `SELECT i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p
      WHERE ${ACTIVE_PAYMENTS} AND p.invoice_id = i.id), 0) AS bal
     FROM invoices i WHERE i.id = ?`,
    [invoiceId],
  );
  return num(r?.bal);
}

export async function recordPayment(input: PaymentInput): Promise<Payment> {
  const balance = await invoiceBalance(input.invoice_id);
  if (input.amount <= 0) throw new Error("Amount must be greater than zero.");
  if (input.amount > balance) {
    throw new Error(
      `Amount exceeds outstanding balance (${(balance / 100).toFixed(2)}).`,
    );
  }

  const payment: Payment = {
    id: uid(),
    invoice_id: input.invoice_id,
    amount: input.amount,
    method: input.method,
    paid_at: nowISO(),
    reference: input.reference || null,
    notes: input.notes || null,
    created_at: nowISO(),
    recorded_by: input.recorded_by ?? null,
    device_id: input.device_id ?? null,
    cancelled: 0,
    cancelled_at: null,
    cancel_reason: null,
    cancelled_by: null,
  };

  const remaining = balance - input.amount;

  await runBatch(
    [
      {
        sql: `INSERT INTO payments (id, invoice_id, amount, method, paid_at, reference, notes,
                recorded_by, device_id, cancelled, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`,
        params: [
          payment.id,
          payment.invoice_id,
          payment.amount,
          payment.method,
          payment.paid_at,
          payment.reference,
          payment.notes,
          payment.recorded_by,
          payment.device_id,
          payment.created_at,
          payment.created_at,
        ],
      },
      {
        sql: `UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?`,
        params: [remaining <= 0 ? "paid" : "partial", nowISO(), input.invoice_id],
      },
      auditStatement("payment.created", "payments", payment.id, null, {
        invoice_id: input.invoice_id,
        amount: payment.amount,
        method: payment.method,
      }),
    ],
    { immediate: true },
  );
  return payment;
}

/** Recompute an invoice's status from its live (non-cancelled) payments. */
function invoiceStatusFromPayments(amount: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "unpaid";
  if (paid >= amount) return "paid";
  return "partial";
}

/**
 * Reverse a payment and recompute the invoice status. The payment row is
 * retained (flagged cancelled) so history, receipts and audit survive.
 */
export async function voidPayment(
  paymentId: string,
  reason: string,
  byUserId: string,
): Promise<void> {
  const p = await one(`SELECT * FROM payments WHERE id=?`, [paymentId]);
  if (!p) throw new Error("Payment not found");
  if (num(p.cancelled) === 1) throw new Error("Payment is already reversed.");

  const inv = await one(`SELECT * FROM invoices WHERE id=?`, [str(p.invoice_id)]);
  if (!inv) throw new Error("Invoice not found");

  const paid = await one(
    `SELECT COALESCE(SUM(amount),0) AS n FROM payments
     WHERE invoice_id=? AND cancelled=0 AND id != ?`,
    [inv.id, paymentId],
  );
  const nextStatus = invoiceStatusFromPayments(num(inv.amount), num(paid?.n));

  await runBatch(
    [
      {
        sql: `UPDATE payments SET cancelled=1, cancelled_at=?, cancel_reason=?, cancelled_by=?, updated_at=? WHERE id=?`,
        params: [nowISO(), reason || null, byUserId, nowISO(), paymentId],
      },
      {
        sql: `UPDATE invoices SET status=?, updated_at=? WHERE id=?`,
        params: [nextStatus, nowISO(), inv.id],
      },
      auditStatement("payment.voided", "payments", paymentId, p, {
        reason,
        nextInvoiceStatus: nextStatus,
      }),
    ],
    { immediate: true },
  );
}

/** Total collected grouped by collector (owner report). */
export async function collectionTotals(): Promise<
  Array<{ collector: string | null; total: number; count: number }>
> {
  const rows = await all(
    `SELECT u.name AS collector, COALESCE(SUM(p.amount),0) AS total, COUNT(*) AS count
     FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.cancelled = 0
     GROUP BY p.recorded_by
     ORDER BY total DESC`,
  );
  return rows.map((r) => ({
    collector: (r.collector as string) ?? null,
    total: num(r.total),
    count: num(r.count),
  }));
}

/* ------------------------------------------------------------ requests -- */

export async function createRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<void> {
  await runBatch(
    [
      {
        sql: `INSERT INTO requests (id, type, payload_json, status, requested_by, requested_at, updated_at)
              VALUES (?,?,?, 'pending', ?, ?, ?)`,
        params: [uid(), type, JSON.stringify(payload), requestedBy, nowISO(), nowISO()],
      },
      auditStatement("request.created", "requests", null, null, { type, payload }),
    ],
    { immediate: true },
  );
}

export async function listRequests(
  status?: RequestStatus | "all",
): Promise<ApprovalRequest[]> {
  const rows = await all(
    `SELECT r.*, u.name AS requested_by_name
     FROM requests r LEFT JOIN users u ON u.id = r.requested_by
     WHERE ? = 'all' OR r.status = ?
     ORDER BY r.requested_at DESC`,
    [status ?? "all", status ?? "all"],
  );
  return rows.map((r) => ({
    id: str(r.id),
    type: str(r.type) as RequestType,
    payload: (() => {
      try {
        return JSON.parse(String(r.payload_json ?? "{}")) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    status: str(r.status) as RequestStatus,
    requested_by: str(r.requested_by),
    requested_by_name: (r.requested_by_name as string) ?? null,
    requested_at: str(r.requested_at),
    decided_by: (r.decided_by as string) ?? null,
    decided_at: (r.decided_at as string) ?? null,
    decision_note: (r.decision_note as string) ?? null,
  }));
}

/**
 * Decide a request. Approving a payment-reversal request executes the
 * reversal atomically with the decision (audit covers both).
 */
export async function decideRequest(
  id: string,
  approve: boolean,
  decidedBy: string,
  note: string,
): Promise<void> {
  const req = await one(`SELECT * FROM requests WHERE id=?`, [id]);
  if (!req) throw new Error("Request not found");
  if (str(req.status) !== "pending") throw new Error("Request already decided.");

  const status = approve ? "approved" : "rejected";
  const statements: Array<{ sql: string; params?: SqlValue[] }> = [
    {
      sql: `UPDATE requests SET status=?, decided_by=?, decided_at=?, decision_note=?, updated_at=? WHERE id=?`,
      params: [status, decidedBy, nowISO(), note || null, nowISO(), id],
    },
    auditStatement("request.decided", "requests", id, req, { status, note }),
  ];

  try {
    if (approve && str(req.type) === "payment_reversal") {
      const payload = JSON.parse(String(req.payload_json ?? "{}")) as { paymentId?: string };
      if (!payload.paymentId) throw new Error("Request payload is missing the payment id.");
      const p = await one(`SELECT * FROM payments WHERE id=?`, [payload.paymentId]);
      if (!p) throw new Error("Payment no longer exists.");
      if (num(p.cancelled) === 1) throw new Error("Payment is already reversed.");

      const invId = str(p.invoice_id);
      const inv = await one(`SELECT * FROM invoices WHERE id=?`, [invId]);
      const paid = await one(
        `SELECT COALESCE(SUM(amount),0) AS n FROM payments
         WHERE invoice_id=? AND cancelled=0 AND id != ?`,
        [invId, payload.paymentId],
      );

      statements.push(
        {
          sql: `UPDATE payments SET cancelled=1, cancelled_at=?, cancel_reason=?, cancelled_by=?, updated_at=? WHERE id=?`,
          params: [nowISO(), `Approved request: ${note || "payment reversal"}`.trim(), decidedBy, nowISO(), payload.paymentId],
        },
        inv
          ? {
              sql: `UPDATE invoices SET status=?, updated_at=? WHERE id=?`,
              params: [invoiceStatusFromPayments(num(inv.amount), num(paid?.n)), nowISO(), invId],
            }
          : { sql: `SELECT 1`, params: [] },
      );
    }

    await runBatch(statements, { immediate: true });
  } catch (err) {
    // Nothing was committed inside the batch — reopen the request so the
    // owner can reject it or retry after fixing the underlying data.
    await runBatch(
      [
        {
          sql: `UPDATE requests SET status='pending', decided_by=NULL, decided_at=NULL, decision_note=NULL, updated_at=? WHERE id=?`,
          params: [nowISO(), id],
        },
      ],
      { immediate: true },
    ).catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------ dashboard -- */

export async function dashboardStats(): Promise<DashboardStats> {
  const month = todayISO().slice(0, 7);
  const { start } = monthRange(month);

  const [activeCustomers, mrr, invoiced, collected, outstanding, activeInstalls] =
    await Promise.all([
      one(`SELECT COUNT(*) AS n FROM customers WHERE status='active' AND archived=0`),
      one(
        `SELECT COALESCE(SUM(pl.monthly_price),0) AS n
         FROM customers c JOIN plans pl ON pl.id = c.plan_id
         WHERE c.status='active' AND c.archived=0`,
      ),
      one(
        `SELECT COALESCE(SUM(amount),0) AS n FROM invoices
         WHERE type='monthly' AND status != 'void' AND period_start >= ?`,
        [start],
      ),
      one(
        `SELECT COALESCE(SUM(p.amount),0) AS n FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE i.type='monthly' AND i.status != 'void' AND p.cancelled = 0 AND p.paid_at >= ?`,
        [`${start}T00:00:00`],
      ),
      one(
        `SELECT COALESCE(SUM(i.amount),0) - COALESCE((
            SELECT SUM(p.amount) FROM payments p JOIN invoices i2 ON i2.id = p.invoice_id
            WHERE p.cancelled = 0 AND i2.status IN ('unpaid','partial')), 0) AS n
         FROM invoices i WHERE i.status IN ('unpaid','partial')`,
      ),
      one(`SELECT COUNT(*) AS n FROM installations WHERE status IN ('scheduled','in_progress') AND archived=0`),
    ]);

  const monthInvoiced = num(invoiced?.n);
  const monthCollected = num(collected?.n);
  const unpaid = await one(
    `SELECT COUNT(*) AS n FROM invoices WHERE status IN ('unpaid','partial')`,
  );

  return {
    activeCustomers: num(activeCustomers?.n),
    mrr: num(mrr?.n),
    monthInvoiced,
    monthCollected,
    outstanding: Math.max(0, num(outstanding?.n)),
    unpaidInvoices: num(unpaid?.n),
    activeInstallations: num(activeInstalls?.n),
    collectionRate: monthInvoiced > 0 ? monthCollected / monthInvoiced : 0,
  };
}

/** Whether the current (or given) month still needs invoices generated. */
export async function getBillingHealth(month?: string): Promise<BillingHealth> {
  const m = month ?? todayISO().slice(0, 7);
  const { start } = monthRange(m);
  const r = await one(
    `SELECT
       COUNT(*) AS active,
       COALESCE(SUM(CASE WHEN plan_id IS NULL THEN 1 ELSE 0 END),0) AS planless
     FROM customers WHERE status='active' AND archived=0`,
  );
  const billed = await one(
    `SELECT COUNT(*) AS n FROM invoices WHERE type='monthly' AND period_start=? AND status != 'void'`,
    [start],
  );
  const active = num(r?.active);
  const planless = num(r?.planless);
  const invoiced = num(billed?.n);
  return {
    activeCustomers: active,
    planless,
    invoiced,
    needsGeneration: invoiced < active - planless,
  };
}

/* ------------------------------------------------------------- audit log -- */

export async function listAuditLog(limit = 200): Promise<AuditLogEntry[]> {
  const rows = await all(`SELECT * FROM audit_log ORDER BY ts DESC, rowid DESC LIMIT ?`, [limit]);
  return rows.map((r) => ({
    id: str(r.id),
    ts: str(r.ts),
    user_id: (r.user_id as string) ?? null,
    action: str(r.action),
    entity: str(r.entity),
    entity_id: (r.entity_id as string) ?? null,
    before_json: (r.before_json as string) ?? null,
    after_json: (r.after_json as string) ?? null,
    device_id: (r.device_id as string) ?? null,
  }));
}