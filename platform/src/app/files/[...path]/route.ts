import { and, eq, or } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { depositMessages, deposits } from "@/lib/db/schema";
import { readStored } from "@/lib/storage";

/**
 * Private files.
 * - receipts/*  payment receipts: only the depositing user and admins.
 * - items/*     files attached to inventory rows: logged-in users holding the
 *               unguessable link (it is only revealed after purchase).
 */
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  const session = await getSession();
  if (!session || parts.length !== 2 || !["receipts", "items"].includes(parts[0]) || !/^[a-zA-Z0-9._-]+$/.test(parts[1])) {
    return new Response("Not found", { status: 404 });
  }
  const key = `${parts[0]}/${parts[1]}`;

  if (parts[0] === "receipts" && session.user.role !== "admin") {
    const [owned] = await db
      .select({ id: deposits.id })
      .from(deposits)
      .leftJoin(depositMessages, eq(depositMessages.depositId, deposits.id))
      .where(and(eq(deposits.userId, session.user.id), or(eq(deposits.receiptPath, key), eq(depositMessages.attachmentPath, key))))
      .limit(1);
    if (!owned) return new Response("Not found", { status: 404 });
  }

  const file = await readStored(key);
  if (!file) return new Response("Not found", { status: 404 });
  const inline = /^(image\/|application\/pdf)/.test(file.type);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.type,
      "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${parts[1].replace(/^[a-f0-9]{32}-/, "")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
