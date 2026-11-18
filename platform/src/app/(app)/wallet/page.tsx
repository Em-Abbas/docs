import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { Alert, Card, CardHeader, EmptyState, Input, PageHeader, Stat, StatusBadge, Table, td, th } from "@/components/ui";
import { createDepositAction } from "@/lib/actions/wallet";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deposits, paymentMethods, transactions } from "@/lib/db/schema";
import { expireStaleDeposits } from "@/lib/deposits";
import { formatDate, formatMoney } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Wallet" };

export default async function WalletPage() {
  const user = await requireUser();
  const s = await getSettings();
  await expireStaleDeposits();
  const [methods, history, ledger] = await Promise.all([
    db.select().from(paymentMethods).where(eq(paymentMethods.isActive, true)).orderBy(asc(paymentMethods.sortOrder)),
    db.select().from(deposits).where(eq(deposits.userId, user.id)).orderBy(desc(deposits.createdAt)).limit(20),
    db.select().from(transactions).where(eq(transactions.userId, user.id)).orderBy(desc(transactions.id)).limit(25),
  ]);

  return (
    <>
      <PageHeader title="Wallet" description="Add funds with crypto. Deposits are credited after our team confirms the payment." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Available" value={formatMoney(user.balance)} tone="accent" />
        <Stat label="Frozen" value={formatMoney(user.frozen)} tone={user.frozen ? "warn" : undefined} hint="Held by the platform" />
        <Stat label="Total deposited" value={formatMoney(user.totalDeposited)} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Add funds" description={`Minimum ${formatMoney(s.depositMin)}. You'll have ${s.depositExpiryMinutes} minutes to send the payment.`} />
        {methods.length === 0 ? (
          <div className="p-5">
            <Alert>No payment methods are available right now.</Alert>
          </div>
        ) : (
          <ActionForm action={createDepositAction} className="space-y-5 p-5">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Pay with</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {methods.map((m, i) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                  >
                    <input type="radio" name="methodId" value={m.id} defaultChecked={i === 0} className="accent-[var(--accent)]" />
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-[10px] font-bold">{m.asset}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{m.name}</span>
                      <span className="block text-xs text-muted">
                        {m.network}
                        {m.minAmount > 0 && ` · min ${formatMoney(Math.max(m.minAmount, s.depositMin))}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Amount (USD)</label>
                <Input name="amount" inputMode="decimal" placeholder="100.00" required className="w-40" />
                <FieldError name="amount" />
              </div>
              <SubmitButton variant="accent">Continue to payment</SubmitButton>
            </div>
            {s.depositUniqueCents && (
              <p className="text-xs text-muted">A few cents are added to make your amount unique, so we can match your transfer quickly. They're credited too.</p>
            )}
          </ActionForm>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Deposits" />
          {history.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No deposits yet" />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((d) => (
                <li key={d.id}>
                  <Link href={`/wallet/deposits/${d.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/50">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium tabular">
                        {d.payAmount} {d.asset} <span className="font-normal text-muted">· {d.network}</span>
                      </p>
                      <p className="text-xs text-muted">
                        #{d.id} · {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Balance history" />
          {ledger.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No activity yet" />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Activity</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((t) => (
                  <tr key={t.id}>
                    <td className={td}>
                      <p className="max-w-64 truncate">{t.description}</p>
                      <p className="text-xs text-muted">{formatDate(t.createdAt)}</p>
                    </td>
                    <td className={`${td} text-right tabular ${t.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                      {t.amount > 0 ? "+" : ""}
                      {formatMoney(t.amount)}
                    </td>
                    <td className={`${td} text-right tabular text-muted`}>{formatMoney(t.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
