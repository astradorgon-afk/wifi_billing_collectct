"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useData } from "@/providers/DataProvider";
import { Spinner } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon, Logo } from "@/components/icons";
import type { ReactNode } from "react";
import type { UserRole } from "@/lib/types";
import type { IconName } from "@/components/icons";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Dashboard", icon: "chart" },
  { href: "/customers", label: "Customers", icon: "users" },
  { href: "/installations", label: "Installs", icon: "tools" },
  { href: "/billing", label: "Billing", icon: "receipt" },
  { href: "/payments", label: "Payments", icon: "banknote" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

const OWNER_ROUTES = new Set(["", "/", "/change-pin", "/customers", "/installations", "/billing", "/payments", "/settings", "/offline", "/login"]);
const COLLECTOR_ROUTES = new Set(["/", "/change-pin", "/customers", "/payments", "/offline", "/login"]);

function canAccess(role: UserRole, pathname: string): boolean {
  const allowed = role === "owner" ? OWNER_ROUTES : COLLECTOR_ROUTES;
  for (const route of allowed) {
    if (pathname === route || (route !== "/" && pathname.startsWith(route + "/"))) return true;
  }
  return false;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { online, state, user, logout, saveWarning, dismissSaveWarning } = useData();

  const authed = !!user;

  useEffect(() => {
    if (state !== "ready") return;

    let target: string | null = null;
    if (!user) {
      if (pathname !== "/login") target = "/login";
    } else if (pathname === "/login") {
      target = "/";
    } else if (user.mustChangePin && pathname !== "/change-pin") {
      // The PIN is temporary/expired — require a change before using the app.
      target = "/change-pin";
    } else if (!canAccess(user.role, pathname)) {
      target = "/";
    }
    if (!target) return;

    // Defer a tick so the App Router is initialized before dispatching a
    // navigation action (avoids "Router action dispatched before initialization").
    const t = setTimeout(() => router.replace(target as string), 0);
    return () => clearTimeout(t);
  }, [state, user, pathname, router]);

  if (state === "loading") {
    return <Spinner label="Opening local database…" />;
  }

  if (!authed) {
    return <div className="min-h-screen bg-slate-100 dark:bg-slate-900">{children}</div>;
  }

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const visibleNav =
    user?.role === "owner"
      ? NAV
      : NAV.filter((n) => COLLECTOR_ROUTES.has(n.href));

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Logo size={36} />
          <div>
            <p className="text-sm font-bold leading-tight text-slate-800 dark:text-slate-100">WiFi Billing</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Collections</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {visibleNav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active(n.href)
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
              }`}
            >
              <span className="flex w-5 shrink-0 items-center justify-center">
                <Icon name={n.icon} size={18} />
              </span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-slate-400 dark:text-slate-500">
          Offline-first · SQLite · PWA
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen flex-1 flex-col md:pl-56">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90 md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <Logo size={32} />
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">WiFi Billing</span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <ThemeToggle />
            {user && (
              <>
                <span className="hidden items-center gap-2 rounded-full bg-slate-100 px-3 py-1 sm:flex dark:bg-slate-700">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{user.name}</span>
                  <span className="capitalize text-slate-400 dark:text-slate-400">{user.role === "owner" ? "Owner" : "Collector"}</span>
                </span>
                <button
                  onClick={logout}
                  className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                >
                  Log out
                </button>
              </>
            )}
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-1 font-medium ${
                online
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              {online ? "Online" : "Offline mode"}
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-10">
          {saveWarning && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
              <span>{saveWarning}</span>
              <button
                onClick={dismissSaveWarning}
                className="shrink-0 rounded-md p-0.5 text-amber-600 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
                aria-label="Dismiss warning"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-700 dark:bg-slate-800 md:hidden">
        {visibleNav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              active(n.href) ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            <span className="flex h-5 items-center justify-center">
              <Icon name={n.icon} size={20} />
            </span>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}