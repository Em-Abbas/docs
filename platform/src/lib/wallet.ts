import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";

export class WalletError extends Error {}

type Movement = {
  type: (typeof transactions.$inferInsert)["type"];
  /** Change to the spendable balance (negative = debit). */
  amount: number;
  /** Change to the frozen balance. */
  frozenDelta?: number;
  description: string;
  refType?: string;
  refId?: number;
  actorId?: number | null;
  /** Adjust lifetime counters shown on the overview. */
  spentDelta?: number;
  depositedDelta?: number;
  /** Allow the balance to go below zero (admin corrections only). */
  allowNegative?: boolean;
};

/**
 * The only place balances change. Locks the user row, applies the movement and
 * writes a ledger entry in the same transaction.
 */
export async function moveBalance(tx: Tx, userId: number, m: Movement) {
  const [u] = await tx
    .select({ balance: users.balance, frozen: users.frozen, totalSpent: users.totalSpent, totalDeposited: users.totalDeposited })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!u) throw new WalletError("Account not found");

  const balance = u.balance + m.amount;
  const frozen = u.frozen + (m.frozenDelta ?? 0);
  if (!m.allowNegative && balance < 0) throw new WalletError("Insufficient balance");
  if (frozen < 0) throw new WalletError("Frozen balance cannot go below zero");

  await tx
    .update(users)
    .set({
      balance,
      frozen,
      totalSpent: u.totalSpent + (m.spentDelta ?? 0),
      totalDeposited: u.totalDeposited + (m.depositedDelta ?? 0),
    })
    .where(eq(users.id, userId));

  await tx.insert(transactions).values({
    userId,
    type: m.type,
    amount: m.amount,
    balanceAfter: balance,
    frozenAfter: frozen,
    description: m.description,
    refType: m.refType,
    refId: m.refId,
    actorId: m.actorId ?? null,
  });
  return { balance, frozen };
}
