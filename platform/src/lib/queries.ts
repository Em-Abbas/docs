import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryItems } from "@/lib/db/schema";

/** { productId: { available: n, sold: n, ... } } */
export async function stockCounts(productIds: number[]) {
  if (!productIds.length) return new Map<number, Record<string, number>>();
  const rows = await db
    .select({ productId: inventoryItems.productId, status: inventoryItems.status, n: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(inArray(inventoryItems.productId, productIds))
    .groupBy(inventoryItems.productId, inventoryItems.status);
  const map = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const m = map.get(r.productId) ?? {};
    m[r.status] = r.n;
    map.set(r.productId, m);
  }
  return map;
}
