import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deposits } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

/** Mark unpaid deposits as expired once the payment window plus grace period has passed. */
export async function expireStaleDeposits() {
  const s = await getSettings();
  await db
    .update(deposits)
    .set({ status: "expired" })
    .where(
      and(
        eq(deposits.status, "awaiting_payment"),
        lt(deposits.expiresAt, sql`now() - make_interval(mins => ${s.depositGraceMinutes})`),
      ),
    );
}

/** Convert USD cents to an exact asset amount string, e.g. 10037 cents at rate 1 → "100.37". */
export function toAssetAmount(usdCents: number, rate: string, decimals: number): string {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) throw new Error("Invalid rate");
  const value = usdCents / 100 / r;
  // Round up so the user never sends less than required.
  const factor = 10 ** decimals;
  return (Math.ceil(value * factor - 1e-9) / factor).toFixed(decimals);
}

export function explorerUrl(network: string, hash: string | null | undefined): string | null {
  if (!hash) return null;
  const h = encodeURIComponent(hash.trim());
  switch (network.toUpperCase()) {
    case "TRC20":
    case "TRON":
      return `https://tronscan.org/#/transaction/${h}`;
    case "ERC20":
    case "ETH":
      return `https://etherscan.io/tx/${h}`;
    case "BEP20":
    case "BSC":
      return `https://bscscan.com/tx/${h}`;
    case "POLYGON":
      return `https://polygonscan.com/tx/${h}`;
    case "BTC":
      return `https://mempool.space/tx/${h}`;
    case "SOL":
      return `https://solscan.io/tx/${h}`;
    default:
      return null;
  }
}
