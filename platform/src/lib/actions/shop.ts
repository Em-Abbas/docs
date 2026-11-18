"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { inventoryItems, notifications, orderItems, orders, products, refundRequests, resellerEarnings, users } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { done, fail, int, str, type ActionState } from "@/lib/action-state";
import { formatMoney } from "@/lib/format";
import { audit, notifyAdmins, notifyUser } from "@/lib/notify";
import { purchase, PurchaseError } from "@/lib/purchase";
import { moveBalance } from "@/lib/wallet";

/* ------------------------------------------------------------------ buying */

export async function buyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!rateLimit(`buy:${user.id}`, 30, 60_000).ok) return fail("Slow down — too many orders in a minute.");
  const productId = int(fd, "productId");
  const itemIds = fd
    .getAll("item")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 1000);
  const quantity = int(fd, "quantity");

  let orderId: number;
  try {
    const order = await purchase(user.id, productId, itemIds.length ? { itemIds } : { quantity });
    orderId = order.id;
  } catch (e) {
    if (e instanceof PurchaseError) return fail(e.message);
    console.error("purchase failed", e);
    return fail("Something went wrong. You were not charged.");
  }
  revalidatePath("/", "layout");
  redirect(`/orders/${orderId}?new=1`);
}

/* ----------------------------------------------------------------- refunds */

export async function requestRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const itemId = int(fd, "itemId");
  const reason = str(fd, "reason");
  if (reason.length < 10) return fail("Describe the problem in a few words (10+ characters).");

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ item: orderItems, order: orders, refundWindowHours: products.refundWindowHours })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(products, eq(products.id, orders.productId))
      .where(and(eq(orderItems.id, itemId), eq(orders.userId, user.id)))
      .for("update", { of: orderItems });
    if (!row) return "Item not found.";
    if (row.item.refundStatus) return "A refund was already requested for this item.";
    const windowH = row.refundWindowHours ?? 0;
    if (windowH <= 0) return "This product doesn't offer refunds.";
    if (Date.now() - row.order.createdAt.getTime() > windowH * 3600_000) return `The ${windowH}-hour refund window has passed.`;

    await tx.insert(refundRequests).values({ orderItemId: itemId, orderId: row.order.id, userId: user.id, amount: row.item.price, reason: reason.slice(0, 1000) });
    await tx.update(orderItems).set({ refundStatus: "pending" }).where(eq(orderItems.id, itemId));
    return { orderId: row.order.id, amount: row.item.price, product: row.order.productName };
  });
  if (typeof result === "string") return fail(result);

  await notifyAdmins(
    "Refund requested",
    `${user.username} requested a refund of ${formatMoney(result.amount)} on order #${result.orderId} (${result.product}).\nReason: ${reason}`,
    "/admin/refunds",
  );
  revalidatePath(`/orders/${result.orderId}`);
  return done("Refund requested. We'll review it shortly.");
}

export async function resolveRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const decision = str(fd, "decision");
  const note = str(fd, "note") || null;
  if (decision !== "approve" && decision !== "reject") return fail("Choose approve or reject.");

  const outcome = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refundRequests).where(eq(refundRequests.id, id)).for("update");
    if (!r || r.status !== "pending") return null;
    const approved = decision === "approve";
    await tx
      .update(refundRequests)
      .set({ status: approved ? "approved" : "rejected", adminNote: note, resolvedBy: admin.id, resolvedAt: new Date() })
      .where(eq(refundRequests.id, id));
    await tx.update(orderItems).set({ refundStatus: approved ? "approved" : "rejected" }).where(eq(orderItems.id, r.orderItemId));

    if (approved) {
      const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, r.orderItemId));
      await tx.update(inventoryItems).set({ status: "refunded" }).where(eq(inventoryItems.id, item.inventoryItemId));
      const [o] = await tx
        .update(orders)
        .set({ refunded: sql`${orders.refunded} + ${r.amount}` })
        .where(eq(orders.id, r.orderId))
        .returning();
      await tx
        .update(orders)
        .set({ status: o.refunded >= o.total ? "refunded" : "partially_refunded" })
        .where(eq(orders.id, r.orderId));
      await moveBalance(tx, r.userId, {
        type: "refund",
        amount: r.amount,
        spentDelta: -r.amount,
        description: `Refund — order #${r.orderId}`,
        refType: "refund",
        refId: r.id,
        actorId: admin.id,
      });
      // Claw back reseller earnings for this item.
      const [earning] = await tx
        .select()
        .from(resellerEarnings)
        .where(eq(resellerEarnings.orderItemId, r.orderItemId))
        .for("update");
      if (earning && earning.status !== "reversed") {
        const col = earning.status === "pending" ? users.earningsPending : users.earningsAvailable;
        await tx
          .update(users)
          .set(earning.status === "pending" ? { earningsPending: sql`${col} - ${earning.net}` } : { earningsAvailable: sql`${col} - ${earning.net}` })
          .where(eq(users.id, earning.resellerId));
        await tx.update(resellerEarnings).set({ status: "reversed" }).where(eq(resellerEarnings.id, earning.id));
      }
    }
    return { r, approved };
  });
  if (!outcome) return fail("This refund was already handled.");

  await notifyUser(outcome.r.userId, outcome.approved ? `Refund approved: ${formatMoney(outcome.r.amount)}` : "Refund request declined", {
    body: note ?? undefined,
    href: `/orders/${outcome.r.orderId}`,
  });
  await audit(admin.id, `refund.${outcome.approved ? "approve" : "reject"}`, "refund", id, { amount: outcome.r.amount });
  revalidatePath("/admin/refunds");
  return done(outcome.approved ? "Refund approved and balance credited." : "Refund rejected.");
}

/* ----------------------------------------------------------- notifications */

export async function openNotificationAction(fd: FormData) {
  const user = await requireUser();
  const id = int(fd, "id");
  const [n] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
    .returning();
  redirect(n?.href && n.href.startsWith("/") ? n.href : "/notifications");
}

export async function markAllReadAction() {
  const user = await requireUser();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath("/", "layout");
}
