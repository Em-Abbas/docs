import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { stockCounts } from "@/lib/queries";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const rows = await db
    .select({ p: products, category: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(asc(products.sortOrder), desc(products.createdAt));
  const stock = await stockCounts(rows.map((r) => r.p.id));

  return (
    <>
      <PageHeader
        title="Products"
        description="Each product defines its data fields (A–J), pricing and rules. Inventory rows are uploaded by CSV."
        actions={
          <LinkButton href="/admin/products/new">
            <Plus className="size-4" /> New product
          </LinkButton>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No products yet" description="Create your first product, define its fields, then upload inventory." />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Category</th>
                <th className={th}>Price</th>
                <th className={th}>Available</th>
                <th className={th}>Sold</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, category }) => {
                const s = stock.get(p.id) ?? {};
                return (
                  <tr key={p.id} className="hover:bg-subtle/60">
                    <td className={td}>
                      <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                        <span className="size-9 shrink-0 overflow-hidden rounded-md border border-border bg-subtle">
                          {p.imagePath && <img src={fileUrl(p.imagePath)!} alt="" className="size-full object-cover" loading="lazy" />}
                        </span>
                        <span className="font-medium hover:underline">{p.name}</span>
                      </Link>
                    </td>
                    <td className={`${td} text-muted`}>{category ?? "—"}</td>
                    <td className={`${td} tabular`}>{formatMoney(p.price)}</td>
                    <td className={`${td} tabular`}>{(s.available ?? 0).toLocaleString()}</td>
                    <td className={`${td} tabular text-muted`}>{(s.sold ?? 0).toLocaleString()}</td>
                    <td className={td}>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
