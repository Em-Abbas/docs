import Link from "next/link";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { SelectAll } from "@/components/client/widgets";
import { Card, CardHeader, EmptyState, Field, Input, Pagination, Select, StatusBadge, Textarea, cn, inputClass } from "@/components/ui";
import { addItemAction, removeAllAvailableAction, removeItemsAction } from "@/lib/actions/catalog";
import { db } from "@/lib/db";
import { inventoryItems, users, type Product, type ProductField } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";

const STATUSES = ["available", "pending_review", "sold", "refunded", "removed", "all"] as const;
const PAGE = 50;

export async function InventoryTab({
  product,
  fields,
  counts,
  searchParams,
}: {
  product: Product;
  fields: ProductField[];
  counts: Record<string, number>;
  searchParams: Record<string, string | undefined>;
}) {
  const active = fields.filter((f) => f.enabled);
  const status = STATUSES.includes(searchParams.status as never) ? (searchParams.status as (typeof STATUSES)[number]) : "available";
  const q = (searchParams.q ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where: SQL[] = [eq(inventoryItems.productId, product.id)];
  if (status !== "all") where.push(eq(inventoryItems.status, status));
  if (q) where.push(sql`${inventoryItems.data}::text ilike ${"%" + q.replace(/[%_]/g, "\\$&") + "%"}`);

  const seller = alias(users, "seller");
  const buyer = alias(users, "buyer");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ item: inventoryItems, seller: seller.username, buyer: buyer.username })
      .from(inventoryItems)
      .leftJoin(seller, eq(seller.id, inventoryItems.sellerId))
      .leftJoin(buyer, eq(buyer.id, inventoryItems.buyerId))
      .where(and(...where))
      .orderBy(desc(inventoryItems.id))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(inventoryItems).where(and(...where)),
  ]);

  const href = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams({ tab: "inventory", status, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) });
    return `/admin/products/${product.id}?${params}`;
  };
  const removable = status === "available" || status === "pending_review";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s, page: 1 })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs capitalize transition",
              status === s ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg",
            )}
          >
            {s.replace("_", " ")}
            {s !== "all" && <span className="ml-1.5 tabular opacity-70">{(counts[s] ?? 0).toLocaleString()}</span>}
          </Link>
        ))}
        <form className="ml-auto flex gap-2" action={`/admin/products/${product.id}`}>
          <input type="hidden" name="tab" value="inventory" />
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={q} placeholder="Search any value…" className="h-8 w-56 text-xs" />
        </form>
      </div>

      <Card>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No items here" description="Upload a CSV from the Bulk upload tab or add a single item below." />
          </div>
        ) : (
          <ActionForm action={removeItemsAction} hideMessages={false} className="[&>div:first-child]:m-4">
            <input type="hidden" name="id" value={product.id} />
            <div id={`inv-${product.id}`} className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <th className="w-10 px-4 py-2.5">{removable && <SelectAll formId={`inv-${product.id}`} />}</th>
                    <th className="px-2 py-2.5 font-medium">#</th>
                    {active.map((f) => (
                      <th key={f.key} className="whitespace-nowrap px-3 py-2.5 font-medium">
                        {f.label} <span className="font-mono opacity-60">{f.key}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 font-medium">Price</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, seller: sellerName, buyer: buyerName }) => (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-subtle/50">
                      <td className="px-4 py-2">
                        {(item.status === "available" || item.status === "pending_review") && (
                          <input type="checkbox" name="item" value={item.id} className="size-4 accent-[var(--accent)]" />
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-muted">{item.id}</td>
                      {active.map((f) => (
                        <td key={f.key} className="max-w-48 truncate px-3 py-2" title={item.data[f.key] ?? ""}>
                          {item.data[f.key] ?? <span className="text-muted">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 tabular">
                        {item.priceOverride != null ? formatMoney(item.priceOverride) : <span className="text-muted">{formatMoney(product.price)}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{sellerName ? `Reseller: ${sellerName}` : "House"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                        {item.orderId ? (
                          <Link href={`/admin/orders?q=${item.orderId}`} className="hover:text-fg">
                            #{item.orderId} · {buyerName} · {formatDate(item.soldAt)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
              {removable ? (
                <SubmitButton variant="secondary" size="sm" confirm="Remove the selected items from sale?">
                  Remove selected
                </SubmitButton>
              ) : (
                <span className="text-xs text-muted">Sold and refunded items are kept for order history.</span>
              )}
              <span className="text-xs text-muted tabular">{total.toLocaleString()} items</span>
            </div>
            <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(p) => href({ page: p })} />
          </ActionForm>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <Card>
          <CardHeader title="Add a single item" description="Useful for one-off items, or items with image/file uploads." />
          <ActionForm action={addItemAction} resetOnSuccess className="grid gap-4 p-5 sm:grid-cols-2">
            <input type="hidden" name="id" value={product.id} />
            {active.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} hint={f.visibility === "hidden" ? "Hidden until purchase" : undefined}>
                {f.type === "longtext" ? (
                  <Textarea name={f.key} rows={2} />
                ) : f.type === "boolean" ? (
                  <Select name={f.key} defaultValue="">
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                ) : f.type === "image" || f.type === "file" ? (
                  <div className="space-y-2">
                    <Input name={f.key} placeholder="https://… (or upload below)" />
                    <input name={`${f.key}.upload`} type="file" accept={f.type === "image" ? "image/*" : undefined} className={cn(inputClass, "w-full py-1.5 text-xs")} />
                  </div>
                ) : (
                  <Input
                    name={f.key}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                    step={f.type === "number" ? "any" : undefined}
                  />
                )}
              </Field>
            ))}
            <Field label="Price override" hint={`Empty = ${formatMoney(product.price)}`}>
              <Input name="price" inputMode="decimal" placeholder="0.00" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Add item</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card className="h-fit p-5">
          <p className="text-sm font-medium">Clear stock</p>
          <p className="mt-1 text-xs text-muted">Remove every available item from sale. Sold items are not affected.</p>
          <form action={removeAllAvailableAction} className="mt-3">
            <input type="hidden" name="id" value={product.id} />
            <button className="text-sm font-medium text-red-600 hover:underline">Remove all available</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
