import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { ArrowDownToLine, Lock, Plus, ShoppingBag, Wallet } from "lucide-react";
import { Alert, Card, CardHeader, LinkButton, Stat, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deposits, orders, products } from "@/lib/db/schema";
import { formatDate, formatMoney, timeAgo } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Overview" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ backup?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [recentOrders, recentDeposits, featured] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(5),
    db.select().from(deposits).where(eq(deposits.userId, user.id)).orderBy(desc(deposits.createdAt)).limit(5),
    db
      .select()
      .from(products)
      .where(and(eq(products.status, "active"), eq(products.featured, true)))
      .orderBy(products.sortOrder)
      .limit(3),
  ]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Welcome back</p>
          <h1 className="text-2xl font-semibold tracking-tight">{user.username}</h1>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/wallet" variant="accent">
            <Plus className="size-4" /> Add funds
          </LinkButton>
          <LinkButton href="/shop" variant="secondary">
            <ShoppingBag className="size-4" /> Shop
          </LinkButton>
        </div>
      </div>

      {sp.backup != null && (
        <Alert tone="warn" className="mb-6">
          You logged in with a backup code. {sp.backup} code(s) left —{" "}
          <Link href="/settings" className="font-medium underline">
            generate new codes
          </Link>{" "}
          if you're running low.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Available balance" value={formatMoney(user.balance)} icon={<Wallet className="size-4" />} tone="accent" hint="Ready to spend" />
        <Stat
          label="Frozen"
          value={formatMoney(user.frozen)}
          icon={<Lock className="size-4" />}
          tone={user.frozen > 0 ? "warn" : undefined}
          hint="On hold by the platform"
        />
        <Stat label="Total spent" value={formatMoney(user.totalSpent)} icon={<ShoppingBag className="size-4" />} hint="Net of refunds" />
        <Stat label="Total deposited" value={formatMoney(user.totalDeposited)} icon={<ArrowDownToLine className="size-4" />} hint="Approved deposits" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders" action={<Link href="/orders" className="text-xs text-muted hover:text-fg">View all</Link>} />
          {recentOrders.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.productName}</p>
                      <p className="text-xs text-muted">
                        #{o.id} · {o.quantity} item{o.quantity === 1 ? "" : "s"} · {timeAgo(o.createdAt)}
                      </p>
                    </div>
                    <span className="tabular">{formatMoney(o.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent deposits" action={<Link href="/wallet" className="text-xs text-muted hover:text-fg">View all</Link>} />
          {recentDeposits.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No deposits yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentDeposits.map((d) => (
                <li key={d.id}>
                  <Link href={`/wallet/deposits/${d.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-subtle/50">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium tabular">{formatMoney(d.creditedAmount ?? d.amount)}</p>
                      <p className="text-xs text-muted">
                        {d.methodName} · {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {featured.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold">Featured</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {featured.map((p) => (
              <Link key={p.id} href={`/shop/${p.slug}`} className="group">
                <Card className="overflow-hidden transition group-hover:border-fg/20">
                  <div className="aspect-[16/9] bg-subtle">
                    {p.imagePath && <img src={fileUrl(p.imagePath)!} alt="" loading="lazy" className="size-full object-cover" />}
                  </div>
                  <div className="flex items-center justify-between gap-2 p-4">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="text-sm tabular text-muted">{formatMoney(p.price)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
