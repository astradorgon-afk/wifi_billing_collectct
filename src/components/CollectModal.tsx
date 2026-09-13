"use client";

import { useState } from "react";
import { recordPayment } from "@/lib/db/repository";
import { formatMoney } from "@/lib/money";
import { fmtMonth } from "@/lib/dates";
import { useData } from "@/providers/DataProvider";
import { getDeviceId } from "@/lib/device";
import { Button, Modal, Field, Input, Select } from "@/components/ui";
import type { InvoiceWithMeta, PaymentMethod } from "@/lib/types";

export function CollectModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: InvoiceWithMeta | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useData();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (invoice && loadedFor !== invoice.id) {
    setAmount((invoice.balance / 100).toFixed(2));
    setReference("");
    setErr(null);
    setLoadedFor(invoice.id);
  }

  async function save() {
    if (!invoice) return;
    const cents = Math.round(Number.parseFloat(amount.replace(/,/g, "")) * 100);
    if (!cents || cents <= 0) {
      setErr("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await recordPayment({
        invoice_id: invoice.id,
        amount: cents,
        method,
        reference: reference.trim(),
        notes: "",
        recorded_by: user?.id ?? null,
        device_id: getDeviceId(),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!invoice} title="Record payment" onClose={onClose}>
      {invoice && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-700/50">
            <p className="font-medium text-slate-800 dark:text-slate-100">{invoice.customer_name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {invoice.invoice_no} ·{" "}
              {invoice.type === "monthly"
                ? fmtMonth(invoice.period_start.slice(0, 7))
                : "Installation"}{" "}
              · Balance {formatMoney(invoice.balance)}
            </p>
          </div>
          <Field label="Amount" hint={`Outstanding balance: ${formatMoney(invoice.balance)}`}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="cash">Cash</option>
              <option value="gcash">GCash / e-wallet</option>
              <option value="bank">Bank transfer</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Reference (optional)">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt #, txn id…"
            />
          </Field>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}