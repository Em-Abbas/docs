"use server";

import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { decrypt, hashSecret, hmac, verifySecret } from "@/lib/auth/crypto";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  clearPreAuth,
  createSession,
  destroySession,
  getPreAuth,
  getSession,
  requestMeta,
  requireUser,
  setPreAuth,
} from "@/lib/auth/session";
import { generateBackupCodes, normalizeBackupCode, verifyTotp } from "@/lib/auth/totp";
import { normalizePhrase } from "@/lib/auth/helpers";
import { done, fail, str, zodErrors, type ActionState } from "@/lib/action-state";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/notify";

const usernameSchema = z
  .string()
  .min(3, "Use at least 3 characters")
  .max(24, "Use at most 24 characters")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dot, dash and underscore only");
const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters");

const findByUsername = async (username: string) =>
  (await db.select().from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1))[0];


/* ------------------------------------------------------------------ signup */

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await getSettings();
  if (!s.signupEnabled) return fail("New sign-ups are currently closed.");

  const { ip } = await requestMeta();
  if (!rateLimit(`signup:${ip}`, 5, 3600_000).ok) return fail("Too many sign-ups from your network. Try again later.");

  const parsed = z
    .object({ username: usernameSchema, password: passwordSchema, confirm: z.string(), terms: z.literal("on", "Accept the terms to continue") })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
    .safeParse({ username: str(fd, "username"), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? ""), terms: fd.get("terms") ?? undefined });
  if (!parsed.success) return fail("Check the highlighted fields.", zodErrors(parsed.error.issues));

  const { username, password } = parsed.data;
  if (await findByUsername(username)) return fail("That username is taken.", { username: "That username is taken" });

  let user: User;
  try {
    [user] = await db.insert(users).values({ username, passwordHash: await hashSecret(password) }).returning();
  } catch {
    return fail("That username is taken.", { username: "That username is taken" });
  }
  await setPreAuth({ uid: user.id, stage: "setup" });
  redirect("/signup/setup");
}

/* ------------------------------------------------- setup: authenticator etc */

async function setupUser(): Promise<User | null> {
  const pre = await getPreAuth("setup");
  if (!pre) return null;
  const [user] = await db.select().from(users).where(eq(users.id, pre.uid)).limit(1);
  return user && user.status !== "banned" ? user : null;
}

export async function verifySetupTotpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await setupUser();
  if (!user || !user.totpSecretEnc) return fail("Your setup session expired. Log in again to continue.");
  if (!rateLimit(`setup-totp:${user.id}`, 10, 600_000).ok) return fail("Too many attempts. Wait a few minutes.");

  const step = verifyTotp(decrypt(user.totpSecretEnc), str(fd, "code"), user.totpLastStep);
  if (step == null) return fail("That code didn't match. Check your phone's time and try the newest code.");

  const codes = generateBackupCodes();
  await db
    .update(users)
    .set({ totpEnabled: true, totpLastStep: step, backupCodes: codes.map((c) => hmac(normalizeBackupCode(c))) })
    .where(eq(users.id, user.id));
  return done("Authenticator connected", { codes });
}

export async function regenerateSetupCodesAction(_: ActionState): Promise<ActionState> {
  const user = await setupUser();
  if (!user || !user.totpEnabled) return fail("Your setup session expired. Log in again to continue.");
  const codes = generateBackupCodes();
  await db.update(users).set({ backupCodes: codes.map((c) => hmac(normalizeBackupCode(c))) }).where(eq(users.id, user.id));
  return done(undefined, { codes });
}

export async function generatePhraseAction(_: ActionState): Promise<ActionState> {
  const user = await setupUser();
  if (!user) return fail("Your setup session expired. Log in again to continue.");
  const phrase = generateMnemonic(wordlist, 128);
  await db.update(users).set({ recoveryPhraseHash: await hashSecret(phrase) }).where(eq(users.id, user.id));
  return done(undefined, { phrase });
}

const ownPhraseSchema = z
  .object({ phrase: z.string(), confirm: z.string() })
  .transform((v) => ({ phrase: normalizePhrase(v.phrase), confirm: normalizePhrase(v.confirm) }))
  .refine((v) => v.phrase.split(" ").length >= 4 && v.phrase.length >= 20, {
    path: ["phrase"],
    message: "Use at least 4 words and 20 characters",
  })
  .refine((v) => v.phrase === v.confirm, { path: ["confirm"], message: "Phrases don't match" });

export async function setOwnPhraseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await setupUser();
  if (!user) return fail("Your setup session expired. Log in again to continue.");
  const parsed = ownPhraseSchema.safeParse({ phrase: String(fd.get("phrase") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail("Check your recovery phrase.", zodErrors(parsed.error.issues));
  await db.update(users).set({ recoveryPhraseHash: await hashSecret(parsed.data.phrase) }).where(eq(users.id, user.id));
  return done("Recovery phrase saved");
}

export async function finishSetupAction(_: ActionState): Promise<ActionState> {
  const user = await setupUser();
  if (!user) return fail("Your setup session expired. Log in again to continue.");
  if (!user.totpEnabled) return fail("Connect your authenticator first.");
  if (!user.recoveryPhraseHash) return fail("Save a recovery phrase first.");
  await db.update(users).set({ status: "active" }).where(and(eq(users.id, user.id), ne(users.status, "banned")));
  await clearPreAuth();
  redirect("/login?setup=done");
}

/* ------------------------------------------------------------------- login */

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const username = str(fd, "username");
  const password = String(fd.get("password") ?? "");
  if (!username || !password) return fail("Enter your username and password.");

  const { ip } = await requestMeta();
  const limit = rateLimit(`login:${ip}`, 20, 900_000);
  if (!limit.ok || !rateLimit(`login-user:${username.toLowerCase()}`, 10, 900_000).ok)
    return fail(`Too many attempts. Try again in ${Math.ceil(limit.retryInSec / 60) || 15} minutes.`);

  const user = await findByUsername(username);
  if (user?.lockedUntil && user.lockedUntil > new Date()) return fail("This account is temporarily locked. Try again later.");

  const ok = await verifySecret(password, user?.passwordHash);
  if (!user || !ok) {
    if (user) {
      const failed = user.failedLogins + 1;
      await db
        .update(users)
        .set({ failedLogins: failed, lockedUntil: failed >= 10 ? new Date(Date.now() + 15 * 60_000) : null })
        .where(eq(users.id, user.id));
    }
    return fail("Invalid username or password.");
  }
  if (user.status === "banned") return fail("This account is suspended. Contact support.");

  if (user.status === "pending_setup" || !user.totpEnabled) {
    await setPreAuth({ uid: user.id, stage: "setup" });
    redirect("/signup/setup");
  }
  await setPreAuth({ uid: user.id, stage: "mfa" });
  redirect("/login/verify");
}

export async function verifyLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pre = await getPreAuth("mfa");
  if (!pre) return fail("Your login timed out. Start again.");
  if (!rateLimit(`mfa:${pre.uid}`, 6, 600_000).ok) return fail("Too many attempts. Wait 10 minutes and log in again.");

  const code = str(fd, "code");
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, pre.uid)).for("update");
    if (!user || user.status !== "active" || !user.totpSecretEnc) return null;

    if (/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      const step = verifyTotp(decrypt(user.totpSecretEnc), code, user.totpLastStep);
      if (step == null) return null;
      await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
      return { user, usedBackup: false, remaining: user.backupCodes.length };
    }
    const hash = hmac(normalizeBackupCode(code));
    if (!user.backupCodes.includes(hash)) return null;
    const remaining = user.backupCodes.filter((c) => c !== hash);
    await tx.update(users).set({ backupCodes: remaining }).where(eq(users.id, user.id));
    return { user, usedBackup: true, remaining: remaining.length };
  });

  if (!result) return fail("That code is not valid. Try the newest code from your app.");
  await createSession(result.user.id);
  if (result.usedBackup) await audit(result.user.id, "auth.backup_code_used", "user", result.user.id, { remaining: result.remaining });
  redirect(result.usedBackup ? `/overview?backup=${result.remaining}` : "/overview");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/* ---------------------------------------------------------------- recovery */

export async function recoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { ip } = await requestMeta();
  if (!rateLimit(`recover:${ip}`, 5, 3600_000).ok) return fail("Too many attempts. Try again in an hour.");

  const parsed = z
    .object({ username: z.string().min(1), phrase: z.string().min(1, "Enter your recovery phrase"), password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
    .safeParse({
      username: str(fd, "username"),
      phrase: String(fd.get("phrase") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirm: String(fd.get("confirm") ?? ""),
    });
  if (!parsed.success) return fail("Check the highlighted fields.", zodErrors(parsed.error.issues));
  if (!rateLimit(`recover-user:${parsed.data.username.toLowerCase()}`, 5, 3600_000).ok)
    return fail("Too many attempts for this account. Try again in an hour.");

  const user = await findByUsername(parsed.data.username);
  const ok = await verifySecret(normalizePhrase(parsed.data.phrase), user?.recoveryPhraseHash);
  if (!user || !ok || user.status === "banned") return fail("Username or recovery phrase is incorrect.");

  await db
    .update(users)
    .set({ passwordHash: await hashSecret(parsed.data.password), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await audit(user.id, "auth.password_recovered", "user", user.id);
  redirect("/login?reset=1");
}

/* -------------------------------------------------------- security settings */

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ current: z.string().min(1, "Enter your current password"), password: passwordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" })
    .safeParse({ current: String(fd.get("current") ?? ""), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail("Check the highlighted fields.", zodErrors(parsed.error.issues));
  if (!(await verifySecret(parsed.data.current, user.passwordHash)))
    return fail("Current password is incorrect.", { current: "Incorrect password" });

  const session = await getSession();
  await db.update(users).set({ passwordHash: await hashSecret(parsed.data.password) }).where(eq(users.id, user.id));
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, session!.sessionId)));
  await audit(user.id, "auth.password_changed", "user", user.id);
  return done("Password updated. Other devices were signed out.");
}

async function checkTotp(user: User, code: string): Promise<boolean> {
  if (!user.totpSecretEnc) return false;
  if (!rateLimit(`settings-totp:${user.id}`, 8, 600_000).ok) return false;
  const step = verifyTotp(decrypt(user.totpSecretEnc), code, user.totpLastStep);
  if (step == null) return false;
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  return true;
}

export async function regenerateBackupCodesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!(await checkTotp(user, str(fd, "code")))) return fail("Authenticator code is not valid.");
  const codes = generateBackupCodes();
  await db.update(users).set({ backupCodes: codes.map((c) => hmac(normalizeBackupCode(c))) }).where(eq(users.id, user.id));
  await audit(user.id, "auth.backup_codes_regenerated", "user", user.id);
  return done("New backup codes generated. Old codes no longer work.", { codes });
}

export async function changePhraseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!(await verifySecret(String(fd.get("current") ?? ""), user.passwordHash)))
    return fail("Current password is incorrect.", { current: "Incorrect password" });

  if (fd.get("mode") === "generate") {
    const phrase = generateMnemonic(wordlist, 128);
    await db.update(users).set({ recoveryPhraseHash: await hashSecret(phrase) }).where(eq(users.id, user.id));
    await audit(user.id, "auth.phrase_changed", "user", user.id);
    return done("New recovery phrase saved. Your old phrase no longer works.", { phrase });
  }
  const parsed = ownPhraseSchema.safeParse({ phrase: String(fd.get("phrase") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail("Check your recovery phrase.", zodErrors(parsed.error.issues));
  await db.update(users).set({ recoveryPhraseHash: await hashSecret(parsed.data.phrase) }).where(eq(users.id, user.id));
  await audit(user.id, "auth.phrase_changed", "user", user.id);
  return done("Recovery phrase updated.");
}

export async function resetAuthenticatorAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!(await verifySecret(String(fd.get("current") ?? ""), user.passwordHash))) return fail("Current password is incorrect.");
  if (!(await checkTotp(user, str(fd, "code")))) return fail("Authenticator code is not valid.");
  await db
    .update(users)
    .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, backupCodes: [] })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await audit(user.id, "auth.authenticator_reset", "user", user.id);
  await setPreAuth({ uid: user.id, stage: "setup" });
  redirect("/signup/setup");
}

export async function revokeSessionAction(fd: FormData) {
  const user = await requireUser();
  const id = str(fd, "id");
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), eq(sessions.id, id)));
  redirect("/settings");
}
