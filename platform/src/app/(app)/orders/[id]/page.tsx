import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { CheckCircle2, Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { CopyButton } from "@/components/client/widgets";
import { Alert, Card, PageHeader, Pagination, StatusBadge, Textarea, buttonClass } from "@/components/ui";
import { requestRefundAction } from "@/lib/actions/shop";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { orderItems, orders, products, refundRequests, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";

const PAGE = 50;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Order #${(await params).id}` };
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; page?: string }>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();

  const [row] = await db
    .select({ order: orders, refundWindowHours: products.refundWindowHours, buyer: users.username })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, id));
  if (!row || (row.order.userId !== user.id && user.role !== "admin")) notFound();
  const { order } = row;
  const isOwner = order.userId === user.id;

  const page = Math.max(1, Number(sp.page) || 1);
  const items = await db
    .select({ item: orderItems, refund: refundRequests })
    .from(orderItems)
    .leftJoin(refundRequests, eq(refundRequests.orderItemId, orderItems.id))
    .where(eq(orderItems.orderId, id))
    .orderBy(asc(orderItems.id))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(orderItems).where(and(eq(orderItems.orderId, id)));

  const windowH = row.refundWindowHours ?? 0;
  const refundOpen = isOwner && windowH > 0 && Date.now() - order.createdAt.getTime() < windowH * 3600_000;
  const deadline = new Date(order.createdAt.getTime() + windowH * 3600_000);

  return (
    <>
      <PageHeader
        back={{ href: user.role === "admin" && !isOwner ? "/admin/orders" : "/orders", label: "Orders" }}
        title={
          <span className="flex items-center gap-3">
            Order #{order.id} <StatusBadge status={order.status} />
          </span>
        }
        description={`${order.productName} · ${order.quantity} item${order.quantity === 1 ? "" : "s"} · ${formatMoney(order.total)} · ${formatDate(order.createdAt)}${isOwner ? "" : ` · buyer: ${row.buyer}`}`}
        actions={
          <>
            <a href={`/orders/${order.id}/download?format=txt`} className={buttonClass("primary", "md")}>
              <Download className="size-4" /> Notepad (.txt)
            </a>
            <a href={`/orders/${order.id}/download?format=csv`} className={buttonClass("secondary", "md")}>
              <Download className="size-4" /> Spreadsheet (.csv)
            </a>
          </>
        }
      />

      {sp.new && (
        <Alert tone="success" className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" /> Purchase complete — your data is ready below and as a download.
        </Alert>
      )}
      {order.deliveryNote && <Alert className="mb-4 whitespace-pre-line">{order.deliveryNote}</Alert>}
      {order.refunded > 0 && (
        <Alert tone="info" className="mb-4">
          {formatMoney(order.refunded)} refunded to your balance.
        </Alert>
      )}
      {windowH > 0 && isOwner && (
        <p className="mb-3 text-xs text-muted">
          {refundOpen ? `Refund requests are open until ${formatDate(deadline)}.` : "The refund window for this order has closed."}
        </p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">#</th>
                {order.fields.map((f) => (
                  <th key={f.key} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Price</th>
                <th className="px-4 py-2.5 font-medium">Refund</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ item, refund }, i) => (
                <tr key={item.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-muted">{(page - 1) * PAGE + i + 1}</td>
                  {order.fields.map((f) => {
                    const v = item.data[f.key] ?? "";
                    return (
                      <td key={f.key} className="max-w-72 px-3 py-3">
                        {!v ? (
                          <span className="text-muted">—</span>
                        ) : f.type === "image" ? (
                          <a href={v} target="_blank" rel="noreferrer">
                            <img src={v} alt="" className="size-12 rounded object-cover" />
                          </a>
                        ) : f.type === "url" || f.type === "file" ? (
                          <a href={v} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                            {v}
                          </a>
                        ) : f.type === "secret" ? (
                          <span className="flex items-center gap-2">
                            <code className="break-all rounded bg-subtle px-1.5 py-0.5 font-mono text-xs">{v}</code>
                            <CopyButton value={v} label="Copy" className="h-6 px-2 text-[11px]" />
                          </span>
                        ) : (
                          <span className="break-words">{v}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-3 py-3 tabular">{formatMoney(item.price)}</td>
                  <td className="px-4 py-3">
                    {refund ? (
                      <div className="space-y-1">
                        <StatusBadge status={refund.status} />
                        {refund.adminNote && <p className="max-w-48 text-xs text-muted">{refund.adminNote}</p>}
                      </div>
                    ) : refundOpen ? (
                      <details className="w-56">
                        <summary className="cursor-pointer text-xs text-muted hover:text-fg">Request refund</summary>
                        <ActionForm action={requestRefundAction} className="mt-2 space-y-2">
                          <input type="hidden" name="itemId" value={item.id} />
                          <Textarea name="reason" rows={2} placeholder="What's wrong with this item?" required minLength={10} className="min-h-0 text-xs" />
                          <SubmitButton size="sm" variant="secondary">
                            Submit request
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(p) => `/orders/${order.id}?page=${p}`} />
      </Card>
    </>
  );
}
