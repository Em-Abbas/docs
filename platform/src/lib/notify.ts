import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { auditLogs, notifications, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

type Mail = { to: string; subject: string; text: string };

let transport: { sendMail: (m: Mail & { from: string }) => Promise<unknown> } | null = null;

export async function sendMail(mail: Mail) {
  const url = process.env.SMTP_URL;
  if (!url) {
    console.info(`[mail] (SMTP_URL not set) to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }
  try {
    if (!transport) {
      const nodemailer = await import("nodemailer");
      transport = nodemailer.createTransport(url);
    }
    await transport.sendMail({ ...mail, from: process.env.MAIL_FROM ?? "no-reply@localhost" });
  } catch (err) {
    console.error("[mail] failed to send", err);
  }
}

export async function notifyUser(
  userId: number,
  title: string,
  opts: { body?: string; href?: string; tx?: Tx } = {},
) {
  await (opts.tx ?? db).insert(notifications).values({ userId, title, body: opts.body, href: opts.href });
}

/** In-app notification for every admin plus an email to the configured admin address. */
export async function notifyAdmins(title: string, body: string, href: string) {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  if (admins.length) {
    await db.insert(notifications).values(admins.map((a) => ({ userId: a.id, title, body, href })));
  }
  const s = await getSettings();
  if (s.adminEmail) {
    const base = process.env.APP_URL ?? "http://localhost:3000";
    await sendMail({ to: s.adminEmail, subject: `[${s.siteName}] ${title}`, text: `${body}\n\nOpen: ${base}${href}` });
  }
}

export async function audit(
  actorId: number | null,
  action: string,
  entity?: string,
  entityId?: string | number,
  meta?: Record<string, unknown>,
  tx?: Tx,
) {
  await (tx ?? db).insert(auditLogs).values({
    actorId,
    action,
    entity,
    entityId: entityId == null ? null : String(entityId),
    meta,
  });
}
