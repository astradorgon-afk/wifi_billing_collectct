import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata = {
  title: "Offline — WiFi Billing",
};

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-400">
        <Icon name="wifi-off" size={30} />
      </span>
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
        This page hasn&apos;t been cached yet. Your saved data is safe — go back
        to the dashboard, which works fully offline.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
