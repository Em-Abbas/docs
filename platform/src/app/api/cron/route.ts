import { lt } from "drizzle-orm";
import { safeEqual } from "@/lib/auth/crypto";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { expireStaleDeposits } from "@/lib/deposits";
import { releaseMaturedEarnings } from "@/lib/reseller";

/**
 * Housekeeping. Call every few minutes from any scheduler:
 *   curl -fsS "https://your-site/api/cron?key=$CRON_SECRET"
 * Pages also run these lazily, so the site works without it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!secret || !safeEqual(key, secret)) return new Response("Not found", { status: 404 });

  await expireStaleDeposits();
  await releaseMaturedEarnings();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  return Response.json({ ok: true, at: new Date().toISOString() });
}
