"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/providers/DataProvider";
import { Button, Field, Input } from "@/components/ui";
import { Logo } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const { state, login, user } = useData();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state === "ready" && user) {
      const t = setTimeout(() => router.replace("/"), 0);
      return () => clearTimeout(t);
    }
  }, [state, user, router]);

  if (state !== "ready") return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, pin.trim());
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const example = (u: string, p: string) => {
    setUsername(u);
    setPin(p);
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-6 text-center">
          <Logo size={48} className="mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">WiFi Billing &amp; Collections</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="owner or collector"
              autoCapitalize="none"
              autoComplete="username"
              required
            />
          </Field>
          <Field label="PIN">
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/15 dark:text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy || !username || !pin}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-700/50 dark:text-slate-400">
          {process.env.NODE_ENV === "production" ? (
            <p>
              Ask the owner for your account credentials. PINs are stored on this
              device only.
            </p>
          ) : (
            <>
              <p className="mb-2 font-semibold text-slate-600 dark:text-slate-300">Demo accounts</p>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => example("owner", "1234")}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  owner — <span className="font-mono">1234</span> (Owner, all access)
                </button>
                <button
                  type="button"
                  onClick={() => example("collector", "0000")}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  collector — <span className="font-mono">0000</span> (collects payments)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}