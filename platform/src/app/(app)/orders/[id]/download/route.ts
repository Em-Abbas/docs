import { asc, eq } from "drizzle-orm";
import Papa from "papaparse";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

/** Order delivery as a Notepad-friendly .txt (labelled blocks) or a .csv with headers. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const id = Number((await params).id);
  if (!session || !Number.isInteger(id)) return new Response("Not found", { status: 404 });

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order || (order.userId !== session.user.id && session.user.role !== "admin")) return new Response("Not found", { status: 404 });

  const items = (await db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.id))).filter(
    (i) => i.refundStatus !== "approved",
  );
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "txt";
  const fields = order.fields;
  const base = `order-${order.id}-${order.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

  let body: string;
  if (format === "csv") {
    body =
      "﻿" +
      Papa.unparse({
        fields: fields.map((f) => f.label),
        data: items.map((i) => fields.map((f) => i.data[f.key] ?? "")),
      });
  } else {
    const s = await getSettings();
    const width = Math.max(...fields.map((f) => f.label.length), 4);
    const rule = "=".repeat(48);
    const lines = [
      `${s.siteName} — Order #${order.id}`,
      `Product:   ${order.productName}`,
      `Purchased: ${order.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
      `Items:     ${items.length}`,
      ...(order.deliveryNote ? ["", order.deliveryNote] : []),
      rule,
    ];
    items.forEach((item, idx) => {
      lines.push("", `Item ${idx + 1} of ${items.length}`, "-".repeat(24));
      for (const f of fields) lines.push(`${f.label.padEnd(width)} : ${item.data[f.key] ?? ""}`);
    });
    lines.push("", rule, "");
    body = lines.join("\r\n");
  }

  return new Response(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
