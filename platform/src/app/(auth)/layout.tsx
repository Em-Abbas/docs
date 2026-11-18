import { Logo } from "@/components/logo";
import { getSettings } from "@/lib/settings";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="mb-8">
        <Logo name={s.siteName} className="text-lg" />
      </div>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-10 text-xs text-muted">Protected with two-factor authentication</p>
    </main>
  );
}
