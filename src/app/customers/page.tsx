"use client";

import { useState } from "react";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  listCustomers,
  listPlans,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  archiveCustomer,
  createPlan,
} from "@/lib/db/repository";
import { formatMoney, parseMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
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
  Select,
} from "@/components/ui";
import type { CustomerWithPlan, Plan } from "@/lib/types";
import { Icon } from "@/components/icons";

export default function CustomersPage() {
  const { state } = useData();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerWithPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [planModal, setPlanModal] = useState(false);

  const customers = useQuery<CustomerWithPlan[]>(() => listCustomers(search), [search]);
  const plans = useQuery<Plan[]>(() => listPlans(false), []);

  if (state === "loading") return <Spinner label="Opening local database…" />;

  const rows = customers.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Customers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rows.length} subscriber{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPlanModal(true)}>
            <Icon name="wifi" size={15} />
            Plans
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />
            Add customer
          </Button>
        </div>
      </div>

      <Card>
        <div className="mb-3">
          <Input
            placeholder="Search name, phone, or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {customers.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="users"
            title={search ? "No matches" : "No customers yet"}
            hint={
              search
                ? "Try a different search term."
                : "Add your first subscriber, then schedule their installation."
            }
            action={
              !search && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Add customer
                </Button>
              )
            }
          />
        ) : (
          <Table head={["Name", "Contact", "Plan", "Monthly", "Balance", "Status", ""]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <td className="px-2 py-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{c.full_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Since {fmtDate(c.created_at)}</p>
                </td>
                <td className="px-2 py-2">
                  <p className="text-slate-600 dark:text-slate-300">{c.phone}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{c.address}</p>
                </td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{c.plan_name ?? "—"}</td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                  {c.monthly_price != null ? formatMoney(c.monthly_price) : "—"}
                </td>
                <td
                  className={`px-2 py-2 font-semibold ${
                    c.balance > 0 ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {formatMoney(c.balance)}
                </td>
                <td>
                  <Badge tone={c.status === "active" ? "green" : "slate"}>{c.status}</Badge>
                </td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.full_name}`}>
                      <Icon name="edit" size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Delete ${c.full_name}`}
                      onClick={async () => {
                        if (
                          window.confirm(
                            `Delete ${c.full_name}? Customers without billing history are removed; others are archived (hidden, history kept).`,
                          )
                        ) {
                          try {
                            await deleteCustomer(c.id);
                          } catch {
                            // History exists → archive instead of hard delete.
                            await archiveCustomer(c.id);
                          }
                          customers.refresh();
                        }
                      }}
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <CustomerModal
        open={creating || !!editing}
        customer={editing}
        plans={plans.data ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          customers.refresh();
        }}
      />

      <PlanManagerModal
        open={planModal}
        plans={plans.data ?? []}
        onClose={() => setPlanModal(false)}
        onSaved={() => plans.refresh()}
        onCreatePlan={createPlan}
      />
    </div>
  );
}

/* -------------------------------------------------------- modals ------- */

function CustomerModal({
  open,
  customer,
  plans,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerWithPlan | null;
  plans: Plan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sync form when opening for an existing customer
  if (open && customer && loadedFor !== customer.id) {
    setFullName(customer.full_name);
    setPhone(customer.phone);
    setAddress(customer.address);
    setPlanId(customer.plan_id ?? "");
    setStatus(customer.status);
    setLoadedFor(customer.id);
  }
  if (open && !customer && loadedFor !== "new") {
    setFullName("");
    setPhone("");
    setAddress("");
    setPlanId("");
    setStatus("active");
    setLoadedFor("new");
  }

  async function save() {
    if (!fullName.trim() || !phone.trim() || !address.trim()) {
      setErr("Name, phone, and address are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input = {
        full_name: fullName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        plan_id: planId || null,
        status,
      };
      if (customer) await updateCustomer(customer.id, input);
      else await createCustomer(input);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={customer ? "Edit customer" : "Add customer"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Full name">
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Installation address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Plan">
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">— No plan —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatMoney(p.monthly_price)}/mo
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PlanManagerModal({
  open,
  plans,
  onClose,
  onSaved,
  onCreatePlan,
}: {
  open: boolean;
  plans: Plan[];
  onClose: () => void;
  onSaved: () => void;
  onCreatePlan: (input: { name: string; monthly_price: number; speed_mbps: number }) => Promise<Plan>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [speed, setSpeed] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function addPlan() {
    const monthly = parseMoney(price);
    const mbps = Number(speed);
    if (!name.trim() || monthly <= 0 || !mbps) {
      setErr("Name, monthly price, and speed are required.");
      return;
    }
    await onCreatePlan({ name: name.trim(), monthly_price: monthly, speed_mbps: mbps });
    setName("");
    setPrice("");
    setSpeed("");
    setErr(null);
    onSaved();
  }

  return (
    <Modal open={open} title="Internet plans" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-2">
          {plans.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No plans yet — add one below.</p>
          )}
          {plans.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
            >
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{p.speed_mbps} Mbps</p>
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatMoney(p.monthly_price)}/mo
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Add plan
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Price/mo">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="999" />
            </Field>
            <Field label="Mbps">
              <Input value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          {err && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{err}</p>}
          <div className="mt-2 flex justify-end">
            <Button onClick={addPlan}>Add plan</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
