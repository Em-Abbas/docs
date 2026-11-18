import Link from "next/link";
import { desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Card, EmptyState, Input, PageHeader, Pagination, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { orders, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Orders" };
const PAGE = 50;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  let where: SQL | undefined;
  if (q) where = /^\d+$/.test(q) ? eq(orders.id, Number(q)) : or(ilike(users.username, `%${q}%`), ilike(orders.productName, `%${q}%`));

  const [rows, [{ total, revenue }]] = await Promise.all([
    db
      .select({ o: orders, username: users.username })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db
      .select({ total: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${orders.total} - ${orders.refunded}),0)::bigint` })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where),
  ]);

  return (
    <>
      <PageHeader title="Orders" description={`${total.toLocaleString()} orders · ${formatMoney(Number(revenue))} net revenue`} />
      <form className="mb-4">
        <Input name="q" defaultValue={q} placeholder="Order #, username or product…" className="max-w-sm" />
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No orders found" />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Buyer</th>
                <th className={th}>Product</th>
                <th className={th}>Items</th>
                <th className={th}>Total</th>
                <th className={th}>Refunded</th>
                <th className={th}>Status</th>
                <th className={th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, username }) => (
                <tr key={o.id} className="hover:bg-subtle/50">
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/orders/${o.id}`} className="hover:underline">
                      #{o.id}
                    </Link>
                  </td>
                  <td className={td}>
                    <Link href={`/admin/users?q=${username}`} className="hover:underline">
                      {username}
                    </Link>
                  </td>
                  <td className={`${td} font-medium`}>{o.productName}</td>
                  <td className={`${td} tabular`}>{o.quantity}</td>
                  <td className={`${td} tabular`}>{formatMoney(o.total)}</td>
                  <td className={`${td} tabular text-muted`}>{o.refunded ? formatMoney(o.refunded) : "—"}</td>
                  <td className={td}>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(p) => `/admin/orders?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
        </Card>
      )}
    </>
  );
}
