import "server-only";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { inventoryItems, type ProductField } from "@/lib/db/schema";
import { parseMoney } from "@/lib/format";

export const MAX_ROWS_PER_UPLOAD = 50_000;
const MAX_VALUE_LENGTH = 5_000;

/** Stable hash of an item's data — used to skip duplicate rows. Must match scripts/seed.mjs. */
export function hashItemData(data: Record<string, string>): string {
  return createHash("sha256")
    .update(JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]])))
    .digest("hex");
}

export const FIELD_TYPE_LABELS: Record<ProductField["type"], string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  email: "Email",
  url: "URL / link",
  date: "Date",
  boolean: "Yes / No",
  image: "Image (URL or upload)",
  file: "File (URL or upload)",
  secret: "Secret (key, code, password)",
};

export const VISIBILITY_LABELS: Record<ProductField["visibility"], string> = {
  public: "Public — shown before purchase",
  masked: "Masked — partly shown (jo•••@ex•••.com)",
  hidden: "Hidden — only after purchase",
};

/** Validate and normalize one cell. */
export function validateValue(field: Pick<ProductField, "type" | "label" | "required">, raw: string): { value: string } | { error: string } {
  const v = (raw ?? "").trim();
  if (!v) return field.required ? { error: `${field.label} is required` } : { value: "" };
  if (v.length > MAX_VALUE_LENGTH) return { error: `${field.label} is longer than ${MAX_VALUE_LENGTH} characters` };
  switch (field.type) {
    case "number": {
      const n = Number(v.replace(/,/g, ""));
      return Number.isFinite(n) ? { value: String(n) } : { error: `${field.label} must be a number` };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v } : { error: `${field.label} must be an email address` };
    case "url":
    case "image":
    case "file":
      if (v.startsWith("/")) return { value: v };
      try {
        const u = new URL(v);
        return ["http:", "https:"].includes(u.protocol) ? { value: v } : { error: `${field.label} must be an http(s) link` };
      } catch {
        return { error: `${field.label} must be a valid link` };
      }
    case "date": {
      const t = Date.parse(v);
      return Number.isNaN(t) ? { error: `${field.label} must be a date (YYYY-MM-DD)` } : { value: v };
    }
    case "boolean": {
      const l = v.toLowerCase();
      if (["true", "yes", "y", "1"].includes(l)) return { value: "Yes" };
      if (["false", "no", "n", "0"].includes(l)) return { value: "No" };
      return { error: `${field.label} must be yes or no` };
    }
    default:
      return { value: v };
  }
}

const TYPE_HINT: Record<ProductField["type"], string> = {
  text: "text",
  longtext: "long text",
  number: "number e.g. 42",
  email: "email",
  url: "https:// link",
  date: "date YYYY-MM-DD",
  boolean: "yes / no",
  image: "image https:// link",
  file: "file https:// link",
  secret: "secret text",
};

/**
 * Template: header row with field labels, then a `#` hint row describing each
 * column. Rows whose first cell starts with `#` are ignored on upload.
 */
export function buildTemplateCsv(fields: ProductField[], includePrice: boolean): string {
  const active = fields.filter((f) => f.enabled);
  const header = active.map((f) => f.label);
  const hints = active.map((f) => `${TYPE_HINT[f.type]}${f.required ? " (required)" : ""} · ${f.visibility}`);
  if (includePrice) {
    header.push("Price");
    hints.push("optional price override e.g. 9.99");
  }
  hints[0] = `# ${hints[0]}`;
  return "﻿" + Papa.unparse([header, hints]) + "\r\n";
}

export type ParsedRow = { line: number; data: Record<string, string>; price: number | null };

export function parseInventoryCsv(
  text: string,
  fields: ProductField[],
  opts: { allowPrice: boolean },
): { rows: ParsedRow[]; errors: { row: number; message: string }[]; total: number; fatal?: string } {
  const active = fields.filter((f) => f.enabled);
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const lines = parsed.data.filter((r) => !(String(r[0] ?? "").trim().startsWith("#")));
  if (lines.length === 0) return { rows: [], errors: [], total: 0, fatal: "The file is empty." };

  const norm = (s: string) => s.toLowerCase().replace(/[\[(][a-j][\])]$/i, "").replace(/\s+/g, " ").trim();
  const header = lines[0].map((h) => norm(String(h)));
  const colFor = new Map<string, number>();
  let priceCol = -1;
  header.forEach((h, i) => {
    if (h === "price" || h === "__price") priceCol = i;
    const f = active.find((f) => norm(f.label) === h || f.key.toLowerCase() === h);
    if (f && !colFor.has(f.key)) colFor.set(f.key, i);
  });

  const missing = active.filter((f) => f.required && !colFor.has(f.key)).map((f) => f.label);
  if (missing.length) return { rows: [], errors: [], total: 0, fatal: `Missing required column(s): ${missing.join(", ")}. Use the CSV template.` };
  if (colFor.size === 0) return { rows: [], errors: [], total: 0, fatal: "No columns match this product's fields. Use the CSV template." };

  const body = lines.slice(1);
  if (body.length > MAX_ROWS_PER_UPLOAD) {
    return { rows: [], errors: [], total: body.length, fatal: `Too many rows (${body.length}). Upload at most ${MAX_ROWS_PER_UPLOAD} per file.` };
  }

  const rows: ParsedRow[] = [];
  const errors: { row: number; message: string }[] = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const data: Record<string, string> = {};
    const rowErrors: string[] = [];
    for (const f of active) {
      const col = colFor.get(f.key);
      const res = validateValue(f, col == null ? "" : String(cells[col] ?? ""));
      if ("error" in res) rowErrors.push(res.error);
      else if (res.value !== "") data[f.key] = res.value;
    }
    let price: number | null = null;
    if (opts.allowPrice && priceCol >= 0 && String(cells[priceCol] ?? "").trim()) {
      price = parseMoney(String(cells[priceCol]));
      if (price == null) rowErrors.push("Price must be a number like 9.99");
    }
    if (Object.keys(data).length === 0 && rowErrors.length === 0) rowErrors.push("Row has no data");
    if (rowErrors.length) errors.push({ row: line, message: rowErrors.join("; ") });
    else rows.push({ line, data, price });
  });
  return { rows, errors, total: body.length };
}

/** Insert rows in chunks, skipping duplicates of live items. Returns how many were inserted. */
export async function insertItems(
  tx: Tx,
  opts: { productId: number; batchId: number | null; sellerId: number | null; status: "available" | "pending_review" },
  rows: { data: Record<string, string>; price: number | null }[],
): Promise<number> {
  let inserted = 0;
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows
      .slice(i, i + 1000)
      .map((r) => ({ ...r, hash: hashItemData(r.data) }))
      .filter((r) => (seen.has(r.hash) ? false : (seen.add(r.hash), true)));
    if (!chunk.length) continue;
    const res = await tx
      .insert(inventoryItems)
      .values(
        chunk.map((r) => ({
          productId: opts.productId,
          batchId: opts.batchId,
          sellerId: opts.sellerId,
          data: r.data,
          dataHash: r.hash,
          priceOverride: r.price,
          status: opts.status,
        })),
      )
      .onConflictDoNothing({ target: [inventoryItems.productId, inventoryItems.dataHash], where: sql`status <> 'removed'` })
      .returning({ id: inventoryItems.id });
    inserted += res.length;
  }
  return inserted;
}

/* ------------------------------------------------------------- display */

export function maskValue(value: string, type: ProductField["type"]): string {
  if (!value) return "";
  const dots = "•••";
  if (type === "email" && value.includes("@")) {
    const [user, domain] = value.split("@");
    const [host, ...tld] = domain.split(".");
    return `${user.slice(0, 2)}${dots}@${host.slice(0, 2)}${dots}${tld.length ? "." + tld.join(".") : ""}`;
  }
  if (value.length <= 4) return dots;
  if (value.length <= 8) return `${value.slice(0, 1)}${dots}${value.slice(-1)}`;
  return `${value.slice(0, 2)}${dots}${value.slice(-2)}`;
}

/** What a shopper may see for a field before buying. */
export function previewValue(field: Pick<ProductField, "visibility" | "type">, value: string | undefined): string | null {
  if (field.visibility === "hidden") return null;
  if (!value) return "";
  return field.visibility === "masked" ? maskValue(value, field.type) : value;
}
