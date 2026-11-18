import { asc, count, eq } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Table, td, th } from "@/components/ui";
import { deleteCategoryAction, saveCategoryAction } from "@/lib/actions/catalog";
import { db } from "@/lib/db";
import { categories, products } from "@/lib/db/schema";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const rows = await db
    .select({ c: categories, products: count(products.id) })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return (
    <>
      <PageHeader title="Categories" description="Group products in the shop. Shoppers filter by these." />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Products</th>
                <th className={th}>Order</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, products: n }) => (
                <tr key={c.id}>
                  <td className={td} colSpan={5}>
                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-4">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{c.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted">/{c.slug}</span>
                        </span>
                        <span className="w-16 text-muted tabular">{n}</span>
                        <span className="w-12 text-muted tabular">{c.sortOrder}</span>
                        <span className="w-20">{c.isActive ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>}</span>
                        <span className="text-xs text-muted group-open:hidden">Edit</span>
                      </summary>
                      <ActionForm action={saveCategoryAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                        <input type="hidden" name="id" value={c.id} />
                        <Field label="Name">
                          <Input name="name" defaultValue={c.name} required />
                        </Field>
                        <Field label="Slug">
                          <Input name="slug" defaultValue={c.slug} />
                        </Field>
                        <Field label="Description" className="sm:col-span-2">
                          <Input name="description" defaultValue={c.description ?? ""} />
                        </Field>
                        <Field label="Sort order">
                          <Input name="sortOrder" type="number" defaultValue={c.sortOrder} />
                        </Field>
                        <div className="flex items-end pb-2">
                          <Checkbox name="isActive" label="Visible in shop" defaultChecked={c.isActive} />
                        </div>
                        <div className="flex gap-2 sm:col-span-2">
                          <SubmitButton size="sm">Save</SubmitButton>
                        </div>
                      </ActionForm>
                      <form action={deleteCategoryAction} className="mt-2">
                        <input type="hidden" name="id" value={c.id} />
                        <button className="text-xs text-red-600 hover:underline">Delete category (products become uncategorized)</button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-center text-muted`} colSpan={5}>
                    No categories yet.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
        <Card className="h-fit">
          <CardHeader title="New category" />
          <ActionForm action={saveCategoryAction} resetOnSuccess className="space-y-3 p-5">
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Slug" hint="Optional — generated from the name.">
              <Input name="slug" />
            </Field>
            <Field label="Sort order">
              <Input name="sortOrder" type="number" defaultValue={0} />
            </Field>
            <SubmitButton className="w-full">Create category</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
