"use client";

import { useState } from "react";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  listInvoices,
  voidInvoice,
} from "@/lib/db/repository";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtMonth } from "@/lib/dates";
import {
  Card,
  Button,
  Badge,
  Table,
  EmptyState,
  Spinner,
  Input,
  Select,
} from "@/components/ui";
import { CollectModal } from "@/components/CollectModal";
import { Icon } from "@/components/icons";
import type { InvoiceStatus, InvoiceWithMeta } from "@/lib/types";

const STATUS_TONE: Record<InvoiceStatus, "red" | "amber" | "green" | "slate"> = {
  unpaid: "red",
  partial: "amber",
  paid: "green",
  void: "slate",
};

export default function BillingPage() {
  const { state } = useData();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<InvoiceWithMeta | null>(null);

  const invoices = useQuery<InvoiceWithMeta[]>(
    () => listInvoices({ status: statusFilter }),
    [statusFilter],
  );

  if (state === "loading") return <Spinner label="Opening local database…" />;

  const all = invoices.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = q
    ? all.filter(
        (i) =>
          i.customer_name.toLowerCase().includes(q) ||
          i.invoice_no.toLowerCase().includes(q),
      )
    : all;

  const totals = rows.reduce(
    (acc, i) => {
      if (i.status !== "void") {
        acc.billed += i.amount;
        acc.paid += i.paid;
      }
      return acc;
    },
    { billed: 0, paid: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Billing</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rows.length} invoice{rows.length === 1 ? "" : "s"} · {formatMoney(totals.billed)}{" "}
            billed · {formatMoney(totals.paid)} paid
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Search customer or invoice #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | "all")}
            className="w-36"
          >
            <option value="all">All statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        </div>
      </div>

      <Card>
        {invoices.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No invoices"
            hint="Use “Generate invoices” on the Dashboard to create the month's billing."
          />
        ) : (
          <Table
            head={["Invoice", "Customer", "Period", "Amount", "Balance", "Due", "Status", ""]}
          >
            {rows.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{i.invoice_no}</td>
                <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{i.customer_name}</td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                  {i.type === "monthly" ? (
                    fmtMonth(i.period_start.slice(0, 7))
                  ) : (
                    <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      installation
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{formatMoney(i.amount)}</td>
                <td
                  className={`px-2 py-2 font-semibold ${
                    i.balance > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {formatMoney(i.balance)}
                </td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{fmtDate(i.due_date)}</td>
                <td>
                  <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
                </td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1.5">
                    <Button
                      variant="secondary"
                      className="w-[88px]"
                      disabled={i.balance <= 0}
                      onClick={() => setPayFor(i)}
                    >
                      Collect
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-[34px] w-9 justify-center p-0"
                      disabled={i.status === "void" || i.status === "paid" || i.paid > 0}
                      title={i.status === "void" || i.status === "paid" || i.paid > 0 ? "" : "Void invoice"}
                      aria-label="Void invoice"
                      onClick={async () => {
                        if (window.confirm("Void this invoice? This cannot be undone.")) {
                          try {
                            await voidInvoice(i.id);
                            invoices.refresh();
                          } catch (e) {
                            window.alert((e as Error).message);
                          }
                        }
                      }}
                    >
                      <Icon name="ban" size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <CollectModal
        invoice={payFor}
        onClose={() => setPayFor(null)}
        onSaved={() => {
          setPayFor(null);
          invoices.refresh();
        }}
      />
    </div>
  );
}
