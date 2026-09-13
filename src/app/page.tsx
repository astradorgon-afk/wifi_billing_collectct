"use client";

import Link from "next/link";
import { useState } from "react";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  dashboardStats,
  listPayments,
  listCustomers,
  generateMonthlyInvoices,
  getBillingHealth,
} from "@/lib/db/repository";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtMonth, todayISO } from "@/lib/dates";
import {
  Card,
  Button,
  Badge,
  Table,
  EmptyState,
  Spinner,
  Modal,
  Field,
  Select,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import type { BillingHealth, DashboardStats, PaymentWithMeta, CustomerWithPlan } from "@/lib/types";

function monthOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = -1; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/* ------------------------------------------------------------ Dashboard -- */

export default function DashboardPage() {
  const { state, user } = useData();

  if (state === "loading") return <Spinner label="Opening local database…" />;
  if (state === "error")
    return (
      <EmptyState
        icon="alert"
        title="Database failed to open"
        hint="Try reloading the page. Your data is stored locally in this browser."
      />
    );

  return user?.role === "collector" ? <CollectorDashboard /> : <OwnerDashboard />;
}

/* ------------------------------------------------------ Owner dashboard -- */

function OwnerDashboard() {
  const [genOpen, setGenOpen] = useState(false);
  const [genMonth, setGenMonth] = useState(todayISO().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const stats = useQuery<DashboardStats>(() => dashboardStats(), []);
  const health = useQuery<BillingHealth>(() => getBillingHealth(), []);

  async function runGenerate() {
    setBusy(true);
    try {
      const n = await generateMonthlyInvoices(genMonth);
      setMsg(
        n > 0
          ? `Created ${n} invoice${n === 1 ? "" : "s"} for ${fmtMonth(genMonth)}.`
          : `All invoices for ${fmtMonth(genMonth)} already exist.`,
      );
      setGenOpen(false);
      health.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{fmtMonth(todayISO().slice(0, 7))}</p>
        </div>
        <Button onClick={() => setGenOpen(true)}>
          <Icon name="receipt" size={15} />
          Generate invoices
        </Button>
      </div>

      <Modal
        open={genOpen}
        title="Generate monthly invoices"
        onClose={() => setGenOpen(false)}
      >
        <div className="space-y-4">
          <Field
            label="Billing month"
            hint="One invoice per active customer; safe to run twice."
          >
            <Select value={genMonth} onChange={(e) => setGenMonth(e.target.value)}>
              {monthOptions().map((m) => (
                <option key={m} value={m}>
                  {fmtMonth(m)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGenOpen(false)}>
              Cancel
            </Button>
            <Button onClick={runGenerate} disabled={busy}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </Modal>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-500/15 dark:text-blue-300">
          {msg}
        </div>
      )}

      {/* Billing health reminder */}
      {health.data && (health.data.needsGeneration || health.data.planless > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <span>
            {health.data.needsGeneration
              ? `${health.data.invoiced} of ${health.data.activeCustomers} active customers invoiced for ${fmtMonth(todayISO().slice(0, 7))}.`
              : ""}
            {health.data.planless > 0 && ` ${health.data.planless} active subscriber${health.data.planless === 1 ? "" : "s"} ha${health.data.planless === 1 ? "s" : "ve"} no plan yet.`}
          </span>
          {health.data.needsGeneration && (
            <Button variant="secondary" onClick={() => setGenOpen(true)}>
              Generate now
            </Button>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Monthly recurring revenue"
          value={formatMoney(stats.data?.mrr ?? 0)}
          sub={`${stats.data?.activeCustomers ?? 0} active customers`}
        />
        <StatCard
          label="Collected this month"
          value={formatMoney(stats.data?.monthCollected ?? 0)}
          sub={
            stats.data
              ? `${Math.round(stats.data.collectionRate * 100)}% of ${formatMoney(stats.data.monthInvoiced)}`
              : "—"
          }
        />
        <StatCard
          label="Outstanding balance"
          value={formatMoney(stats.data?.outstanding ?? 0)}
          sub={`${stats.data?.unpaidInvoices ?? 0} unpaid invoices`}
        />
        <StatCard
          label="Active installations"
          value={String(stats.data?.activeInstallations ?? 0)}
          sub="Scheduled or in progress"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OutstandingCard />
        <RecentPaymentsCard />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickLink href="/customers" icon="users" label="Add customer" />
        <QuickLink href="/installations" icon="tools" label="Schedule install" />
        <QuickLink href="/billing" icon="receipt" label="View invoices" />
        <QuickLink href="/settings" icon="settings" label="Backup data" />
      </div>
    </div>
  );
}

/* --------------------------------------------------- Collector dashboard -- */

function CollectorDashboard() {
  const { user } = useData();
  const firstName = user?.name.split(" ")[0] || "there";

  const stats = useQuery<DashboardStats>(() => dashboardStats(), []);
  const customers = useQuery<CustomerWithPlan[]>(() => listCustomers(""), []);

  const debtors = (customers.data ?? [])
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Good day, {firstName}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {fmtMonth(todayISO().slice(0, 7))} · You collect from {debtors.length} customer
          {debtors.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Collected this month"
          value={formatMoney(stats.data?.monthCollected ?? 0)}
          sub={
            stats.data
              ? `${Math.round(stats.data.collectionRate * 100)}% of ${formatMoney(stats.data.monthInvoiced)}`
              : "—"
          }
        />
        <StatCard
          label="Outstanding balance"
          value={formatMoney(stats.data?.outstanding ?? 0)}
          sub="To be collected"
        />
        <StatCard
          label="Unpaid invoices"
          value={String(stats.data?.unpaidInvoices ?? 0)}
          sub="Across all customers"
        />
        <StatCard
          label="Accounts to follow up"
          value={String(debtors.length)}
          sub="Customers with a balance"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OutstandingCard collector />
        <RecentPaymentsCard />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickLink href="/customers" icon="users" label="Add customer" />
        <QuickLink href="/payments" icon="banknote" label="Record payment" />
        <QuickLink href="/payments" icon="receipt" label="View receipts" />
        <QuickLink href="/customers" icon="search" label="Find customer" />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Shared -- */

function OutstandingCard({ collector = false }: { collector?: boolean }) {
  const customers = useQuery<CustomerWithPlan[]>(() => listCustomers(""), []);

  const topDebtors = (customers.data ?? [])
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  return (
    <Card
      title={collector ? "Collect payments" : "Top outstanding balances"}
      subtitle="Customers with unpaid invoices"
    >
      {topDebtors.length === 0 ? (
        <EmptyState icon="check" title="No outstanding balances" hint="Every invoice is settled." />
      ) : (
        <Table head={["Customer", "Plan", "Balance", ""]}>
          {topDebtors.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{c.full_name}</td>
              <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{c.plan_name ?? "—"}</td>
              <td className="px-2 py-2 font-semibold text-red-600 dark:text-red-400">
                {formatMoney(c.balance)}
              </td>
              <td className="px-2 py-2 text-right">
                <Link
                  href={`/payments?customer=${c.id}`}
                  className={
                    collector
                      ? "inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      : "text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                  }
                >
                  Collect
                  {collector && <Icon name="arrow-right" size={12} />}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function RecentPaymentsCard() {
  const payments = useQuery<PaymentWithMeta[]>(() => listPayments(6), []);

  return (
    <Card title="Recent payments" subtitle="Latest collections">
      {payments.loading ? (
        <Spinner />
      ) : (payments.data ?? []).length === 0 ? (
        <EmptyState icon="banknote" title="No payments yet" hint="Record a payment from the Payments page." />
      ) : (
        <Table head={["Customer", "Amount", "Method", "When"]}>
          {(payments.data ?? []).map((p) => (
            <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
              <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{p.customer_name}</td>
              <td className="px-2 py-2 font-semibold text-emerald-600 dark:text-emerald-400">
                +{formatMoney(p.amount)}
              </td>
              <td className="px-2 py-2">
                <Badge tone="slate">{p.method}</Badge>
              </td>
              <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{fmtDate(p.paid_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-blue-500/15"
    >
      <Icon name={icon} size={18} className="text-blue-600 dark:text-blue-400" />
      {label}
    </Link>
  );
}