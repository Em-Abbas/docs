import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { randomToken, sha256, sign, unsign } from "./crypto";

const SESSION_COOKIE = "kiosk_session";
const PREAUTH_COOKIE = "kiosk_preauth";
const SESSION_DAYS = 7;

const secureCookies = () => (process.env.APP_URL ?? "").startsWith("https://");

export async function requestMeta() {
  const h = await headers();
  // X-Real-IP is set by the reverse proxy (see Caddyfile). Otherwise use the
  // last X-Forwarded-For hop — the one our proxy added — since clients can forge earlier entries.
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").pop() ?? "unknown").trim();
  return { ip, userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

/* -------------------------------------------------------------- sessions */

export async function createSession(userId: number) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const meta = await requestMeta();
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
  await db.update(users).set({ lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    expires: expiresAt,
  });
  jar.delete(PREAUTH_COOKIE);
}

export const getSession = cache(async (): Promise<{ sessionId: string; user: User } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== "active") return null;
  return { sessionId: id, user: row.user };
});

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/* --------------------------------------------------- pre-auth (2FA, setup) */

export type PreAuth = { uid: number; stage: "mfa" | "setup"; attempts?: number };

export async function setPreAuth(data: PreAuth) {
  const ttl = data.stage === "setup" ? 3600 : 600;
  (await cookies()).set(PREAUTH_COOKIE, sign(data, ttl), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: ttl,
  });
}

export async function getPreAuth(stage: PreAuth["stage"]): Promise<PreAuth | null> {
  const data = unsign<PreAuth>((await cookies()).get(PREAUTH_COOKIE)?.value);
  return data && data.stage === stage ? data : null;
}

export async function clearPreAuth() {
  (await cookies()).delete(PREAUTH_COOKIE);
}

/* ------------------------------------------------------------------ guards */

export async function currentUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

export async function requireUser(): Promise<User> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

export async function requireReseller(): Promise<User> {
  const user = await requireUser();
  if (user.resellerStatus !== "approved" && user.role !== "admin") redirect("/reseller");
  return user;
}
