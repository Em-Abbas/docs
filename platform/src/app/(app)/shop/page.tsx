import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { LayoutGrid, List, Search } from "lucide-react";
import { AutoSubmit } from "@/components/client/widgets";
import { Badge, Card, EmptyState, Input, PageHeader, Select, cn } from "@/components/ui";
import { db } from "@/lib/db";
import { categories, priceTiers, products } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { fromPrice } from "@/lib/pricing";
import { stockCounts } from "@/lib/queries";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Shop" };

type SP = { q?: string; category?: string; sort?: string; view?: string; stock?: string };

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : "grid";
  const cats = await db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.sortOrder), asc(categories.name));
  const activeCat = cats.find((c) => c.slug === sp.category);

  const where: (SQL | undefined)[] = [
    eq(products.status, "active"),
    or(isNull(products.categoryId), inArray(products.categoryId, cats.length ? cats.map((c) => c.id) : [-1])),
  ];
  if (activeCat) where.push(eq(products.categoryId, activeCat.id));
  if (sp.q) where.push(or(ilike(products.name, `%${sp.q}%`), ilike(products.summary, `%${sp.q}%`)));

  const order =
    sp.sort === "price_asc"
      ? [asc(products.price)]
      : sp.sort === "price_desc"
        ? [desc(products.price)]
        : sp.sort === "newest"
          ? [desc(products.createdAt)]
          : [desc(products.featured), asc(products.sortOrder), desc(products.createdAt)];

  const rows = await db
    .select({ p: products, category: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...where))
    .orderBy(...order);

  const ids = rows.map((r) => r.p.id);
  const [stock, tiers] = await Promise.all([
    stockCounts(ids),
    ids.length ? db.select().from(priceTiers).where(inArray(priceTiers.productId, ids)) : Promise.resolve([]),
  ]);
  let list = rows.map((r) => ({
    ...r,
    available: stock.get(r.p.id)?.available ?? 0,
    from: fromPrice(r.p.price, tiers.filter((t) => t.productId === r.p.id)),
  }));
  if (sp.stock === "1") list = list.filter((r) => r.available > 0);

  const link = (patch: Partial<SP>) => {
    const params = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const qs = params.toString();
    return qs ? `/shop?${qs}` : "/shop";
  };

  return (
    <>
      <PageHeader title="Shop" description="Instant delivery. Download your data as TXT or CSV right after purchase." />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Chip href={link({ category: undefined })} active={!activeCat}>
          All
        </Chip>
        {cats.map((c) => (
          <Chip key={c.id} href={link({ category: c.slug })} active={activeCat?.id === c.id}>
            {c.name}
          </Chip>
        ))}
      </div>

      <AutoSubmit action="/shop" className="mb-6 flex flex-wrap items-center gap-2">
        {activeCat && <input type="hidden" name="category" value={activeCat.slug} />}
        {view === "list" && <input type="hidden" name="view" value="list" />}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input name="q" type="search" defaultValue={sp.q} placeholder="Search products…" className="pl-9" />
        </div>
        <Select name="sort" defaultValue={sp.sort ?? ""} className="w-auto">
          <option value="">Featured</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </Select>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm">
          <input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} className="size-4 accent-[var(--accent)]" />
          In stock
        </label>
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
          <Link href={link({ view: undefined })} aria-label="Grid view" className={cn("rounded-md p-2", view === "grid" ? "bg-subtle text-fg" : "text-muted")}>
            <LayoutGrid className="size-4" />
          </Link>
          <Link href={link({ view: "list" })} aria-label="List view" className={cn("rounded-md p-2", view === "list" ? "bg-subtle text-fg" : "text-muted")}>
            <List className="size-4" />
          </Link>
        </div>
      </AutoSubmit>

      {list.length === 0 ? (
        <EmptyState title="No products found" description="Try a different search or category." />
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map(({ p, category, available, from }) => (
            <Link key={p.id} href={`/shop/${p.slug}`} className="group">
              <Card className="h-full overflow-hidden transition group-hover:border-fg/20 group-hover:shadow-sm">
                <div className="relative aspect-[16/10] overflow-hidden bg-subtle">
                  {p.imagePath && (
                    <img
                      src={fileUrl(p.imagePath)!}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    />
                  )}
                  {p.featured && <Badge tone="accent" className="absolute left-3 top-3 bg-surface/90 backdrop-blur">Featured</Badge>}
                </div>
                <div className="flex flex-col gap-1 p-4">
                  <span className="text-xs text-muted">{category ?? "General"}</span>
                  <h3 className="font-medium leading-snug">{p.name}</h3>
                  {p.summary && <p className="line-clamp-2 text-sm text-muted">{p.summary}</p>}
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <span className="text-xs text-muted">{from < p.price ? "from " : ""}</span>
                      <span className="text-lg font-semibold tabular">{formatMoney(from)}</span>
                    </div>
                    <StockLabel n={available} />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="divide-y divide-border">
          {list.map(({ p, category, available, from }) => (
            <Link key={p.id} href={`/shop/${p.slug}`} className="flex items-center gap-4 p-3 transition hover:bg-subtle/60 sm:p-4">
              <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-subtle">
                {p.imagePath && <img src={fileUrl(p.imagePath)!} alt="" loading="lazy" className="size-full object-cover" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="truncate text-sm text-muted">
                  {category ?? "General"}
                  {p.summary ? ` · ${p.summary}` : ""}
                </p>
              </div>
              <div className="hidden sm:block">
                <StockLabel n={available} />
              </div>
              <div className="w-24 text-right">
                <p className="font-semibold tabular">{formatMoney(from)}</p>
                {from < p.price && <p className="text-xs text-muted">bulk price</p>}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition",
        active ? "border-fg bg-fg text-bg" : "border-border bg-surface text-muted hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}

function StockLabel({ n }: { n: number }) {
  if (n === 0) return <Badge>Out of stock</Badge>;
  return <Badge tone={n < 10 ? "amber" : "green"}>{n.toLocaleString()} in stock</Badge>;
}
