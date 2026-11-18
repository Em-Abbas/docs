import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { Clock, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { AutoSubmit, SelectAll, SelectionSummary } from "@/components/client/widgets";
import { Alert, Badge, Card, CardHeader, EmptyState, Input, LinkButton, PageHeader, Pagination, Select } from "@/components/ui";
import { buyAction } from "@/lib/actions/shop";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { categories, inventoryItems, priceTiers, productFields, products } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { previewValue } from "@/lib/inventory";
import { stockCounts } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { fileUrl } from "@/lib/storage";

const PAGE = 50;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const [p] = await db.select({ name: products.name }).from(products).where(eq(products.slug, (await params).slug));
  return { title: p?.name ?? "Product" };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const s = await getSettings();
  const { slug } = await params;
  const sp = await searchParams;
  const [row] = await db
    .select({ p: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!row) notFound();
  const { p, category } = row;

  const [fields, tiers, stock] = await Promise.all([
    db.select().from(productFields).where(eq(productFields.productId, p.id)).orderBy(asc(productFields.key)),
    db.select().from(priceTiers).where(eq(priceTiers.productId, p.id)).orderBy(asc(priceTiers.minQty)),
    stockCounts([p.id]),
  ]);
  const active = fields.filter((f) => f.enabled);
  const visible = active.filter((f) => f.visibility !== "hidden");
  const locked = active.filter((f) => f.visibility === "hidden");
  const filterable = visible.filter((f) => f.filterable && f.visibility === "public");
  const available = stock.get(p.id)?.available ?? 0;
  const belowMin = p.minBalance > 0 && user.balance < p.minBalance;
  const maxBuy = Math.min(available, p.maxQty ?? Infinity, 5000);

  // Filters (public, filterable fields) and the item list.
  const where: SQL[] = [eq(inventoryItems.productId, p.id), eq(inventoryItems.status, "available")];
  const activeFilters: Record<string, string> = {};
  for (const f of filterable) {
    const v = sp[`f_${f.key}`];
    if (v) {
      activeFilters[f.key] = v;
      where.push(sql`${inventoryItems.data}->>${f.key} = ${v}`);
    }
  }
  const page = Math.max(1, Number(sp.page) || 1);
  const [filterValues, items, [{ total }]] = await Promise.all([
    Promise.all(
      filterable.map(async (f) => {
        const vals = await db.execute<{ v: string }>(
          sql`select distinct ${inventoryItems.data}->>${f.key} as v from ${inventoryItems}
              where ${inventoryItems.productId} = ${p.id} and ${inventoryItems.status} = 'available' and ${inventoryItems.data} ? ${f.key}
              order by 1 limit 200`,
        );
        return { field: f, values: vals.map((r) => r.v) };
      }),
    ),
    p.allowPick
      ? db.select().from(inventoryItems).where(and(...where)).orderBy(asc(inventoryItems.id)).limit(PAGE).offset((page - 1) * PAGE)
      : Promise.resolve([]),
    db.select({ total: sql<number>`count(*)::int` }).from(inventoryItems).where(and(...where)),
  ]);

  const qs = (patch: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(
      Object.entries({ ...sp, ...patch }).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    );
    return `/shop/${p.slug}?${params}`;
  };
  const formId = `pick-${p.id}`;

  return (
    <>
      <PageHeader back={{ href: "/shop", label: "Shop" }} title={p.name} description={category?.name} />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {p.imagePath && (
            <Card className="overflow-hidden">
              <img src={fileUrl(p.imagePath)!} alt="" className="aspect-[16/8] w-full object-cover" />
            </Card>
          )}
          {(p.description || p.summary) && (
            <Card className="p-5">
              <p className="whitespace-pre-line text-sm leading-relaxed">{p.description || p.summary}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="What you get" description="Each item contains these fields. Download as TXT or CSV after purchase." />
            <ul className="flex flex-wrap gap-2 p-5">
              {active.map((f) => (
                <li key={f.key}>
                  <Badge tone={f.visibility === "hidden" ? "neutral" : f.visibility === "masked" ? "amber" : "green"} className="gap-1 py-1">
                    {f.visibility === "hidden" && <Lock className="size-3" />}
                    {f.label}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Buy box */}
        <div className="order-first space-y-4 lg:order-none lg:sticky lg:top-20 lg:h-fit">
          <Card className="p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold tracking-tight tabular">{formatMoney(p.price)}</span>
              <span className="text-sm text-muted">per item</span>
            </div>
            {tiers.length > 0 && (
              <div className="mt-4 rounded-lg border border-border">
                <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">Bulk pricing</p>
                {tiers.map((t) => (
                  <div key={t.id} className="flex justify-between px-3 py-1.5 text-sm">
                    <span className="text-muted">{t.minQty}+ items</span>
                    <span className="font-medium tabular">{formatMoney(t.unitPrice)} each</span>
                  </div>
                ))}
              </div>
            )}
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li className="flex items-center gap-2">
                <ShieldCheck className="size-4" /> {available.toLocaleString()} in stock · instant delivery
              </li>
              <li className="flex items-center gap-2">
                <RotateCcw className="size-4" />
                {p.refundWindowHours > 0 ? `Refund requests within ${p.refundWindowHours}h` : "No refunds on this product"}
              </li>
              {p.minQty > 1 && (
                <li className="flex items-center gap-2">
                  <Clock className="size-4" /> Minimum order {p.minQty}
                </li>
              )}
            </ul>

            {belowMin && (
              <Alert tone="warn" className="mt-4">
                Requires a wallet balance of <b>{formatMoney(p.minBalance)}</b> to purchase. Your balance is {formatMoney(user.balance)}.
                <LinkButton href="/wallet" size="sm" className="mt-3 w-full" variant="accent">
                  Add funds
                </LinkButton>
              </Alert>
            )}

            {available > 0 && !belowMin && (
              <ActionForm action={buyAction} className="mt-5 space-y-3">
                <input type="hidden" name="productId" value={p.id} />
                <label className="block text-sm font-medium">Quantity</label>
                <div className="flex gap-2">
                  <Input name="quantity" type="number" min={p.minQty} max={maxBuy} defaultValue={p.minQty} required className="w-24" />
                  <SubmitButton className="flex-1" pendingText="Processing…">
                    Buy now
                  </SubmitButton>
                </div>
                <p className="text-xs text-muted">
                  Balance {formatMoney(user.balance)}. {p.allowPick ? "Or pick exact items below." : "You'll receive the next available items."}
                </p>
              </ActionForm>
            )}
            {available === 0 && <Alert className="mt-4">Out of stock. Check back soon.</Alert>}
          </Card>
        </div>
      </div>

      {p.allowPick && available > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Choose items</h2>
              <p className="text-sm text-muted">
                {locked.length > 0 && (
                  <>
                    <Lock className="mr-1 inline size-3.5" />
                    {locked.map((f) => f.label).join(", ")} unlock after purchase.
                  </>
                )}
              </p>
            </div>
            {filterValues.length > 0 && (
              <AutoSubmit action={`/shop/${p.slug}`} className="flex flex-wrap gap-2">
                {filterValues.map(({ field, values }) => (
                  <Select key={field.key} name={`f_${field.key}`} defaultValue={activeFilters[field.key] ?? ""} className="h-9 w-auto text-sm">
                    <option value="">All {field.label.toLowerCase()}</option>
                    {values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </Select>
                ))}
              </AutoSubmit>
            )}
          </div>

          {items.length === 0 ? (
            <EmptyState title="No items match these filters" action={<LinkButton href={`/shop/${p.slug}`} variant="secondary" size="sm">Clear filters</LinkButton>} />
          ) : (
            <Card>
              <ActionForm action={buyAction} id={formId} className="[&>div:first-child]:m-4">
                <input type="hidden" name="productId" value={p.id} />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                        <th className="w-10 px-4 py-2.5">
                          <SelectAll formId={formId} />
                        </th>
                        {visible.map((f) => (
                          <th key={f.key} className="whitespace-nowrap px-3 py-2.5 font-medium">
                            {f.label}
                          </th>
                        ))}
                        {locked.length > 0 && <th className="px-3 py-2.5 font-medium">Unlocks</th>}
                        <th className="px-4 py-2.5 text-right font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const price = item.priceOverride ?? p.price;
                        return (
                          <tr key={item.id} className="border-b border-border last:border-0 hover:bg-subtle/50">
                            <td className="px-4 py-2.5">
                              <input
                                type="checkbox"
                                name="item"
                                value={item.id}
                                data-price={price}
                                aria-label={`Select item ${item.id}`}
                                className="size-4 accent-[var(--accent)]"
                              />
                            </td>
                            {visible.map((f) => {
                              const v = previewValue(f, item.data[f.key]);
                              return (
                                <td key={f.key} className="max-w-56 truncate px-3 py-2.5" title={f.visibility === "public" ? v ?? "" : undefined}>
                                  {f.type === "image" && f.visibility === "public" && v ? (
                                    <img src={v} alt="" loading="lazy" className="size-10 rounded object-cover" />
                                  ) : v ? (
                                    <span className={f.visibility === "masked" ? "font-mono text-xs" : ""}>{v}</span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                              );
                            })}
                            {locked.length > 0 && (
                              <td className="px-3 py-2.5 text-muted">
                                <Lock className="inline size-3.5" />
                                <span className="ml-1 text-xs">{locked.length}</span>
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-right font-medium tabular">{formatMoney(price)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pages={Math.ceil(total / PAGE)} href={(n) => qs({ page: n })} />
                <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur">
                  <SelectionSummary formId={formId} currency={s.currency} />
                  {belowMin ? (
                    <Link href="/wallet" className="text-sm font-medium text-accent">
                      Add funds to buy →
                    </Link>
                  ) : (
                    <SubmitButton pendingText="Processing…">Buy selected</SubmitButton>
                  )}
                </div>
              </ActionForm>
            </Card>
          )}
          {tiers.length > 0 && <p className="mt-2 text-xs text-muted">Bulk prices apply automatically at checkout when you select enough items.</p>}
        </section>
      )}
    </>
  );
}
