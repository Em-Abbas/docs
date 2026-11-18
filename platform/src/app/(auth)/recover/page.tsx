import Link from "next/link";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { Card, Field, Input, Textarea } from "@/components/ui";
import { recoverAction } from "@/lib/actions/auth";

export const metadata = { title: "Reset password" };

export default function RecoverPage() {
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">Use the recovery phrase you saved when you created your account.</p>
      <ActionForm action={recoverAction} className="mt-6 space-y-4">
        <Field label="Username">
          <Input name="username" autoComplete="username" required />
        </Field>
        <Field label="Recovery phrase" hint="Words separated by spaces. Capitalization doesn't matter.">
          <Textarea name="phrase" rows={3} autoComplete="off" spellCheck={false} required className="font-mono" />
          <FieldError name="phrase" />
        </Field>
        <Field label="New password">
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          <FieldError name="password" />
        </Field>
        <Field label="Re-enter new password">
          <Input name="confirm" type="password" autoComplete="new-password" required />
          <FieldError name="confirm" />
        </Field>
        <SubmitButton className="w-full" size="lg">
          Reset password
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="hover:text-fg">
          ← Back to log in
        </Link>
      </p>
    </Card>
  );
}
