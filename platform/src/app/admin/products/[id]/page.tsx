import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { Alert, LinkButton, PageHeader, StatusBadge, cn } from "@/components/ui";
import { db } from "@/lib/db";
import { categories, priceTiers, productFields, products } from "@/lib/db/schema";
import { stockCounts } from "@/lib/queries";
import { DetailsTab, FieldsTab, PricingTab } from "./settings-tabs";
import { InventoryTab } from "./inventory-tab";
import { UploadsTab } from "./uploads-tab";
import { requireAdmin } from "@/lib/auth/session";

const TABS = [
  { id: "details", label: "Details" },
  { id: "fields", label: "Fields A–J" },
  { id: "pricing", label: "Pricing & rules" },
  { id: "uploads", label: "Bulk upload" },
  { id: "inventory", label: "Inventory" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [p] = await db.select({ name: products.name }).from(products).where(eq(products.id, Number((await params).id)));
  return { title: p?.name ?? "Product" };
}

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) notFound();

  const [fields, tiers, cats, stock] = await Promise.all([
    db.select().from(productFields).where(eq(productFields.productId, id)).orderBy(asc(productFields.key)),
    db.select().from(priceTiers).where(eq(priceTiers.productId, id)).orderBy(asc(priceTiers.minQty)),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    stockCounts([id]),
  ]);
  const counts = stock.get(id) ?? {};
  const tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as (typeof TABS)[number]["id"]) : "details";

  return (
    <>
      <PageHeader
        back={{ href: "/admin/products", label: "Products" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {product.name} <StatusBadge status={product.status} />
          </span>
        }
        description={`${(counts.available ?? 0).toLocaleString()} available · ${(counts.sold ?? 0).toLocaleString()} sold · ${fields.filter((f) => f.enabled).length} fields`}
        actions={
          product.status === "active" && (
            <LinkButton href={`/shop/${product.slug}`} variant="secondary" size="sm" target="_blank">
              View in shop <ExternalLink className="size-3.5" />
            </LinkButton>
          )
        }
      />
      {sp.hidden && (
        <Alert tone="warn" className="mb-4">
          This product has sales history, so it was hidden instead of deleted.
        </Alert>
      )}
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/products/${id}?tab=${t.id}`}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "details" && <DetailsTab product={product} categories={cats} />}
      {tab === "fields" && <FieldsTab productId={id} fields={fields} />}
      {tab === "pricing" && <PricingTab product={product} tiers={tiers} />}
      {tab === "uploads" && <UploadsTab productId={id} fields={fields} />}
      {tab === "inventory" && <InventoryTab product={product} fields={fields} counts={counts} searchParams={sp} />}
    </>
  );
}
