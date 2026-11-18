import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const normalizePhrase = (p: string) => p.toLowerCase().trim().split(/\s+/).join(" ");

/** Ensure a pending authenticator secret exists. Safe under concurrent renders. */
export async function ensureTotpSecret(userId: number, encSecret: string) {
  await db.update(users).set({ totpSecretEnc: encSecret }).where(and(eq(users.id, userId), isNull(users.totpSecretEnc)));
  const [u] = await db.select({ s: users.totpSecretEnc }).from(users).where(eq(users.id, userId));
  return u.s!;
}
