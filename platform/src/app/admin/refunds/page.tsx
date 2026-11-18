import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Card, EmptyState, Input, PageHeader, StatusBadge, cn } from "@/components/ui";
import { resolveRefundAction } from "@/lib/actions/shop";
import { db } from "@/lib/db";
import { orderItems, orders, refundRequests, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Refunds" };
const TABS = ["pending", "approved", "rejected"] as const;

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = TABS.includes(sp.status as never) ? (sp.status as (typeof TABS)[number]) : "pending";
  const rows = await db
    .select({ r: refundRequests, item: orderItems, order: orders, username: users.username })
    .from(refundRequests)
    .innerJoin(orderItems, eq(orderItems.id, refundRequests.orderItemId))
    .innerJoin(orders, eq(orders.id, refundRequests.orderId))
    .innerJoin(users, eq(users.id, refundRequests.userId))
    .where(eq(refundRequests.status, status))
    .orderBy(status === "pending" ? refundRequests.createdAt : desc(refundRequests.resolvedAt))
    .limit(100);

  return (
    <>
      <PageHeader title="Refund requests" description="Approving credits the item price back to the buyer's balance and marks the item refunded." />
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/refunds?status=${t}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs capitalize",
              status === t ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
            )}
          >
            {t}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={`No ${status} refunds`} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ r, item, order, username }) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{username}</span>
                    <span className="text-muted"> · </span>
                    <Link href={`/orders/${order.id}`} className="font-mono text-xs hover:underline">
                      order #{order.id}
                    </Link>
                    <span className="text-muted"> · {order.productName}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">Requested {formatDate(r.createdAt)} · ordered {formatDate(order.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular">{formatMoney(r.amount)}</p>
                  <StatusBadge status={r.status} />
                </div>
              </div>
              <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm">{r.reason}</blockquote>
              <dl className="mt-3 grid gap-x-6 gap-y-1 rounded-lg bg-subtle p-3 text-xs sm:grid-cols-2">
                {order.fields.map((f) => (
                  <div key={f.key} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted">{f.label}</dt>
                    <dd className="truncate font-mono">{item.data[f.key] ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              {r.status === "pending" ? (
                <ActionForm action={resolveRefundAction} className="mt-4 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <Input name="note" placeholder="Note to buyer (optional)" className="h-9 min-w-56 flex-1" />
                  <SubmitButton name="decision" value="approve" size="sm">
                    Approve refund
                  </SubmitButton>
                  <SubmitButton name="decision" value="reject" size="sm" variant="secondary">
                    Reject
                  </SubmitButton>
                </ActionForm>
              ) : (
                r.adminNote && <p className="mt-3 text-xs text-muted">Note: {r.adminNote}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
