import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted">The page you're looking for doesn't exist or you don't have access.</p>
        <LinkButton href="/" className="mt-6">
          Go home
        </LinkButton>
      </div>
    </main>
  );
}
