/**
 * All amounts are integers in the smallest currency unit (e.g. centavos)
 * to avoid floating-point drift. Change CURRENCY here to re-brand.
 */
export const CURRENCY = "₱";
export const CURRENCY_CODE = "PHP";

export function formatMoney(minor: number): string {
  const major = minor / 100;
  return `${CURRENCY}${major.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "1250.50" or "1,250.50" -> 125050 */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}
