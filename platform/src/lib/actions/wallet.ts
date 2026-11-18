"use server";

import { randomInt } from "node:crypto";
import { and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { depositMessages, deposits, paymentMethods } from "@/lib/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { bool, done, fail, int, str, type ActionState } from "@/lib/action-state";
import { toAssetAmount } from "@/lib/deposits";
import { formatMoney, parseMoney } from "@/lib/format";
import { audit, notifyAdmins, notifyUser } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { saveUpload, UploadError } from "@/lib/storage";
import { moveBalance } from "@/lib/wallet";

/* ------------------------------------------------------------ user side */

export async function createDepositAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = await getSettings();
  if (!rateLimit(`deposit:${user.id}`, 10, 3600_000).ok) return fail("Too many deposit requests. Try again later.");

  const [method] = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.id, int(fd, "methodId")), eq(paymentMethods.isActive, true)));
  if (!method) return fail("Choose a payment method.");

  const amount = parseMoney(str(fd, "amount"));
  const min = Math.max(s.depositMin, method.minAmount);
  if (amount == null || amount < min) return fail(`Minimum deposit is ${formatMoney(min)}.`, { amount: `At least ${formatMoney(min)}` });
  if (amount > 10_000_000) return fail("That amount is too large for a single deposit.");

  const [{ open }] = await db
    .select({ open: count() })
    .from(deposits)
    .where(and(eq(deposits.userId, user.id), eq(deposits.status, "awaiting_payment"), gt(deposits.expiresAt, new Date())));
  if (open >= s.maxOpenDeposits) return fail(`You already have ${open} open deposit(s). Finish or cancel one first.`);

  // Add a few unique cents so the admin can match the incoming transfer to this request.
  let usd = amount;
  let payAmount = toAssetAmount(usd, method.rate, method.decimals);
  if (s.depositUniqueCents) {
    const taken = new Set(
      (
        await db
          .select({ p: deposits.payAmount })
          .from(deposits)
          .where(and(eq(deposits.methodId, method.id), inArray(deposits.status, ["awaiting_payment", "under_review", "needs_info"])))
      ).map((r) => r.p),
    );
    for (let i = 0; i < 50; i++) {
      usd = amount + randomInt(1, 100);
      payAmount = toAssetAmount(usd, method.rate, method.decimals);
      if (!taken.has(payAmount)) break;
    }
  }

  const [d] = await db
    .insert(deposits)
    .values({
      userId: user.id,
      methodId: method.id,
      methodName: method.name,
      asset: method.asset,
      network: method.network,
      address: method.address,
      memo: method.memo,
      amount: usd,
      payAmount,
      expiresAt: new Date(Date.now() + s.depositExpiryMinutes * 60_000),
    })
    .returning({ id: deposits.id });
  redirect(`/wallet/deposits/${d.id}`);
}

async function ownDeposit(userId: number, id: number) {
  const [d] = await db.select().from(deposits).where(and(eq(deposits.id, id), eq(deposits.userId, userId)));
  return d;
}

export async function submitReceiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = await getSettings();
  const d = await ownDeposit(user.id, int(fd, "id"));
  if (!d) return fail("Deposit not found.");
  if (d.status !== "awaiting_payment") return fail("This deposit can't accept a receipt anymore.");
  if (Date.now() > d.expiresAt.getTime() + s.depositGraceMinutes * 60_000)
    return fail("This deposit has expired. Contact support if you already paid.");

  let receiptPath: string | null;
  try {
    receiptPath = await saveUpload(fd.get("receipt"), "receipt");
  } catch (e) {
    return fail(e instanceof UploadError ? e.message : "Upload failed.");
  }
  if (!receiptPath) return fail("Attach a screenshot or PDF of your payment.", { receipt: "Required" });
  const txHash = str(fd, "txHash").slice(0, 200) || null;
  if (txHash) {
    const [reused] = await db
      .select({ id: deposits.id })
      .from(deposits)
      .where(
        and(
          sql`lower(${deposits.txHash}) = lower(${txHash})`,
          ne(deposits.id, d.id),
          inArray(deposits.status, ["under_review", "needs_info", "approved"]),
        ),
      )
      .limit(1);
    if (reused) return fail("This transaction hash was already used for another deposit.");
  }

  const [updated] = await db
    .update(deposits)
    .set({ status: "under_review", receiptPath, txHash, submittedAt: new Date() })
    .where(and(eq(deposits.id, d.id), eq(deposits.status, "awaiting_payment")))
    .returning({ id: deposits.id });
  if (!updated) return fail("This deposit was already submitted.");

  await notifyAdmins(
    `Deposit #${d.id} needs review`,
    `${user.username} submitted a receipt for ${d.payAmount} ${d.asset} (${d.network}) ≈ ${formatMoney(d.amount)}.${txHash ? `\nTX: ${txHash}` : ""}`,
    `/admin/deposits/${d.id}`,
  );
  revalidatePath(`/wallet/deposits/${d.id}`);
  return done("Receipt submitted. We'll credit your balance once the payment is confirmed.");
}

export async function cancelDepositAction(fd: FormData) {
  const user = await requireUser();
  const id = int(fd, "id");
  await db
    .update(deposits)
    .set({ status: "cancelled" })
    .where(and(eq(deposits.id, id), eq(deposits.userId, user.id), eq(deposits.status, "awaiting_payment")));
  revalidatePath(`/wallet/deposits/${id}`);
}

export async function replyDepositAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const d = await ownDeposit(user.id, int(fd, "id"));
  if (!d) return fail("Deposit not found.");
  if (d.status !== "needs_info") return fail("This deposit isn't waiting for your reply.");
  const body = str(fd, "body");
  let attachmentPath: string | null;
  try {
    attachmentPath = await saveUpload(fd.get("attachment"), "receipt");
  } catch (e) {
    return fail(e instanceof UploadError ? e.message : "Upload failed.");
  }
  if (body.length < 2 && !attachmentPath) return fail("Write a reply or attach a file.");

  const reopened = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(deposits)
      .set({ status: "under_review" })
      .where(and(eq(deposits.id, d.id), eq(deposits.status, "needs_info")))
      .returning({ id: deposits.id });
    if (!row) return false;
    await tx.insert(depositMessages).values({ depositId: d.id, authorId: user.id, body: body.slice(0, 2000) || "(attachment)", attachmentPath });
    return true;
  });
  if (!reopened) return fail("This deposit isn't waiting for your reply.");
  await notifyAdmins(`Deposit #${d.id}: user replied`, `${user.username} replied:\n${body}`, `/admin/deposits/${d.id}`);
  revalidatePath(`/wallet/deposits/${d.id}`);
  return done("Reply sent.");
}

/* ----------------------------------------------------------- admin side */

export async function reviewDepositAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const decision = str(fd, "decision");
  const note = str(fd, "note");

  if (decision === "approve") {
    const credit = parseMoney(str(fd, "credit"));
    if (credit == null || credit <= 0) return fail("Enter the amount to credit.");
    const result = await db.transaction(async (tx) => {
      const [d] = await tx.select().from(deposits).where(eq(deposits.id, id)).for("update");
      if (!d || ["approved", "rejected", "cancelled"].includes(d.status)) return null;
      await tx
        .update(deposits)
        .set({ status: "approved", creditedAmount: credit, reviewedAt: new Date(), reviewedBy: admin.id, adminNote: note || null })
        .where(eq(deposits.id, id));
      await moveBalance(tx, d.userId, {
        type: "deposit",
        amount: credit,
        depositedDelta: credit,
        description: `Deposit #${d.id} — ${d.payAmount} ${d.asset} (${d.network})`,
        refType: "deposit",
        refId: d.id,
        actorId: admin.id,
      });
      return d;
    });
    if (!result) return fail("This deposit was already handled.");
    await notifyUser(result.userId, `Deposit approved: ${formatMoney(credit)} added`, { href: `/wallet/deposits/${id}` });
    await audit(admin.id, "deposit.approve", "deposit", id, { credit, requested: result.amount });
  } else if (decision === "reject") {
    if (note.length < 3) return fail("Give the user a reason for rejecting.");
    const [d] = await db
      .update(deposits)
      .set({ status: "rejected", reviewedAt: new Date(), reviewedBy: admin.id, adminNote: note })
      .where(and(eq(deposits.id, id), inArray(deposits.status, ["awaiting_payment", "under_review", "needs_info", "expired"])))
      .returning();
    if (!d) return fail("This deposit was already handled.");
    await notifyUser(d.userId, `Deposit #${id} rejected`, { body: note, href: `/wallet/deposits/${id}` });
    await audit(admin.id, "deposit.reject", "deposit", id, { note });
  } else if (decision === "info") {
    if (note.length < 3) return fail("Write what you need from the user.");
    const d = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(deposits)
        .set({ status: "needs_info" })
        .where(and(eq(deposits.id, id), inArray(deposits.status, ["under_review", "needs_info", "expired"])))
        .returning();
      if (row) await tx.insert(depositMessages).values({ depositId: id, authorId: admin.id, fromAdmin: true, body: note });
      return row;
    });
    if (!d) return fail("Clarification can only be requested on submitted deposits.");
    await notifyUser(d.userId, `Deposit #${id}: more information needed`, { body: note, href: `/wallet/deposits/${id}` });
    await audit(admin.id, "deposit.request_info", "deposit", id);
  } else {
    return fail("Unknown action.");
  }
  revalidatePath(`/admin/deposits/${id}`);
  return done("Done.");
}

const methodSchema = z.object({
  name: z.string().trim().min(2, "Name required"),
  asset: z.string().trim().min(1, "Asset required").max(12).transform((v) => v.toUpperCase()),
  network: z.string().trim().min(2, "Network required").max(20).transform((v) => v.toUpperCase()),
  address: z.string().trim().min(10, "Wallet address looks too short").max(200),
  memo: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(1000).optional(),
  rate: z.string().trim().regex(/^\d+(\.\d+)?$/, "Rate must be a number"),
  decimals: z.coerce.number().int().min(0).max(8),
});

export async function savePaymentMethodAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const parsed = methodSchema.safeParse({
    name: str(fd, "name"),
    asset: str(fd, "asset"),
    network: str(fd, "network"),
    address: str(fd, "address"),
    memo: str(fd, "memo") || undefined,
    instructions: str(fd, "instructions") || undefined,
    rate: str(fd, "rate") || "1",
    decimals: str(fd, "decimals") || "2",
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (Number(parsed.data.rate) <= 0) return fail("Rate must be above zero.");
  const minAmount = parseMoney(str(fd, "minAmount") || "0") ?? 0;
  const values = {
    ...parsed.data,
    memo: parsed.data.memo ?? null,
    instructions: parsed.data.instructions ?? null,
    minAmount,
    isActive: id ? bool(fd, "isActive") : true,
    sortOrder: int(fd, "sortOrder"),
  };
  if (id) await db.update(paymentMethods).set(values).where(eq(paymentMethods.id, id));
  else await db.insert(paymentMethods).values(values);
  await audit(admin.id, id ? "wallet.update" : "wallet.create", "payment_method", id || values.name, { network: values.network, address: values.address });
  revalidatePath("/admin/wallets");
  return done(id ? "Wallet saved" : "Wallet added");
}

export async function deletePaymentMethodAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  await db.delete(paymentMethods).where(eq(paymentMethods.id, id));
  await audit(admin.id, "wallet.delete", "payment_method", id);
  revalidatePath("/admin/wallets");
}
