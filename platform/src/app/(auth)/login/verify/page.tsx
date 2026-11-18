import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Card, Field, Input } from "@/components/ui";
import { verifyLoginAction } from "@/lib/actions/auth";
import { getPreAuth } from "@/lib/auth/session";

export const metadata = { title: "Two-factor verification" };

export default async function VerifyPage() {
  if (!(await getPreAuth("mfa"))) redirect("/login");
  return (
    <Card className="p-6 sm:p-8">
      <div className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
        <ShieldCheck className="size-5" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Two-factor verification</h1>
      <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={verifyLoginAction} className="mt-6 space-y-4">
        <Field label="Authentication code" hint="Lost your phone? Enter one of your backup codes instead.">
          <Input
            name="code"
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
            required
            className="h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <SubmitButton className="w-full" size="lg">
          Verify and log in
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="hover:text-fg">
          ← Use a different account
        </Link>
      </p>
    </Card>
  );
}
