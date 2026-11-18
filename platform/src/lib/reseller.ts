import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resellerEarnings, users } from "@/lib/db/schema";

/** Move earnings whose hold period has passed from pending to available. */
export async function releaseMaturedEarnings(resellerId?: number) {
  await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: resellerEarnings.id, resellerId: resellerEarnings.resellerId, net: resellerEarnings.net })
      .from(resellerEarnings)
      .where(
        and(
          eq(resellerEarnings.status, "pending"),
          lte(resellerEarnings.releaseAt, new Date()),
          resellerId ? eq(resellerEarnings.resellerId, resellerId) : undefined,
        ),
      )
      .for("update", { skipLocked: true });
    if (!due.length) return;

    await tx
      .update(resellerEarnings)
      .set({ status: "available" })
      .where(inArray(resellerEarnings.id, due.map((d) => d.id)));
    const totals = new Map<number, number>();
    for (const d of due) totals.set(d.resellerId, (totals.get(d.resellerId) ?? 0) + d.net);
    for (const [id, net] of totals) {
      await tx
        .update(users)
        .set({
          earningsPending: sql`${users.earningsPending} - ${net}`,
          earningsAvailable: sql`${users.earningsAvailable} + ${net}`,
        })
        .where(eq(users.id, id));
    }
  });
}
