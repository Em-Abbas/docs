import { ActionForm, SubmitButton } from "@/components/client/form";
import { Alert, Card, CardHeader, Checkbox, Field, Input, Select, Textarea, inputClass, cn } from "@/components/ui";
import {
  deleteProductAction,
  updateProductDetailsAction,
  updateProductFieldsAction,
  updateProductPricingAction,
} from "@/lib/actions/catalog";
import type { Category, PriceTier, Product, ProductField } from "@/lib/db/schema";
import { FIELD_KEYS, centsToInput } from "@/lib/format";
import { FIELD_TYPE_LABELS } from "@/lib/inventory";
import { fileUrl } from "@/lib/storage";

/* ------------------------------------------------------------------ details */

export function DetailsTab({ product: p, categories }: { product: Product; categories: Category[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <Card>
        <ActionForm action={updateProductDetailsAction} className="space-y-4 p-5">
          <input type="hidden" name="id" value={p.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" defaultValue={p.name} required />
            </Field>
            <Field label="URL slug">
              <Input name="slug" defaultValue={p.slug} />
            </Field>
            <Field label="Category">
              <Select name="categoryId" defaultValue={p.categoryId ?? ""}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" hint="Only Active products appear in the shop.">
              <Select name="status" defaultValue={p.status}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
              </Select>
            </Field>
          </div>
          <Field label="Summary" hint="One line on the product card.">
            <Input name="summary" defaultValue={p.summary ?? ""} maxLength={140} />
          </Field>
          <Field label="Description">
            <Textarea name="description" defaultValue={p.description ?? ""} rows={5} />
          </Field>
          <Field label="Delivery note" hint="Printed at the top of every download (instructions, warranty, support contact).">
            <Textarea name="deliveryNote" defaultValue={p.deliveryNote ?? ""} rows={2} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cover image" hint="PNG, JPG or WEBP. Resized to 1200px.">
              <input name="image" type="file" accept="image/*" className={cn(inputClass, "w-full py-1.5")} />
            </Field>
            <Field label="Sort order" hint="Lower numbers show first.">
              <Input name="sortOrder" type="number" defaultValue={p.sortOrder} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-6">
            <Checkbox name="featured" label="Featured" hint="Pinned to the top of the shop." defaultChecked={p.featured} />
            {p.imagePath && <Checkbox name="removeImage" label="Remove current image" />}
          </div>
          <SubmitButton>Save details</SubmitButton>
        </ActionForm>
      </Card>
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <div className="aspect-[4/3] bg-subtle">
            {p.imagePath ? (
              <img src={fileUrl(p.imagePath)!} alt="" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-xs text-muted">No image</div>
            )}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium">Delete product</p>
          <p className="mt-1 text-xs text-muted">Products with sales are hidden instead, so order history stays intact.</p>
          <form action={deleteProductAction} className="mt-3">
            <input type="hidden" name="id" value={p.id} />
            <button className="text-sm font-medium text-red-600 hover:underline">Delete product</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- fields */

export function FieldsTab({ productId, fields }: { productId: number; fields: ProductField[] }) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return (
    <Card>
      <CardHeader
        title="Data fields"
        description="Up to 10 columns (A–J). Every inventory row stores a value per column. Choose what shoppers can see before buying."
      />
      <ActionForm action={updateProductFieldsAction} className="p-5">
        <input type="hidden" name="id" value={productId} />
        <Alert className="mb-5 text-xs leading-relaxed">
          <b>Public</b> values show in the shop and can be filters (e.g. Country). <b>Masked</b> values show partly (jo•••@ex•••.com).{" "}
          <b>Hidden</b> values unlock only after purchase — every product needs at least one.
        </Alert>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-10 pb-2 font-medium">Col</th>
                <th className="w-12 pb-2 font-medium">On</th>
                <th className="pb-2 font-medium">Label</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium">Visibility</th>
                <th className="w-20 pb-2 text-center font-medium">Filter</th>
                <th className="w-20 pb-2 text-center font-medium">Required</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_KEYS.map((key) => {
                const f = byKey.get(key);
                return (
                  <tr key={key} className="border-t border-border">
                    <td className="py-2 font-mono text-muted">{key}</td>
                    <td className="py-2">
                      <input type="checkbox" name={`${key}.enabled`} defaultChecked={f?.enabled ?? false} className="size-4 accent-[var(--accent)]" />
                    </td>
                    <td className="py-2 pr-2">
                      <Input name={`${key}.label`} defaultValue={f?.label ?? ""} placeholder={`Field ${key}`} className="h-9" />
                    </td>
                    <td className="py-2 pr-2">
                      <Select name={`${key}.type`} defaultValue={f?.type ?? "text"} className="h-9">
                        {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-2 pr-2">
                      <Select name={`${key}.visibility`} defaultValue={f?.visibility ?? "hidden"} className="h-9">
                        <option value="public">Public</option>
                        <option value="masked">Masked</option>
                        <option value="hidden">Hidden</option>
                      </Select>
                    </td>
                    <td className="py-2 text-center">
                      <input type="checkbox" name={`${key}.filterable`} defaultChecked={f?.filterable ?? false} className="size-4 accent-[var(--accent)]" />
                    </td>
                    <td className="py-2 text-center">
                      <input type="checkbox" name={`${key}.required`} defaultChecked={f?.required ?? false} className="size-4 accent-[var(--accent)]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted">
          Filters only apply to Public fields. Renaming a label keeps existing data (values are stored by column letter).
        </p>
        <SubmitButton className="mt-5">Save fields</SubmitButton>
      </ActionForm>
    </Card>
  );
}

/* ------------------------------------------------------------------ pricing */

export function PricingTab({ product: p, tiers }: { product: Product; tiers: PriceTier[] }) {
  return (
    <ActionForm action={updateProductPricingAction} className="grid gap-6 lg:grid-cols-2">
      <input type="hidden" name="id" value={p.id} />
      <Card>
        <CardHeader title="Pricing" description="Default unit price and automatic bulk discounts." />
        <div className="space-y-5 p-5">
          <Field label="Unit price (USD)" hint="Individual rows can override this with a Price column in the CSV.">
            <Input name="price" inputMode="decimal" defaultValue={centsToInput(p.price)} required className="max-w-40" />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">Bulk pricing</p>
            <p className="mb-3 text-xs text-muted">When a buyer orders at least this many, every unit costs the tier price.</p>
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-12 text-muted">Buy</span>
                  <Input name={`tier.${i}.qty`} type="number" min={2} defaultValue={tiers[i]?.minQty ?? ""} placeholder="10" className="h-9 w-24" />
                  <span className="text-muted">+ at</span>
                  <Input
                    name={`tier.${i}.price`}
                    inputMode="decimal"
                    defaultValue={centsToInput(tiers[i]?.unitPrice)}
                    placeholder="0.00"
                    className="h-9 w-28"
                  />
                  <span className="text-muted">each</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Purchase rules" />
        <div className="space-y-5 p-5">
          <Field label="Minimum balance to purchase (USD)" hint="Buyers need at least this much in their wallet before they can buy. 0 = no minimum.">
            <Input name="minBalance" inputMode="decimal" defaultValue={centsToInput(p.minBalance)} className="max-w-40" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Min per order">
              <Input name="minQty" type="number" min={1} defaultValue={p.minQty} />
            </Field>
            <Field label="Max per order" hint="Empty = no limit">
              <Input name="maxQty" type="number" min={1} defaultValue={p.maxQty ?? ""} />
            </Field>
          </div>
          <Field label="Refund window (hours)" hint="Buyers can request a refund per item within this time. 0 disables refunds.">
            <Input name="refundWindowHours" type="number" min={0} defaultValue={p.refundWindowHours} className="max-w-40" />
          </Field>
          <Checkbox
            name="allowPick"
            defaultChecked={p.allowPick}
            label="Let buyers pick specific items"
            hint="Otherwise they choose a quantity and receive the oldest available items."
          />
          <Checkbox
            name="resellerEnabled"
            defaultChecked={p.resellerEnabled}
            label="Accept reseller stock"
            hint="Approved resellers can upload inventory for this product (reviewed by you)."
          />
        </div>
      </Card>
      <div className="lg:col-span-2">
        <SubmitButton>Save pricing & rules</SubmitButton>
      </div>
    </ActionForm>
  );
}
