import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Alert, Card, Field, Input } from "@/components/ui";
import { loginAction } from "@/lib/actions/auth";
import { getSession } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await getSession()) redirect("/overview");
  const sp = await searchParams;
  const s = await getSettings();
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Log in to your account.</p>
      {sp.setup === "done" && (
        <Alert tone="success" className="mt-5">
          Your account is secured. Log in to get started.
        </Alert>
      )}
      {sp.reset === "1" && (
        <Alert tone="success" className="mt-5">
          Password changed. Log in with your new password.
        </Alert>
      )}
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <Field label="Username">
          <Input name="username" autoComplete="username" autoFocus required />
        </Field>
        <Field
          label={
            <span className="flex justify-between">
              Password
              <Link href="/recover" className="text-xs font-normal text-muted hover:text-fg">
                Forgot password?
              </Link>
            </span>
          }
        >
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" size="lg">
          Continue
        </SubmitButton>
      </ActionForm>
      {s.signupEnabled && (
        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-fg hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </Card>
  );
}
