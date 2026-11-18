import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { Alert, Card, Field, Input } from "@/components/ui";
import { signupAction } from "@/lib/actions/auth";
import { getSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { Steps } from "./steps";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/overview");
  const s = await getSettings();
  return (
    <Card className="p-6 sm:p-8">
      <Steps current={0} />
      <h1 className="mt-6 text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted">No email needed. You'll secure it with an authenticator app next.</p>
      {!s.signupEnabled ? (
        <Alert tone="warn" className="mt-6">
          Sign-ups are closed right now.
        </Alert>
      ) : (
        <ActionForm action={signupAction} className="mt-6 space-y-4">
          <Field label="Username" hint="3–24 characters. Letters, numbers, . - _">
            <Input name="username" autoComplete="username" autoFocus required minLength={3} maxLength={24} />
            <FieldError name="username" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
            <FieldError name="password" />
          </Field>
          <Field label="Re-enter password">
            <Input name="confirm" type="password" autoComplete="new-password" required />
            <FieldError name="confirm" />
          </Field>
          <label className="flex items-start gap-3 text-sm text-muted">
            <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-[var(--accent)]" required />
            <span>I agree to the terms of service and acceptable use policy.</span>
          </label>
          <FieldError name="terms" />
          <SubmitButton className="w-full" size="lg">
            Create account
          </SubmitButton>
        </ActionForm>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-fg hover:underline">
          Log in
        </Link>
      </p>
    </Card>
  );
}
