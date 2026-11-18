"use server";

import { and, count, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { categories, inventoryItems, priceTiers, productFields, products, uploadBatches } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { bool, done, fail, int, str, zodErrors, type ActionState } from "@/lib/action-state";
import { FIELD_KEYS, parseMoney, slugify } from "@/lib/format";
import { hashItemData, insertItems, parseInventoryCsv, validateValue } from "@/lib/inventory";
import { audit } from "@/lib/notify";
import { saveUpload, UploadError } from "@/lib/storage";

/* -------------------------------------------------------------- categories */

export async function saveCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const name = str(fd, "name");
  if (name.length < 2) return fail("Name is too short.");
  const slug = slugify(str(fd, "slug") || name);
  const values = { name, slug, description: str(fd, "description") || null, sortOrder: int(fd, "sortOrder"), isActive: id ? bool(fd, "isActive") : true };
  try {
    if (id) await db.update(categories).set(values).where(eq(categories.id, id));
    else await db.insert(categories).values(values);
  } catch {
    return fail("A category with that slug already exists.");
  }
  await audit(admin.id, id ? "category.update" : "category.create", "category", id || slug);
  revalidatePath("/admin/categories");
  return done(id ? "Category saved" : "Category created");
}

export async function deleteCategoryAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  await db.delete(categories).where(eq(categories.id, id));
  await audit(admin.id, "category.delete", "category", id);
  revalidatePath("/admin/categories");
}

/* ---------------------------------------------------------------- products */

async function uniqueSlug(base: string, excludeId?: number) {
  let slug = base || "product";
  for (let i = 2; ; i++) {
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(excludeId ? and(eq(products.slug, slug), ne(products.id, excludeId)) : eq(products.slug, slug));
    if (!row) return slug;
    slug = `${base}-${i}`;
  }
}

export async function createProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const name = str(fd, "name");
  if (name.length < 2) return fail("Give the product a name.", { name: "Required" });
  const price = parseMoney(str(fd, "price"));
  if (price == null) return fail("Enter a valid price.", { price: "Enter a price like 9.99" });
  const categoryId = int(fd, "categoryId") || null;

  const [p] = await db
    .insert(products)
    .values({ name, slug: await uniqueSlug(slugify(name)), categoryId, price, summary: str(fd, "summary") || null })
    .returning({ id: products.id });
  // Start with two fields so the builder isn't empty.
  await db.insert(productFields).values([
    { productId: p.id, key: "A", label: "Title", type: "text", visibility: "public", required: true },
    { productId: p.id, key: "B", label: "Content", type: "secret", visibility: "hidden", required: true },
  ]);
  await audit(admin.id, "product.create", "product", p.id, { name });
  redirect(`/admin/products/${p.id}?tab=fields`);
}

export async function updateProductDetailsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const name = str(fd, "name");
  if (name.length < 2) return fail("Name is too short.");
  let imagePath: string | null | undefined;
  try {
    imagePath = await saveUpload(fd.get("image"), "image");
  } catch (e) {
    return fail(e instanceof UploadError ? e.message : "Image upload failed.");
  }
  const status = str(fd, "status") as "draft" | "active" | "hidden";
  if (!["draft", "active", "hidden"].includes(status)) return fail("Invalid status.");

  await db
    .update(products)
    .set({
      name,
      slug: await uniqueSlug(slugify(str(fd, "slug") || name), id),
      categoryId: int(fd, "categoryId") || null,
      summary: str(fd, "summary") || null,
      description: str(fd, "description") || null,
      deliveryNote: str(fd, "deliveryNote") || null,
      status,
      featured: bool(fd, "featured"),
      sortOrder: int(fd, "sortOrder"),
      ...(imagePath ? { imagePath } : bool(fd, "removeImage") ? { imagePath: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(products.id, id));
  await audit(admin.id, "product.update", "product", id);
  revalidatePath(`/admin/products/${id}`);
  return done("Product saved");
}

const fieldSchema = z.object({
  label: z.string().trim().min(1, "Label required").max(40, "Label too long"),
  type: z.enum(["text", "longtext", "number", "email", "url", "date", "boolean", "image", "file", "secret"]),
  visibility: z.enum(["public", "masked", "hidden"]),
});

export async function updateProductFieldsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const rows: (typeof productFields.$inferInsert)[] = [];
  const labels = new Set<string>();
  for (const key of FIELD_KEYS) {
    const enabled = bool(fd, `${key}.enabled`);
    const label = str(fd, `${key}.label`);
    if (!enabled && !label) continue;
    const parsed = fieldSchema.safeParse({ label, type: str(fd, `${key}.type`), visibility: str(fd, `${key}.visibility`) });
    if (!parsed.success) return fail(`Field ${key}: ${parsed.error.issues[0].message}`);
    if (enabled) {
      const l = parsed.data.label.toLowerCase();
      if (labels.has(l) || l === "price") return fail(`Field ${key}: label "${parsed.data.label}" is duplicated or reserved.`);
      labels.add(l);
    }
    rows.push({
      productId,
      key,
      ...parsed.data,
      enabled,
      filterable: bool(fd, `${key}.filterable`) && parsed.data.visibility === "public",
      required: bool(fd, `${key}.required`),
    });
  }
  if (!rows.some((r) => r.enabled)) return fail("Enable at least one field.");
  if (!rows.some((r) => r.enabled && r.visibility === "hidden"))
    return fail("Add at least one Hidden field — that's the data buyers unlock after purchase.");

  await db.transaction(async (tx) => {
    await tx.delete(productFields).where(eq(productFields.productId, productId));
    await tx.insert(productFields).values(rows);
    await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, productId));
  });
  await audit(admin.id, "product.fields", "product", productId, { fields: rows.length });
  revalidatePath(`/admin/products/${productId}`);
  return done("Fields saved. Download a fresh CSV template if you changed columns.");
}

export async function updateProductPricingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const price = parseMoney(str(fd, "price"));
  if (price == null || price <= 0) return fail("Enter a unit price above zero.", { price: "Required" });
  const minBalance = parseMoney(str(fd, "minBalance") || "0");
  if (minBalance == null) return fail("Minimum balance must be an amount like 25.00.");

  const tiers: { minQty: number; unitPrice: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const qty = int(fd, `tier.${i}.qty`);
    const p = str(fd, `tier.${i}.price`);
    if (!qty && !p) continue;
    const unit = parseMoney(p);
    if (qty < 2 || unit == null || unit <= 0) return fail(`Bulk tier ${i + 1}: quantity must be 2+ and price above zero.`);
    if (tiers.some((t) => t.minQty === qty)) return fail(`Two bulk tiers start at ${qty}.`);
    tiers.push({ minQty: qty, unitPrice: unit });
  }
  const minQty = Math.max(1, int(fd, "minQty", 1));
  const maxQty = int(fd, "maxQty") || null;
  if (maxQty && maxQty < minQty) return fail("Maximum per order must be at least the minimum.");

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({
        price,
        minBalance,
        minQty,
        maxQty,
        allowPick: bool(fd, "allowPick"),
        refundWindowHours: Math.max(0, int(fd, "refundWindowHours")),
        resellerEnabled: bool(fd, "resellerEnabled"),
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));
    await tx.delete(priceTiers).where(eq(priceTiers.productId, productId));
    if (tiers.length) await tx.insert(priceTiers).values(tiers.map((t) => ({ ...t, productId })));
  });
  await audit(admin.id, "product.pricing", "product", productId, { price, tiers: tiers.length, minBalance });
  revalidatePath(`/admin/products/${productId}`);
  return done("Pricing and rules saved");
}

export async function deleteProductAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = int(fd, "id");
  const [{ sold }] = await db
    .select({ sold: count() })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.productId, id), inArray(inventoryItems.status, ["sold", "refunded"])));
  if (sold > 0) {
    // Keep order history intact: hide instead of deleting.
    await db.update(products).set({ status: "hidden" }).where(eq(products.id, id));
    await audit(admin.id, "product.hide", "product", id);
    redirect(`/admin/products/${id}?tab=details&hidden=1`);
  }
  await db.delete(products).where(eq(products.id, id));
  await audit(admin.id, "product.delete", "product", id);
  redirect("/admin/products");
}

/* --------------------------------------------------------------- inventory */

export async function uploadCsvAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file to upload.");
  if (file.size > 25 * 1024 * 1024) return fail("File is larger than 25 MB. Split it into smaller files.");

  const fields = await db.select().from(productFields).where(eq(productFields.productId, productId));
  const result = parseInventoryCsv(await file.text(), fields, { allowPrice: true });
  if (result.fatal) return fail(result.fatal);

  const summary = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(uploadBatches)
      .values({ productId, uploaderId: admin.id, filename: file.name.slice(0, 120), totalRows: result.total, status: "approved" })
      .returning({ id: uploadBatches.id });
    const inserted = await insertItems(tx, { productId, batchId: batch.id, sellerId: null, status: "available" }, result.rows);
    const duplicates = result.rows.length - inserted;
    await tx
      .update(uploadBatches)
      .set({ acceptedRows: inserted, rejectedRows: result.errors.length, duplicateRows: duplicates, errors: result.errors.slice(0, 200) })
      .where(eq(uploadBatches.id, batch.id));
    return { batchId: batch.id, inserted, duplicates };
  });

  await audit(admin.id, "inventory.upload", "product", productId, { ...summary, rejected: result.errors.length });
  revalidatePath(`/admin/products/${productId}`);
  const parts = [`${summary.inserted} item(s) added`];
  if (summary.duplicates) parts.push(`${summary.duplicates} duplicate(s) skipped`);
  if (result.errors.length) parts.push(`${result.errors.length} row(s) rejected — see upload history`);
  return { ok: true, message: parts.join(" · ") + ".", data: { errors: result.errors.slice(0, 20) } };
}

export async function addItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const fields = (await db.select().from(productFields).where(eq(productFields.productId, productId))).filter((f) => f.enabled);
  const data: Record<string, string> = {};
  try {
    for (const f of fields) {
      let raw = str(fd, f.key);
      if (f.type === "image" || f.type === "file") {
        const key = await saveUpload(fd.get(`${f.key}.upload`), f.type === "image" ? "image" : "item");
        if (key) raw = key.startsWith("public/") ? `/media/${key.slice(7)}` : `/files/${key}`;
      }
      const res = validateValue(f, raw);
      if ("error" in res) return fail(res.error);
      if (res.value) data[f.key] = res.value;
    }
  } catch (e) {
    return fail(e instanceof UploadError ? e.message : "Upload failed.");
  }
  const priceRaw = str(fd, "price");
  const price = priceRaw ? parseMoney(priceRaw) : null;
  if (priceRaw && price == null) return fail("Price override must be an amount like 9.99.");

  const inserted = await db.transaction((tx) =>
    insertItems(tx, { productId, batchId: null, sellerId: null, status: "available" }, [{ data, price }]),
  );
  if (!inserted) return fail("An identical item already exists for this product.");
  await audit(admin.id, "inventory.add", "product", productId, { hash: hashItemData(data).slice(0, 12) });
  revalidatePath(`/admin/products/${productId}`);
  return done("Item added");
}

export async function removeItemsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const ids = fd.getAll("item").map((v) => Number(v)).filter(Number.isFinite);
  if (!ids.length) return fail("Select at least one item.");
  // Only unsold stock can be removed; sold items stay for order history.
  const res = await db
    .update(inventoryItems)
    .set({ status: "removed" })
    .where(and(eq(inventoryItems.productId, productId), inArray(inventoryItems.id, ids), inArray(inventoryItems.status, ["available", "pending_review"])))
    .returning({ id: inventoryItems.id });
  await audit(admin.id, "inventory.remove", "product", productId, { count: res.length });
  revalidatePath(`/admin/products/${productId}`);
  return done(`${res.length} item(s) removed from sale.`);
}

export async function removeAllAvailableAction(fd: FormData) {
  const admin = await requireAdmin();
  const productId = int(fd, "id");
  const res = await db
    .update(inventoryItems)
    .set({ status: "removed" })
    .where(and(eq(inventoryItems.productId, productId), eq(inventoryItems.status, "available")))
    .returning({ id: inventoryItems.id });
  await audit(admin.id, "inventory.clear", "product", productId, { count: res.length });
  revalidatePath(`/admin/products/${productId}`);
}
