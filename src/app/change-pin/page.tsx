"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/providers/DataProvider";
import { changePin } from "@/lib/db/users";
import { Button, Field, Input } from "@/components/ui";
import { Icon } from "@/components/icons";

export default function ChangePinPage() {
  const router = useRouter();
  const { user, markPinChanged, logout } = useData();
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pin !== confirm) {
      setError("The new PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      if (!user) throw new Error("Not signed in.");
      await changePin(user.id, pin, current);
      markPinChanged();
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Change failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center px-4 py-10">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-center gap-2">
          <Icon name="settings" size={18} className="text-blue-600 dark:text-blue-400" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Set a new PIN</h1>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          The default account PIN must be changed before you can use the app.
          Create a 4-or-more digit PIN you will remember.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Current PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" type="button" onClick={logout} className="flex-1">
              Log out
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || !current || !pin || !confirm}>
              {busy ? "Saving…" : "Save PIN"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}