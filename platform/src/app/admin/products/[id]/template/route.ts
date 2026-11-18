import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { productFields, products } from "@/lib/db/schema";
import { buildTemplateCsv } from "@/lib/inventory";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const id = Number((await params).id);
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!session || !product) return new Response("Not found", { status: 404 });

  const isAdmin = session.user.role === "admin";
  const isReseller = session.user.resellerStatus === "approved" && product.resellerEnabled;
  if (!isAdmin && !isReseller) return new Response("Not found", { status: 404 });

  const fields = await db.select().from(productFields).where(eq(productFields.productId, id));
  const csv = buildTemplateCsv(
    fields.sort((a, b) => a.key.localeCompare(b.key)),
    isAdmin,
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${product.slug}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
