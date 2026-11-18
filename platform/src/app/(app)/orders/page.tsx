import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Card, EmptyState, LinkButton, PageHeader, Pagination, StatusBadge, Table, td, th } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Orders" };
const PAGE = 25;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireUser();
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(orders).where(eq(orders.userId, user.id)),
  ]);

  return (
    <>
      <PageHeader title="Orders" description="Every purchase stays available to download." />
      {rows.length === 0 ? (
        <EmptyState title="No orders yet" description="Your purchases will appear here." action={<LinkButton href="/shop">Browse the shop</LinkButton>} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Product</th>
                <th className={th}>Items</th>
                <th className={th}>Total</th>
                <th className={th}>Status</th>
                <th className={th}>Date</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-subtle/50">
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/orders/${o.id}`} className="hover:underline">
                      #{o.id}
                    </Link>
                  </td>
                  <td className={`${td} font-medium`}>{o.productName}</td>
                  <td className={`${td} tabular`}>{o.quantity}</td>
                  <td className={`${td} tabular`}>{formatMoney(o.total)}</td>
                  <td className={td}>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(o.createdAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <a href={`/orders/${o.id}/download?format=txt`} className="text-xs text-muted hover:text-fg">
                      TXT
                    </a>
                    <span className="mx-1.5 text-border">|</span>
                    <a href={`/orders/${o.id}/download?format=csv`} className="text-xs text-muted hover:text-fg">
                      CSV
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(p) => `/orders?page=${p}`} />
        </Card>
      )}
    </>
  );
}
