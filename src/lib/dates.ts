/** Date helpers — all dates are stored as ISO strings (YYYY-MM-DD or full ISO). */

export function todayISO(): string {
  return toISODate(new Date());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Local-time ISO datetime (YYYY-MM-DDTHH:mm:ss.sss) so created_at timestamps,
 * invoice numbers and month bucketing all agree with the calendar the biller
 * actually uses — a UTC clock at 11 PM local would otherwise push payments
 * into the "wrong" month.
 */
export function nowISO(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${toISODate(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
}

/** "2026-09" from a Date or ISO string. */
export function monthKey(d: Date | string = new Date()): string {
  const iso = typeof d === "string" ? d.slice(0, 10) : toISODate(d);
  return iso.slice(0, 7);
}

/** First and last day of "YYYY-MM". */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate(); // day 0 of next month
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toISODate(dt);
}

/** Previous month key, e.g. "2026-09" -> "2026-08". */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(y, m - 2, 1);
  return monthKey(dt);
}

/** "2026-09-12" -> "Sep 12, 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "2026-09" -> "September 2026" */
export function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });
}

/** Days from today (negative = past due). */
export function daysFromToday(iso: string): number {
  const a = new Date(todayISO()).getTime();
  const b = new Date(iso.slice(0, 10)).getTime();
  return Math.round((b - a) / 86_400_000);
}
