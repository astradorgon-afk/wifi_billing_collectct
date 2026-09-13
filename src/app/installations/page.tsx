"use client";

import { useState } from "react";
import { useData, useQuery } from "@/providers/DataProvider";
import {
  listInstallations,
  listCustomers,
  createInstallation,
  updateInstallation,
  setInstallationStatus,
  deleteInstallation,
} from "@/lib/db/repository";
import { formatMoney, parseMoney } from "@/lib/money";
import { fmtDate, todayISO } from "@/lib/dates";
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
  Textarea,
} from "@/components/ui";
import type {
  CustomerWithPlan,
  InstallationWithCustomer,
  InstallationStatus,
} from "@/lib/types";
import { Icon } from "@/components/icons";

const STATUS_TONE: Record<InstallationStatus, "blue" | "amber" | "green" | "red"> = {
  scheduled: "blue",
  in_progress: "amber",
  completed: "green",
  cancelled: "red",
};

const NEXT_ACTION: Partial<Record<InstallationStatus, { label: string; to: InstallationStatus }>> = {
  scheduled: { label: "Start", to: "in_progress" },
  in_progress: { label: "Complete", to: "completed" },
};

export default function InstallationsPage() {
  const { state } = useData();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InstallationWithCustomer | null>(null);

  const installs = useQuery<InstallationWithCustomer[]>(() => listInstallations(), []);
  const customers = useQuery<CustomerWithPlan[]>(() => listCustomers(""), []);

  if (state === "loading") return <Spinner label="Opening local database…" />;

  const rows = installs.data ?? [];
  const active = rows.filter((r) => r.status === "scheduled" || r.status === "in_progress");
  const done = rows.filter((r) => r.status === "completed" || r.status === "cancelled");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Installations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {active.length} active job{active.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          Schedule installation
        </Button>
      </div>

      <Card title="Active jobs" subtitle="Scheduled and in-progress installations">
        {installs.loading ? (
          <Spinner />
        ) : active.length === 0 ? (
          <EmptyState
            icon="tools"
            title="No active jobs"
            hint="Schedule an installation for a customer to get started."
          />
        ) : (
          <Table head={["Customer", "Scheduled", "Installer", "Fee", "Status", ""]}>
            {active.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <td className="px-2 py-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{r.customer_name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{r.customer_phone}</p>
                </td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{fmtDate(r.scheduled_date)}</td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{r.installer ?? "—"}</td>
                <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{formatMoney(r.installation_fee)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                </td>
                <td className="px-2 py-2">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" aria-label="Edit job" onClick={() => setEditing(r)}>
                      <Icon name="edit" size={16} />
                    </Button>
                    {NEXT_ACTION[r.status] && (
                      <Button
                        onClick={async () => {
                          await setInstallationStatus(r.id, NEXT_ACTION[r.status]!.to);
                          installs.refresh();
                        }}
                      >
                        {NEXT_ACTION[r.status]!.label}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      title="Cancel job"
                      aria-label="Cancel job"
                      onClick={async () => {
                        if (window.confirm("Cancel this installation job?")) {
                          await setInstallationStatus(r.id, "cancelled");
                          installs.refresh();
                        }
                      }}
                    >
                      <Icon name="x" size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="History" subtitle="Completed and cancelled jobs">
        {done.length === 0 ? (
          <EmptyState icon="folder" title="Nothing here yet" />
        ) : (
          <Table head={["Customer", "Scheduled", "Completed", "Fee", "Status", ""]}>
            {done.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-100">{r.customer_name}</td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{fmtDate(r.scheduled_date)}</td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{fmtDate(r.completed_date)}</td>
                <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatMoney(r.installation_fee)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    variant="ghost"
                    aria-label="Edit record"
                    onClick={() => setEditing(r)}
                  >
                    <Icon name="edit" size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Remove record"
                    onClick={async () => {
                      if (window.confirm("Remove this record?")) {
                        await deleteInstallation(r.id);
                        installs.refresh();
                      }
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <CreateInstallModal
        open={creating}
        customers={(customers.data ?? []).filter((c) => c.status === "active")}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          installs.refresh();
        }}
      />

      <EditInstallModal
        install={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          installs.refresh();
        }}
      />
    </div>
  );
}

function CreateInstallModal({
  open,
  customers,
  onClose,
  onSaved,
}: {
  open: boolean;
  customers: CustomerWithPlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [installer, setInstaller] = useState("");
  const [fee, setFee] = useState("1,500");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!customerId) {
      setErr("Pick a customer.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createInstallation({
        customer_id: customerId,
        scheduled_date: date || null,
        installer: installer.trim(),
        installation_fee: parseMoney(fee),
        notes: notes.trim(),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Schedule installation" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Select customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} ({c.phone})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Scheduled date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Installer / crew">
          <Input value={installer} onChange={(e) => setInstaller(e.target.value)} placeholder="Team A" />
        </Field>
        <Field label="Installation fee" hint="Invoiced automatically when the job is completed.">
          <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Schedule"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditInstallModal({
  install,
  onClose,
  onSaved,
}: {
  install: InstallationWithCustomer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState("");
  const [installer, setInstaller] = useState("");
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (install && loadedFor !== install.id) {
    setDate(install.scheduled_date ?? "");
    setInstaller(install.installer ?? "");
    setFee((install.installation_fee / 100).toFixed(2));
    setNotes(install.notes ?? "");
    setErr(null);
    setLoadedFor(install.id);
  }

  async function save() {
    if (!install) return;
    setBusy(true);
    setErr(null);
    try {
      await updateInstallation(install.id, {
        scheduled_date: date || null,
        installer: installer.trim(),
        installation_fee: parseMoney(fee),
        notes: notes.trim(),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!install} title="Edit installation" onClose={onClose}>
      {install && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{install.customer_name}</p>
          <Field label="Scheduled date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Installer / crew">
            <Input value={installer} onChange={(e) => setInstaller(e.target.value)} />
          </Field>
          <Field label="Installation fee" hint="Invoiced automatically when the job is completed.">
            <Input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
