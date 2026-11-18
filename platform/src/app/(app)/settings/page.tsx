import { desc, eq, gt, and } from "drizzle-orm";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { changePasswordAction, revokeSessionAction } from "@/lib/actions/auth";
import { getSession, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { formatDate, timeAgo } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { BackupCodesForm, PhraseForm, ResetAuthenticatorForm } from "./security-forms";

export const metadata = { title: "Security" };

export default async function SettingsPage() {
  const user = await requireUser();
  const current = await getSession();
  const s = await getSettings();
  const active = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.createdAt));

  return (
    <>
      <PageHeader title="Security" description={`Signed in as ${user.username} · member since ${formatDate(user.createdAt, false)}`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Password" description="Changing it signs out your other devices." />
          <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Current password">
              <Input name="current" type="password" autoComplete="current-password" required />
              <FieldError name="current" />
            </Field>
            <Field label="New password">
              <Input name="password" type="password" autoComplete="new-password" minLength={8} required />
              <FieldError name="password" />
            </Field>
            <Field label="Re-enter new password">
              <Input name="confirm" type="password" autoComplete="new-password" required />
              <FieldError name="confirm" />
            </Field>
            <div className="sm:col-span-3">
              <SubmitButton>Update password</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardHeader
            title="Backup codes"
            description="Single-use codes for logging in without your authenticator."
            action={<Badge tone={user.backupCodes.length > 3 ? "green" : "amber"}>{user.backupCodes.length} left</Badge>}
          />
          <div className="p-5">
            <BackupCodesForm siteName={s.siteName} username={user.username} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Recovery phrase" description="Used to reset your password if you forget it." />
          <div className="p-5">
            <PhraseForm siteName={s.siteName} username={user.username} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Authenticator app" description="Moving to a new phone? Reset and scan a new QR code." action={<Badge tone="green">Enabled</Badge>} />
          <div className="p-5">
            <ResetAuthenticatorForm />
          </div>
        </Card>

        <Card>
          <CardHeader title="Active sessions" description="Devices currently signed in to your account." />
          <ul className="divide-y divide-border">
            {active.map((sess) => (
              <li key={sess.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{sess.userAgent || "Unknown device"}</p>
                  <p className="text-xs text-muted">
                    {sess.ip} · signed in {timeAgo(sess.createdAt)}
                  </p>
                </div>
                {sess.id === current?.sessionId ? (
                  <Badge tone="accent">This device</Badge>
                ) : (
                  <form action={revokeSessionAction}>
                    <input type="hidden" name="id" value={sess.id} />
                    <button className="text-xs text-red-600 hover:underline">Sign out</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
