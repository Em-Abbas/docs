import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryItems,
  orderItems,
  orders,
  priceTiers,
  productFields,
  products,
  resellerEarnings,
  users,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { unitPriceFor } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { moveBalance } from "@/lib/wallet";

export class PurchaseError extends Error {}

const HARD_MAX_QTY = 5000;

/**
 * Buys specific items (itemIds) or the oldest N available (quantity).
 * Everything happens in one transaction:
 *  - the buyer row is locked, so concurrent orders can't overspend
 *  - items are locked with SKIP LOCKED, so two buyers never get the same row
 */
export async function purchase(userId: number, productId: number, sel: { itemIds?: number[]; quantity?: number }) {
  const s = await getSettings();

  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.status !== "active") throw new PurchaseError("Your account can't make purchases right now.");

    const [product] = await tx.select().from(products).where(and(eq(products.id, productId), eq(products.status, "active")));
    if (!product) throw new PurchaseError("This product is no longer available.");

    if (product.minBalance > 0 && user.balance < product.minBalance) {
      throw new PurchaseError(
        `This product requires a wallet balance of at least ${formatMoney(product.minBalance)} before you can buy. Add funds to continue.`,
      );
    }

    const picking = !!sel.itemIds?.length;
    if (picking && !product.allowPick) throw new PurchaseError("Choose a quantity for this product instead of individual items.");
    const qty = picking ? sel.itemIds!.length : Math.floor(sel.quantity ?? 0);
    if (!Number.isFinite(qty) || qty < 1) throw new PurchaseError("Choose at least one item.");
    if (qty < product.minQty) throw new PurchaseError(`Minimum order is ${product.minQty} items.`);
    if ((product.maxQty && qty > product.maxQty) || qty > HARD_MAX_QTY)
      throw new PurchaseError(`Maximum order is ${product.maxQty ?? HARD_MAX_QTY} items.`);

    const base = tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.productId, productId),
          eq(inventoryItems.status, "available"),
          picking ? inArray(inventoryItems.id, sel.itemIds!) : undefined,
        ),
      );
    const items = picking
      ? await base.for("update", { skipLocked: true })
      : await base.orderBy(asc(inventoryItems.id)).limit(qty).for("update", { skipLocked: true });

    if (picking && items.length !== qty) {
      throw new PurchaseError(`${qty - items.length} of the selected items were just sold. Refresh and pick again.`);
    }
    if (!picking && items.length < qty) {
      throw new PurchaseError(items.length ? `Only ${items.length} available right now.` : "Out of stock.");
    }

    const tiers = await tx.select().from(priceTiers).where(eq(priceTiers.productId, productId));
    const unit = unitPriceFor(product.price, tiers, qty);
    const priced = items.map((i) => ({ item: i, price: i.priceOverride ?? unit }));
    const total = priced.reduce((sum, p) => sum + p.price, 0);
    if (user.balance < total) {
      throw new PurchaseError(`Insufficient balance. Order total is ${formatMoney(total)}, your balance is ${formatMoney(user.balance)}.`);
    }

    const fields = (await tx.select().from(productFields).where(eq(productFields.productId, productId)))
      .filter((f) => f.enabled)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => ({ key: f.key, label: f.label, type: f.type }));

    const [order] = await tx
      .insert(orders)
      .values({
        userId,
        productId,
        productName: product.name,
        fields,
        deliveryNote: product.deliveryNote,
        quantity: qty,
        total,
      })
      .returning();

    const createdItems = await tx
      .insert(orderItems)
      .values(
        priced.map(({ item, price }) => ({
          orderId: order.id,
          inventoryItemId: item.id,
          sellerId: item.sellerId,
          price,
          data: item.data,
        })),
      )
      .returning({ id: orderItems.id, sellerId: orderItems.sellerId, price: orderItems.price });

    await tx
      .update(inventoryItems)
      .set({ status: "sold", orderId: order.id, buyerId: userId, soldAt: new Date() })
      .where(inArray(inventoryItems.id, items.map((i) => i.id)));

    await moveBalance(tx, userId, {
      type: "purchase",
      amount: -total,
      spentDelta: total,
      description: `Order #${order.id} — ${qty} × ${product.name}`,
      refType: "order",
      refId: order.id,
    });

    // Reseller stock: credit earnings (held until the refund window passes).
    const releaseAt = new Date(Date.now() + Math.max(s.resellerHoldDays * 86400_000, product.refundWindowHours * 3600_000));
    const perSeller = new Map<number, number>();
    const earningRows = createdItems
      .filter((ci) => ci.sellerId != null)
      .map((ci) => {
        const fee = Math.round((ci.price * s.resellerFeePercent) / 100);
        perSeller.set(ci.sellerId!, (perSeller.get(ci.sellerId!) ?? 0) + (ci.price - fee));
        return {
          resellerId: ci.sellerId!,
          orderItemId: ci.id,
          productName: product.name,
          gross: ci.price,
          fee,
          net: ci.price - fee,
          releaseAt,
        };
      });
    if (earningRows.length) {
      await tx.insert(resellerEarnings).values(earningRows);
      for (const [sellerId, net] of perSeller) {
        await tx.update(users).set({ earningsPending: sql`${users.earningsPending} + ${net}` }).where(eq(users.id, sellerId));
      }
    }

    return order;
  });
}
