export function formatMoney(cents: number | null | undefined, currency = "USD"): string {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

/** "12.5" | "12,50" | "$12.50" → 1250. Returns null when not a valid non-negative amount. */
export function parseMoney(input: FormDataEntryValue | string | null | undefined): number | null {
  if (input == null) return null;
  const clean = String(input).trim().replace(/[$\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const centsToInput = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2));

export function formatDate(d: Date | string | null | undefined, withTime = true): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function timeAgo(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
  ];
  let label = "";
  for (const [size, name] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      label = `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return s > 2592000 ? formatDate(date, false) : label;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const FIELD_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : pluralWord}`;
}
