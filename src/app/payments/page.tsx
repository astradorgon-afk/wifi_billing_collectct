"use client";

import { useState } from "react";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  listPayments,
  listCustomers,
  listInvoices,
  listRequests,
  createRequest,
  decideRequest,
  voidPayment,
} from "@/lib/db/repository";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtMonth } from "@/lib/dates";
import { downloadCSV, backupFilename } from "@/lib/backup";
import {
  Card,
  Button,
  Badge,
  Table,
  EmptyState,
  Spinner,
  Modal,
  Field,
  Input,
} from "@/components/ui";
import { CollectModal } from "@/components/CollectModal";
import { Icon } from "@/components/icons";
import type {
  ApprovalRequest,
  CustomerWithPlan,
  InvoiceWithMeta,
  PaymentWithMeta,
} from "@/lib/types";

/** Read ?customer=<id> at first render so "Collect" links preselect a customer. */
function queryCustomer(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("customer");
  return id || null;
}

export default function PaymentsPage() {
  const { state, user } = useData();
  const [receipt, setReceipt] = useState<PaymentWithMeta | null>(null);
  const [picker, setPicker] = useState<boolean>(() => queryCustomer() !== null);
  const [selectedId, setSelectedId] = useState<string | null>(() => queryCustomer());
  const [payFor, setPayFor] = useState<InvoiceWithMeta | null>(null);
  const [reverseTarget, setReverseTarget] = useState<PaymentWithMeta | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const payments = useQuery<PaymentWithMeta[]>(() => listPayments(200), []);
  const customers = useQuery<CustomerWithPlan[]>(() => listCustomers(""), []);
  const invoices = useQuery<InvoiceWithMeta[]>(() => listInvoices(), []);
  const requests = useQuery<ApprovalRequest[]>(() => listRequests("pending"), []);

  if (state === "loading") return <Spinner label="Opening local database…" />;

  const rows = payments.data ?? [];
  const livePayments = rows.filter((p) => !p.cancelled);
  const total = livePayments.reduce((s, p) => s + p.amount, 0);

  const debtors = (customers.data ?? [])
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const selected = (customers.data ?? []).find((c) => c.id === selectedId) ?? null;
  const selectedInvoices =
    selectedId && invoices.data
      ? invoices.data.filter((i) => i.customer_id === selectedId && i.balance > 0)
      : [];

  const pendingRequests = (requests.data ?? []).filter(
    (r) => r.status === "pending",
  );

  function refreshAll() {
    payments.refresh();
    customers.refresh();
    invoices.refresh();
    requests.refresh();
  }

  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      refreshAll();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {livePayments.length} payment{livePayments.length === 1 ? "" : "s"} · {formatMoney(total)} collected
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setSelectedId(null);
              setPicker(true);
            }}
          >
            <Icon name="banknote" size={15} />
            Record payment
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              downloadCSV(
                backupFilename("payments.csv"),
                livePayments.map((p) => ({
                  receipt: p.invoice_no,
                  customer: p.customer_name,
                  amount: (p.amount / 100).toFixed(2),
                  method: p.method,
                  paid_at: p.paid_at,
                  reference: p.reference ?? "",
                  recorded_by: p.recorded_by_name ?? "",
                })),
              )
            }
          >
            <Icon name="download" size={15} />
            Export CSV
          </Button>
        </div>
      </div>

      {msg && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-500/15 dark:text-blue-300">
          <Icon name={msg.startsWith("⚠️") ? "alert" : "check"} size={15} className="mt-0.5 shrink-0" />
          <span>{msg.replace(/^[✅⚠️]\s*/, "")}</span>
        </div>
      )}

      {/* Pending payment-reversal requests (owner sees approve/reject) */}
      {pendingRequests.length > 0 && (
        <Card title="Pending reversal requests" subtitle="Collectors asking to reverse a payment">
          <div className="space-y-2">
            {pendingRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {String((r.payload as Record<string, unknown>).reason ?? "No reason given")}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Requested by {r.requested_by_name ?? "unknown"} · {fmtDate(r.requested_at.slice(0, 10))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" disabled={!!busy}
                    onClick={() => withBusy(`decide-${r.id}`, () => decideRequest(r.id, true, user!.id, ""))}>
                    Approve
                  </Button>
                  <Button variant="ghost" disabled={!!busy}
                    onClick={() => withBusy(`reject-${r.id}`, () => decideRequest(r.id, false, user!.id, "Rejected by owner"))}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Accounts with balance" subtitle="Customers with unpaid invoices — click Collect to record a payment">
        {debtors.length === 0 ? (
          <EmptyState icon="check" title="All accounts settled" hint="No outstanding balances." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {debtors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {c.full_name}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{c.plan_name ?? "No plan"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-bold text-red-600 dark:text-red-400">
                    {formatMoney(c.balance)}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelectedId(c.id);
                      setPicker(true);
                    }}
                  >
                    Collect
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        {payments.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="banknote"
            title="No payments recorded"
            hint={'Use "Record payment" to collect an outstanding invoice.'}
          />
        ) : (
          <Table head={["Receipt", "Customer", "Amount", "Method", "Reference", "When", ""]}>
            {rows.map((p) => (
              <tr key={p.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 ${p.cancelled ? "opacity-50" : ""}`}>
                <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {p.invoice_no}
                  {p.cancelled && <span className="ml-1 text-red-600 dark:text-red-400">(reversed)</span>}
                </td>
                <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{p.customer_name}</td>
                <td className={`px-2 py-2 font-semibold ${p.cancelled ? "text-slate-400 line-through" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {p.cancelled ? "" : "+"}{formatMoney(p.amount)}
                </td>
                <td>
                  <Badge tone="slate">{p.method}</Badge>
                </td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{p.reference ?? "—"}</td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{fmtDate(p.paid_at)}</td>
                <td className="px-2 py-2 text-right">
                  {!p.cancelled && (
                    <Button variant="ghost" onClick={() => setReceipt(p)} aria-label={`View receipt for ${p.invoice_no}`}>
                      <Icon name="receipt" size={16} />
                    </Button>
                  )}
                  {!p.cancelled && user?.role === "owner" && (
                    <Button variant="ghost" onClick={() => { setReverseTarget(p); setReason(""); }} aria-label="Reverse payment" title="Reverse this payment">
                      <Icon name="undo" size={16} />
                    </Button>
                  )}
                  {!p.cancelled && user?.role === "collector" && (
                    <Button variant="ghost" onClick={() => { setReverseTarget(p); setReason(""); }} aria-label="Request reversal" title="Request approval to reverse">
                      <Icon name="users" size={16} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Collect picker: customers with outstanding balances (or one customer's invoices) */}
      <Modal
        open={picker}
        title={selected ? `Collect from ${selected.full_name}` : "Record payment"}
        onClose={() => setPicker(false)}
      >
        <div className="space-y-2">
          {selected && (
            <button
              onClick={() => setSelectedId(null)}
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              ← All customers
            </button>
          )}

          {!selected &&
            (debtors.length === 0 ? (
              <EmptyState
                icon="check"
                title="No outstanding balances"
                hint="Every invoice is settled."
              />
            ) : (
              debtors.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.full_name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{c.plan_name ?? "—"}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                    {formatMoney(c.balance)}
                  </span>
                </button>
              ))
            ))}

          {selected &&
            (selectedInvoices.length === 0 ? (
              <EmptyState
                icon="check"
                title="No invoices due"
                hint={`Every invoice for ${selected.full_name} is settled.`}
              />
            ) : (
              selectedInvoices.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {i.invoice_no} ·{" "}
                      {i.type === "monthly"
                        ? fmtMonth(i.period_start.slice(0, 7))
                        : "Installation"}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Balance {formatMoney(i.balance)}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setPayFor(i)}>
                    Collect
                  </Button>
                </div>
              ))
            ))}
        </div>
      </Modal>

      <CollectModal
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onSaved={() => {
          setPayFor(null);
          refreshAll();
        }}
      />

      {/* Receipt */}
      <Modal
        open={!!receipt}
        title="Payment receipt"
        onClose={() => setReceipt(null)}
      >
        {receipt && (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm dark:border-slate-600">
              <p className="text-center text-lg font-bold text-slate-800 dark:text-slate-100">Official Receipt</p>
              <p className="mb-3 text-center font-mono text-xs text-slate-400 dark:text-slate-500">
                {receipt.invoice_no}
              </p>
              <dl className="space-y-1.5">
                <Row k="Received from" v={receipt.customer_name} />
                <Row k="Amount" v={formatMoney(receipt.amount)} strong />
                <Row k="For" v={`Invoice ${receipt.invoice_no}`} />
                <Row k="Method" v={receipt.method} />
                <Row k="Reference" v={receipt.reference ?? "—"} />
                <Row k="Date" v={fmtDate(receipt.paid_at)} />
                <Row
                  k="Invoice balance after"
                  v={formatMoney(Math.max(0, receipt.invoice_balance - receipt.amount))}
                />
              </dl>
              <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
                Thank you for your payment!
              </p>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setReceipt(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reverse / Request reversal */}
      <Modal
        open={!!reverseTarget}
        title={user?.role === "owner" ? "Reverse payment" : "Request payment reversal"}
        onClose={() => setReverseTarget(null)}
      >
        {reverseTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Reverse <strong>{formatMoney(reverseTarget.amount)}</strong> paid by <strong>{reverseTarget.customer_name}</strong> for invoice <strong>{reverseTarget.invoice_no}</strong>?
            </p>
            {user?.role === "collector" && (
              <Field label="Reason for reversal" hint="The owner will see this when reviewing your request.">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Incorrect amount entered" />
              </Field>
            )}
            {user?.role === "owner" && (
              <Field label="Reversal reason (optional)">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setReverseTarget(null)}>Cancel</Button>
              <Button
                className={user?.role === "owner" ? "" : "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:text-white dark:hover:bg-amber-700"}
                disabled={!!busy || (user?.role === "collector" && !reason.trim())}
                onClick={() =>
                  withBusy(`rev-${reverseTarget.id}`, async () => {
                    if (user?.role === "owner") {
                      await voidPayment(reverseTarget.id, reason.trim() || "Owner reversal", user.id);
                      setMsg("✅ Payment reversed.");
                    } else {
                      await createRequest("payment_reversal", {
                        paymentId: reverseTarget.id,
                        amount: reverseTarget.amount,
                        invoice_no: reverseTarget.invoice_no,
                        customer_name: reverseTarget.customer_name,
                        reason: reason.trim(),
                      }, user!.id);
                      setMsg("✅ Reversal request submitted for owner approval.");
                    }
                    setReverseTarget(null);
                  })
                }
              >
                {user?.role === "owner" ? (busy ? "Reversing…" : "Reverse now") : (busy ? "Requesting…" : "Submit request")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400 dark:text-slate-500">{k}</dt>
      <dd
        className={
          strong ? "font-bold text-emerald-600 dark:text-emerald-400" : "font-medium text-slate-700 dark:text-slate-200"
        }
      >
        {v}
      </dd>
    </div>
  );
}