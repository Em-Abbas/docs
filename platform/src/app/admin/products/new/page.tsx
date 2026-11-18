import { asc } from "drizzle-orm";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { createProductAction } from "@/lib/actions/catalog";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const cats = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  return (
    <>
      <PageHeader title="New product" back={{ href: "/admin/products", label: "Products" }} description="You'll define its data fields next." />
      <Card className="max-w-xl p-6">
        <ActionForm action={createProductAction} className="space-y-4">
          <Field label="Product name">
            <Input name="name" required autoFocus placeholder="e.g. Verified B2B leads — US" />
            <FieldError name="name" />
          </Field>
          <Field label="Short summary" hint="One line shown on the product card.">
            <Input name="summary" maxLength={140} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select name="categoryId" defaultValue="">
                <option value="">Uncategorized</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit price (USD)">
              <Input name="price" inputMode="decimal" placeholder="9.99" required />
              <FieldError name="price" />
            </Field>
          </div>
          <SubmitButton>Create and set up fields</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
