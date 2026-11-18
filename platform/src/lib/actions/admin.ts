"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { bool, done, fail, int, str, type ActionState } from "@/lib/action-state";
import { formatMoney, parseMoney } from "@/lib/format";
import { audit, notifyUser } from "@/lib/notify";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";
import { moveBalance, WalletError } from "@/lib/wallet";

/* ------------------------------------------------------------------ users */

export async function adjustBalanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = int(fd, "userId");
  const op = str(fd, "op");
  const amount = parseMoney(str(fd, "amount"));
  const reason = str(fd, "reason");
  if (amount == null || amount <= 0) return fail("Enter an amount above zero.");
  if (reason.length < 3) return fail("Add a reason — it's shown in the user's balance history.");

  const moves: Record<string, Parameters<typeof moveBalance>[2]> = {
    credit: { type: "adjustment", amount, description: `Credit: ${reason}` },
    debit: { type: "adjustment", amount: -amount, description: `Debit: ${reason}` },
    freeze: { type: "freeze", amount: -amount, frozenDelta: amount, description: `Frozen: ${reason}` },
    unfreeze: { type: "unfreeze", amount, frozenDelta: -amount, description: `Released: ${reason}` },
  };
  const move = moves[op];
  if (!move) return fail("Choose an action.");

  try {
    await db.transaction((tx) => moveBalance(tx, userId, { ...move, actorId: admin.id, refType: "admin" }));
  } catch (e) {
    if (e instanceof WalletError) return fail(e.message === "Insufficient balance" ? "The user doesn't have that much available." : e.message);
    throw e;
  }
  const verb = { credit: "credited to", debit: "deducted from", freeze: "frozen in", unfreeze: "released in" }[op as "credit"];
  await notifyUser(userId, `${formatMoney(amount)} ${verb} your balance`, { body: reason, href: "/wallet" });
  await audit(admin.id, `user.balance_${op}`, "user", userId, { amount, reason });
  revalidatePath(`/admin/users/${userId}`);
  return done(`${formatMoney(amount)} ${verb} the balance.`);
}

export async function setUserStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = int(fd, "userId");
  if (userId === admin.id) return fail("You can't change your own account here.");
  const action = str(fd, "action");

  if (action === "ban" || action === "unban") {
    await db
      .update(users)
      .set({ status: action === "ban" ? "banned" : "active" })
      .where(and(eq(users.id, userId), ne(users.status, "pending_setup")));
    if (action === "ban") await db.delete(sessions).where(eq(sessions.userId, userId));
  } else if (action === "reset2fa") {
    await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, backupCodes: [] }).where(eq(users.id, userId));
    await db.delete(sessions).where(eq(sessions.userId, userId));
  } else if (action === "unlock") {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
  } else if (action === "make_admin" || action === "remove_admin") {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    const role = action === "make_admin" ? "admin" : u.resellerStatus === "approved" ? "reseller" : "user";
    await db.update(users).set({ role }).where(eq(users.id, userId));
  } else {
    return fail("Unknown action.");
  }
  await audit(admin.id, `user.${action}`, "user", userId);
  revalidatePath(`/admin/users/${userId}`);
  const msg: Record<string, string> = {
    ban: "User suspended and signed out.",
    unban: "User reactivated.",
    reset2fa: "Two-factor reset. They'll scan a new QR code at next login.",
    unlock: "Login lock cleared.",
    make_admin: "User is now an admin.",
    remove_admin: "Admin rights removed.",
  };
  return done(msg[action]);
}

/* --------------------------------------------------------------- settings */

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const money = (k: string) => parseMoney(str(fd, k));
  const patch: Partial<Settings> = {
    siteName: str(fd, "siteName") || DEFAULT_SETTINGS.siteName,
    adminEmail: str(fd, "adminEmail"),
    announcement: str(fd, "announcement").slice(0, 300),
    signupEnabled: bool(fd, "signupEnabled"),
    depositMin: money("depositMin") ?? DEFAULT_SETTINGS.depositMin,
    depositExpiryMinutes: Math.min(1440, Math.max(5, int(fd, "depositExpiryMinutes", 30))),
    depositGraceMinutes: Math.min(10080, Math.max(0, int(fd, "depositGraceMinutes", 60))),
    depositUniqueCents: bool(fd, "depositUniqueCents"),
    maxOpenDeposits: Math.min(20, Math.max(1, int(fd, "maxOpenDeposits", 3))),
    resellerProgramEnabled: bool(fd, "resellerProgramEnabled"),
    resellerFeePercent: Math.min(100, Math.max(0, int(fd, "resellerFeePercent", 20))),
    resellerHoldDays: Math.min(90, Math.max(0, int(fd, "resellerHoldDays", 3))),
    payoutMin: money("payoutMin") ?? DEFAULT_SETTINGS.payoutMin,
  };
  if (patch.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.adminEmail)) return fail("Admin email doesn't look valid.");
  await saveSettings(patch);
  await audit(admin.id, "settings.update", "settings", undefined, patch as Record<string, unknown>);
  revalidatePath("/", "layout");
  return done("Settings saved.");
}
