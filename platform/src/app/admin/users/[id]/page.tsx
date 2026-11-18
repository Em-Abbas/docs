import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select, Stat, StatusBadge, Table, td, th } from "@/components/ui";
import { adjustBalanceAction, setUserStatusAction } from "@/lib/actions/admin";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deposits, orders, transactions, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "User" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) notFound();
  const [recentOrders, recentDeposits, ledger] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.createdAt)).limit(10),
    db.select().from(deposits).where(eq(deposits.userId, id)).orderBy(desc(deposits.createdAt)).limit(10),
    db.select().from(transactions).where(eq(transactions.userId, id)).orderBy(desc(transactions.id)).limit(30),
  ]);
  const self = admin.id === u.id;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/users", label: "Users" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {u.username} <StatusBadge status={u.status} />
            {u.role !== "user" && <Badge tone={u.role === "admin" ? "accent" : "blue"}>{u.role}</Badge>}
          </span>
        }
        description={`Joined ${formatDate(u.createdAt)} · last login ${formatDate(u.lastLoginAt)} · 2FA ${u.totpEnabled ? "on" : "off"} · ${u.backupCodes.length} backup codes left`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Available" value={formatMoney(u.balance)} tone="accent" />
        <Stat label="Frozen" value={formatMoney(u.frozen)} tone={u.frozen ? "warn" : undefined} />
        <Stat label="Spent" value={formatMoney(u.totalSpent)} />
        <Stat label="Deposited" value={formatMoney(u.totalDeposited)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Balance" description="Every change is written to the user's balance history with your reason." />
          <ActionForm action={adjustBalanceAction} resetOnSuccess className="grid gap-3 p-5 sm:grid-cols-[9rem_8rem_1fr]">
            <input type="hidden" name="userId" value={u.id} />
            <Field label="Action">
              <Select name="op">
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
                <option value="freeze">Freeze</option>
                <option value="unfreeze">Unfreeze</option>
              </Select>
            </Field>
            <Field label="Amount">
              <Input name="amount" inputMode="decimal" placeholder="0.00" required />
            </Field>
            <Field label="Reason">
              <Input name="reason" placeholder="e.g. Goodwill credit for ticket #123" required />
            </Field>
            <div className="sm:col-span-3">
              <SubmitButton confirm="Apply this balance change?">Apply</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Account" />
          <ActionForm action={setUserStatusAction} className="flex flex-wrap gap-2 p-5">
            <input type="hidden" name="userId" value={u.id} />
            {self ? (
              <p className="text-sm text-muted">This is your account.</p>
            ) : (
              <>
                {u.status === "banned" ? (
                  <SubmitButton name="action" value="unban" variant="secondary" size="sm">
                    Reactivate
                  </SubmitButton>
                ) : (
                  <SubmitButton name="action" value="ban" variant="danger" size="sm" confirm={`Suspend ${u.username}? They'll be signed out.`}>
                    Suspend
                  </SubmitButton>
                )}
                <SubmitButton name="action" value="reset2fa" variant="secondary" size="sm" confirm="Reset two-factor? They'll set up a new authenticator at next login.">
                  Reset 2FA
                </SubmitButton>
                {u.lockedUntil && u.lockedUntil > new Date() && (
                  <SubmitButton name="action" value="unlock" variant="secondary" size="sm">
                    Clear login lock
                  </SubmitButton>
                )}
                {u.role === "admin" ? (
                  <SubmitButton name="action" value="remove_admin" variant="ghost" size="sm" confirm="Remove admin rights?">
                    Remove admin
                  </SubmitButton>
                ) : (
                  <SubmitButton name="action" value="make_admin" variant="ghost" size="sm" confirm={`Give ${u.username} full admin access?`}>
                    Make admin
                  </SubmitButton>
                )}
              </>
            )}
          </ActionForm>
          {u.resellerStatus !== "none" && (
            <div className="border-t border-border px-5 py-4 text-sm">
              Reseller: <StatusBadge status={u.resellerStatus} /> · earnings {formatMoney(u.earningsPending)} pending / {formatMoney(u.earningsAvailable)}{" "}
              available / {formatMoney(u.earningsPaid)} paid
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Orders" />
          <Table>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id}>
                  <td className={td}>
                    <Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">
                      #{o.id}
                    </Link>
                  </td>
                  <td className={`${td} max-w-48 truncate`}>{o.productName}</td>
                  <td className={`${td} tabular`}>{formatMoney(o.total)}</td>
                  <td className={`${td} whitespace-nowrap text-xs text-muted`}>{formatDate(o.createdAt)}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted`}>No orders</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Deposits" />
          <Table>
            <tbody>
              {recentDeposits.map((d) => (
                <tr key={d.id}>
                  <td className={td}>
                    <Link href={`/admin/deposits/${d.id}`} className="font-mono text-xs hover:underline">
                      #{d.id}
                    </Link>
                  </td>
                  <td className={`${td} tabular`}>
                    {d.payAmount} {d.asset}
                  </td>
                  <td className={td}>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs text-muted`}>{formatDate(d.createdAt)}</td>
                </tr>
              ))}
              {recentDeposits.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted`}>No deposits</td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Balance history" />
        <Table>
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Type</th>
              <th className={th}>Description</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-right`}>Balance</th>
              <th className={`${th} text-right`}>Frozen</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((t) => (
              <tr key={t.id}>
                <td className={`${td} whitespace-nowrap text-xs text-muted`}>{formatDate(t.createdAt)}</td>
                <td className={td}>
                  <Badge>{t.type}</Badge>
                </td>
                <td className={`${td} max-w-72 truncate`}>{t.description}</td>
                <td className={`${td} text-right tabular`}>{formatMoney(t.amount)}</td>
                <td className={`${td} text-right tabular text-muted`}>{formatMoney(t.balanceAfter)}</td>
                <td className={`${td} text-right tabular text-muted`}>{formatMoney(t.frozenAfter)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
