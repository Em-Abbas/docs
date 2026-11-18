import Link from "next/link";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import { Card, CardHeader, PageHeader, Stat, cn } from "@/components/ui";
import { db } from "@/lib/db";
import { deposits, orders, payouts, products, refundRequests, uploadBatches, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { stockCounts } from "@/lib/queries";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Dashboard" };

const since = (days: number) => new Date(Date.now() - days * 86400_000);
const startOfToday = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export default async function AdminDashboard() {
  await requireAdmin();
  const revenue = (from: Date) =>
    db
      .select({ v: sql<number>`coalesce(sum(${orders.total} - ${orders.refunded}),0)::bigint`, n: count() })
      .from(orders)
      .where(gte(orders.createdAt, from))
      .then((r) => ({ v: Number(r[0].v), n: r[0].n }));
  const n = (q: Promise<{ n: number }[]>) => q.then((r) => r[0].n);

  const [today, week, month, deposits7, userStats, liabilities, queues, recent, activeProducts] = await Promise.all([
    revenue(startOfToday()),
    revenue(since(7)),
    revenue(since(30)),
    db
      .select({ v: sql<number>`coalesce(sum(${deposits.creditedAmount}),0)::bigint` })
      .from(deposits)
      .where(and(eq(deposits.status, "approved"), gte(deposits.reviewedAt, since(7))))
      .then((r) => Number(r[0].v)),
    db
      .select({ total: count(), fresh: sql<number>`count(*) filter (where ${users.createdAt} >= ${since(7).toISOString()})::int` })
      .from(users)
      .then((r) => r[0]),
    db
      .select({
        balances: sql<number>`coalesce(sum(${users.balance} + ${users.frozen}),0)::bigint`,
        earnings: sql<number>`coalesce(sum(${users.earningsPending} + ${users.earningsAvailable}),0)::bigint`,
      })
      .from(users)
      .then((r) => ({ balances: Number(r[0].balances), earnings: Number(r[0].earnings) })),
    Promise.all([
      n(db.select({ n: count() }).from(deposits).where(eq(deposits.status, "under_review"))),
      n(db.select({ n: count() }).from(refundRequests).where(eq(refundRequests.status, "pending"))),
      n(db.select({ n: count() }).from(uploadBatches).where(eq(uploadBatches.status, "pending_review"))),
      n(db.select({ n: count() }).from(payouts).where(eq(payouts.status, "pending"))),
      n(db.select({ n: count() }).from(users).where(eq(users.resellerStatus, "pending"))),
    ]),
    db
      .select({ o: orders, username: users.username })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .orderBy(desc(orders.createdAt))
      .limit(8),
    db.select().from(products).where(eq(products.status, "active")),
  ]);

  const stock = await stockCounts(activeProducts.map((p) => p.id));
  const lowStock = activeProducts
    .map((p) => ({ p, available: stock.get(p.id)?.available ?? 0 }))
    .filter((x) => x.available < 10)
    .sort((a, b) => a.available - b.available);

  const queueItems = [
    { label: "Deposits to review", n: queues[0], href: "/admin/deposits" },
    { label: "Refund requests", n: queues[1], href: "/admin/refunds" },
    { label: "Reseller stock", n: queues[2], href: "/admin/resellers?tab=stock" },
    { label: "Payout requests", n: queues[3], href: "/admin/resellers?tab=payouts" },
    { label: "Reseller applications", n: queues[4], href: "/admin/resellers?tab=applications" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="Net revenue is order totals minus refunds." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue today" value={formatMoney(today.v)} hint={`${today.n} orders`} tone="accent" />
        <Stat label="Last 7 days" value={formatMoney(week.v)} hint={`${week.n} orders`} />
        <Stat label="Last 30 days" value={formatMoney(month.v)} hint={`${month.n} orders`} />
        <Stat label="Deposits (7 days)" value={formatMoney(deposits7)} hint="Approved" />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={userStats.total.toLocaleString()} hint={`+${userStats.fresh} this week`} />
        <Stat label="User balances" value={formatMoney(liabilities.balances)} hint="Available + frozen (owed to users)" />
        <Stat label="Reseller earnings" value={formatMoney(liabilities.earnings)} hint="Pending + available (owed)" />
        <Stat label="Low stock" value={lowStock.length} hint="Active products under 10 items" tone={lowStock.length ? "warn" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Needs attention" />
            <ul className="divide-y divide-border">
              {queueItems.map((q) => (
                <li key={q.label}>
                  <Link href={q.href} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-subtle/50">
                    <span className={cn(q.n === 0 && "text-muted")}>{q.label}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular",
                          q.n ? "bg-accent text-accent-fg" : "bg-subtle text-muted",
                        )}
                      >
                        {q.n}
                      </span>
                      <ArrowRight className="size-3.5 text-muted" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {lowStock.length > 0 && (
            <Card>
              <CardHeader title="Low stock" />
              <ul className="divide-y divide-border">
                {lowStock.slice(0, 8).map(({ p, available }) => (
                  <li key={p.id}>
                    <Link href={`/admin/products/${p.id}?tab=uploads`} className="flex justify-between px-5 py-2.5 text-sm hover:bg-subtle/50">
                      <span className="truncate">{p.name}</span>
                      <span className={cn("tabular", available === 0 ? "text-red-600" : "text-amber-600")}>{available}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Latest orders" action={<Link href="/admin/orders" className="text-xs text-muted hover:text-fg">All orders</Link>} />
          <ul className="divide-y divide-border">
            {recent.map(({ o, username }) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/50">
                  <span className="w-12 font-mono text-xs text-muted">#{o.id}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.productName}</span>
                    <span className="block text-xs text-muted">
                      {username} · {o.quantity} item{o.quantity === 1 ? "" : "s"} · {formatDate(o.createdAt)}
                    </span>
                  </span>
                  <span className="tabular">{formatMoney(o.total)}</span>
                </Link>
              </li>
            ))}
            {recent.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No orders yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
