"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { inventoryItems, payouts, productFields, products, uploadBatches, users } from "@/lib/db/schema";
import { decrypt } from "@/lib/auth/crypto";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireAdmin, requireReseller, requireUser } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { done, fail, int, str, type ActionState } from "@/lib/action-state";
import { formatMoney, parseMoney } from "@/lib/format";
import { insertItems, parseInventoryCsv } from "@/lib/inventory";
import { audit, notifyAdmins, notifyUser } from "@/lib/notify";
import { releaseMaturedEarnings } from "@/lib/reseller";
import { getSettings } from "@/lib/settings";

/* ------------------------------------------------------------- reseller */

export async function applyResellerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = await getSettings();
  if (!s.resellerProgramEnabled) return fail("The reseller program is closed right now.");
  if (user.resellerStatus === "pending" || user.resellerStatus === "approved") return fail("You've already applied.");
  const pitch = str(fd, "application");
  if (pitch.length < 20) return fail("Tell us a bit more about what you'd supply (20+ characters).");
  await db
    .update(users)
    .set({ resellerStatus: "pending", resellerApplication: pitch.slice(0, 2000), resellerNote: null })
    .where(eq(users.id, user.id));
  await notifyAdmins("New reseller application", `${user.username} applied to become a reseller:\n${pitch}`, "/admin/resellers?tab=applications");
  revalidatePath("/reseller");
  return done("Application sent.");
}

export async function setPayoutWalletAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireReseller();
  const network = str(fd, "network").toUpperCase();
  const address = str(fd, "address");
  if (!/^[A-Z0-9]{2,12}$/.test(network)) return fail("Choose a network.");
  if (address.length < 10 || address.length > 200 || /\s/.test(address)) return fail("That address doesn't look right.");
  // Changing where money goes requires a fresh 2FA code.
  if (!rateLimit(`payout-wallet:${user.id}`, 8, 600_000).ok) return fail("Too many attempts. Try again later.");
  const step = user.totpSecretEnc ? verifyTotp(decrypt(user.totpSecretEnc), str(fd, "code"), user.totpLastStep) : null;
  if (step == null) return fail("Authenticator code is not valid.");
  await db.update(users).set({ payoutNetwork: network, payoutAddress: address, totpLastStep: step }).where(eq(users.id, user.id));
  await audit(user.id, "reseller.payout_wallet", "user", user.id, { network, address });
  revalidatePath("/reseller");
  return done("Payout wallet saved.");
}

export async function requestPayoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireReseller();
  const s = await getSettings();
  const amount = parseMoney(str(fd, "amount"));
  if (amount == null || amount < s.payoutMin) return fail(`Minimum payout is ${formatMoney(s.payoutMin)}.`);
  await releaseMaturedEarnings(user.id);

  const result = await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, user.id)).for("update");
    if (!u.payoutAddress || !u.payoutNetwork) return "Set your payout wallet first.";
    if (u.earningsAvailable < amount) return `You can withdraw up to ${formatMoney(u.earningsAvailable)}.`;
    await tx.update(users).set({ earningsAvailable: u.earningsAvailable - amount }).where(eq(users.id, u.id));
    const [p] = await tx
      .insert(payouts)
      .values({ resellerId: u.id, amount, network: u.payoutNetwork, address: u.payoutAddress })
      .returning();
    return p;
  });
  if (typeof result === "string") return fail(result);
  await notifyAdmins(
    "Payout requested",
    `${user.username} requested a payout of ${formatMoney(amount)} to ${result.network} ${result.address}.`,
    "/admin/resellers?tab=payouts",
  );
  revalidatePath("/reseller");
  return done("Payout requested. You'll be notified when it's sent.");
}

export async function resellerUploadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireReseller();
  const productId = int(fd, "productId");
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.resellerEnabled, true)));
  if (!product || product.status === "draft") return fail("This product doesn't accept reseller stock.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.");
  if (file.size > 25 * 1024 * 1024) return fail("File is larger than 25 MB.");
  if (!rateLimit(`reseller-upload:${user.id}`, 20, 3600_000).ok) return fail("Too many uploads. Try again later.");

  const fields = await db.select().from(productFields).where(eq(productFields.productId, productId));
  const parsed = parseInventoryCsv(await file.text(), fields, { allowPrice: false });
  if (parsed.fatal) return fail(parsed.fatal);

  const summary = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(uploadBatches)
      .values({
        productId,
        uploaderId: user.id,
        isReseller: true,
        filename: file.name.slice(0, 120),
        totalRows: parsed.total,
        status: "pending_review",
      })
      .returning({ id: uploadBatches.id });
    const inserted = await insertItems(tx, { productId, batchId: batch.id, sellerId: user.id, status: "pending_review" }, parsed.rows);
    await tx
      .update(uploadBatches)
      .set({
        acceptedRows: inserted,
        rejectedRows: parsed.errors.length,
        duplicateRows: parsed.rows.length - inserted,
        errors: parsed.errors.slice(0, 200),
        ...(inserted === 0 ? { status: "rejected" as const, reviewNote: "No new rows" } : {}),
      })
      .where(eq(uploadBatches.id, batch.id));
    return { inserted, batchId: batch.id };
  });

  if (summary.inserted > 0) {
    await notifyAdmins(
      "Reseller stock to review",
      `${user.username} uploaded ${summary.inserted} item(s) for ${product.name}.`,
      "/admin/resellers?tab=stock",
    );
  }
  revalidatePath("/reseller");
  const extra = parsed.errors.length ? ` ${parsed.errors.length} row(s) rejected.` : "";
  return summary.inserted
    ? done(`${summary.inserted} item(s) submitted for review.${extra}`)
    : fail(`No new items were added (duplicates or invalid rows).${extra}`);
}

/* ---------------------------------------------------------------- admin */

export async function reviewApplicationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const decision = str(fd, "decision");
  const note = str(fd, "note") || null;
  if (decision === "approve") {
    await db
      .update(users)
      .set({ resellerStatus: "approved", resellerNote: note, role: sql`case when ${users.role} = 'admin' then 'admin'::role else 'reseller'::role end` })
      .where(eq(users.id, id));
    await notifyUser(id, "You're now a reseller", { body: note ?? "You can start supplying stock.", href: "/reseller" });
  } else if (decision === "reject") {
    await db.update(users).set({ resellerStatus: "rejected", resellerNote: note }).where(eq(users.id, id));
    await notifyUser(id, "Reseller application declined", { body: note ?? undefined, href: "/reseller" });
  } else if (decision === "revoke") {
    await db
      .update(users)
      .set({ resellerStatus: "rejected", resellerNote: note, role: sql`case when ${users.role} = 'admin' then 'admin'::role else 'user'::role end` })
      .where(eq(users.id, id));
    await db
      .update(inventoryItems)
      .set({ status: "removed" })
      .where(and(eq(inventoryItems.sellerId, id), sql`${inventoryItems.status} in ('available','pending_review')`));
    await notifyUser(id, "Reseller access removed", { body: note ?? undefined });
  } else return fail("Unknown action.");
  await audit(admin.id, `reseller.${decision}`, "user", id, { note });
  revalidatePath("/admin/resellers");
  return done("Saved.");
}

export async function reviewBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const approve = str(fd, "decision") === "approve";
  const note = str(fd, "note") || null;
  const batch = await db.transaction(async (tx) => {
    const [b] = await tx
      .update(uploadBatches)
      .set({ status: approve ? "approved" : "rejected", reviewNote: note, reviewedAt: new Date() })
      .where(and(eq(uploadBatches.id, id), eq(uploadBatches.status, "pending_review")))
      .returning();
    if (!b) return null;
    await tx
      .update(inventoryItems)
      .set({ status: approve ? "available" : "removed" })
      .where(and(eq(inventoryItems.batchId, id), eq(inventoryItems.status, "pending_review")));
    return b;
  });
  if (!batch) return fail("This upload was already reviewed.");
  await notifyUser(batch.uploaderId, approve ? `Stock approved: ${batch.acceptedRows} item(s) are live` : "Stock upload rejected", {
    body: note ?? undefined,
    href: "/reseller?tab=stock",
  });
  await audit(admin.id, `reseller.batch_${approve ? "approve" : "reject"}`, "upload_batch", id);
  revalidatePath("/admin/resellers");
  return done(approve ? "Items are now live." : "Upload rejected.");
}

export async function processPayoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const paid = str(fd, "decision") === "paid";
  const txHash = str(fd, "txHash") || null;
  const note = str(fd, "note") || null;
  if (paid && !txHash) return fail("Enter the transaction hash of the payout.");

  const payout = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, id)).for("update");
    if (!p || p.status !== "pending") return null;
    await tx
      .update(payouts)
      .set({ status: paid ? "paid" : "rejected", txHash, adminNote: note, processedBy: admin.id, processedAt: new Date() })
      .where(eq(payouts.id, id));
    await tx
      .update(users)
      .set(
        paid
          ? { earningsPaid: sql`${users.earningsPaid} + ${p.amount}` }
          : { earningsAvailable: sql`${users.earningsAvailable} + ${p.amount}` },
      )
      .where(eq(users.id, p.resellerId));
    return p;
  });
  if (!payout) return fail("This payout was already processed.");
  await notifyUser(payout.resellerId, paid ? `Payout sent: ${formatMoney(payout.amount)}` : "Payout request declined", {
    body: paid ? `TX: ${txHash}` : (note ?? "The amount was returned to your available earnings."),
    href: "/reseller?tab=payouts",
  });
  await audit(admin.id, `payout.${paid ? "paid" : "reject"}`, "payout", id, { amount: payout.amount, txHash });
  revalidatePath("/admin/resellers");
  return done(paid ? "Marked as paid." : "Payout rejected and returned to the reseller.");
}
