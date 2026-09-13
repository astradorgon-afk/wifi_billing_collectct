"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getDb, flushSave, resetDb, importDbBytes, reloadDb, dbSync, setSaveFailureHandler } from "@/lib/db/database";
import { ensureDefaultUsers, authenticate, getUserById } from "@/lib/db/users";
import { seedDemoData } from "@/lib/seed";
import { captureInstallPrompt } from "@/lib/pwa";
import { getDeviceId, ensureDeviceMeta } from "@/lib/device";
import { setAuditCtx } from "@/lib/db/audit";
import {
  initSync,
  subscribeSyncState,
  setSyncEnabled,
  syncNow,
} from "@/lib/sync";
import type { SessionUser, SyncState } from "@/lib/types";

type DataState = "loading" | "ready" | "error";

const SESSION_KEY = "wifi-billing:session";

function loadSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionUser;
    if (
      s &&
      typeof s.username === "string" &&
      typeof s.name === "string" &&
      (s.role === "owner" || s.role === "collector")
    ) {
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

interface DataContextValue {
  state: DataState;
  error: string | null;
  online: boolean;
  isDemo: boolean;
  refresh: () => void;
  /** Monotonic counter that increments on every data change; pages watch it. */
  version: number;
  /** Persistence warning (save failure / cross-tab conflict). Dismissable. */
  saveWarning: string | null;
  dismissSaveWarning: () => void;
  seedDemo: () => Promise<void>;
  wipeAll: () => Promise<void>;
  restoreBytes: (bytes: Uint8Array) => Promise<void>;
  /** Logged-in user, or null when signed out. */
  user: SessionUser | null;
  login: (username: string, pin: string) => Promise<void>;
  logout: () => void;
  /** Called after the active user changes their PIN: clears the forced flag. */
  markPinChanged: () => void;
  syncState: SyncState;
  syncEnabled: (value: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [version, setVersion] = useState(0);
  const [user, setUser] = useState<SessionUser | null>(() => loadSession());
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    configured: false,
    enabled: false,
    syncing: false,
    lastSync: null,
    lastError: null,
  });

  const syncEnabled = useCallback((value: boolean) => setSyncEnabled(value), []);
  const syncNowNow = useCallback(() => syncNow(), []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const dismissSaveWarning = useCallback(() => setSaveWarning(null), []);

  const applyAuditCtx = useCallback((u: SessionUser) => {
    setAuditCtx(u.id, getDeviceId());
  }, []);

  // A completed sync may have pulled rows into the local database — bump the
  // version so pages re-query. Runs inside the async subscription callback
  // (never synchronously in an effect body).
  const syncLastRef = useRef<string | null>(null);
  const onSyncState = useCallback(
    (s: SyncState) => {
      setSyncState(s);
      if (s.lastSync && s.lastSync !== syncLastRef.current) refresh();
      syncLastRef.current = s.lastSync;
    },
    [refresh],
  );

  // Fresh sessions refresh the stored user so deactivation / forced PIN
  // resets take effect even without signing out.
  useEffect(() => {
    if (state !== "ready") return;
    const cached = loadSession();
    if (!cached) return;
    let cancelled = false;
    getUserById(cached.id)
      .then((u) => {
        if (cancelled) return;
        if (!u || !u.active) {
          window.localStorage.removeItem(SESSION_KEY);
          setUser(null);
          return;
        }
        const session: SessionUser = {
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          mustChangePin: u.must_change_pin,
        };
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setUser(session);
        applyAuditCtx(session);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state, applyAuditCtx]);

  useEffect(() => {
    captureInstallPrompt();
    initSync().catch((err) => console.error("Sync init failed:", err));
    const unsubSync = subscribeSyncState(onSyncState);

    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    const onFlush = () => flushSave();
    window.addEventListener("beforeunload", onFlush);
    document.addEventListener("visibilitychange", onFlush);

    // Another tab persisted the database — reload so all tabs agree.
    const onDbSync = async () => {
      try {
        await reloadDb();
        if (!cancelled) refresh();
      } catch (err) {
        console.error("Cross-tab DB reload failed:", err);
      }
    };
    dbSync?.addEventListener("message", onDbSync);

    dbSync?.addEventListener("message", onDbSync);

    // Surface persistence failures (save conflicts) instead of silent loss.
    setSaveFailureHandler((msg) => setSaveWarning(msg));

    let cancelled = false;
    getDb()
      .then(async () => {
        try {
          await ensureDefaultUsers();
          await ensureDeviceMeta();
        } catch (err) {
          // App still loads; only login is unavailable (e.g. non-secure context).
          console.error("Failed to prepare default accounts:", err);
        }
        if (cancelled) return;
        setState("ready");
        setVersion((v) => v + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(String(err?.message ?? err));
        setState("error");
      });

    return () => {
      cancelled = true;
      unsubSync();
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("beforeunload", onFlush);
      document.removeEventListener("visibilitychange", onFlush);
      dbSync?.removeEventListener("message", onDbSync);
    };
  }, [refresh, onSyncState]);

  const seedDemo = useCallback(async () => {
    await seedDemoData();
    setIsDemo(true);
    refresh();
  }, [refresh]);

  const wipeAll = useCallback(async () => {
    await resetDb();
    await ensureDefaultUsers(); // otherwise nobody could sign in afterwards
    setIsDemo(false);
    refresh();
  }, [refresh]);

  const restoreBytes = useCallback(
    async (bytes: Uint8Array) => {
      await importDbBytes(bytes);
      // The restored snapshot may predate the users table; guarantee a login.
      await ensureDefaultUsers();
      refresh();
    },
    [refresh],
  );

  const login = useCallback(
    async (username: string, pin: string) => {
      const u = await authenticate(username, pin);
      const session: SessionUser = {
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        mustChangePin: u.must_change_pin,
      };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setUser(session);
      applyAuditCtx(session);
      await ensureDeviceMeta();
    },
    [applyAuditCtx],
  );

  const logout = useCallback(() => {
    window.localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setSaveWarning(null);
  }, []);

  const markPinChanged = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev;
      const next: SessionUser = { ...prev, mustChangePin: false };
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      error,
      online,
      isDemo,
      refresh,
      version,
      saveWarning,
      dismissSaveWarning,
      seedDemo,
      wipeAll,
      restoreBytes,
      user,
      login,
      logout,
      markPinChanged,
      syncState,
      syncEnabled,
      syncNow: syncNowNow,
    }),
    [
      state,
      error,
      online,
      isDemo,
      refresh,
      version,
      saveWarning,
      dismissSaveWarning,
      seedDemo,
      wipeAll,
      restoreBytes,
      user,
      login,
      logout,
      markPinChanged,
      syncState,
      syncEnabled,
      syncNowNow,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

/** Convenience hook: gives [data, loading, refresh] for async repo queries. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  refresh: () => void;
} {
  const { version } = useData();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fn()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Query failed:", err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  return { data, loading, refresh };
}