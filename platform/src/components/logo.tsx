export function Logo({ name, className }: { name: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <span className="grid size-7 place-items-center rounded-lg bg-fg text-bg">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7L4 7Z" />
          <path d="M9 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      </span>
      {name}
    </span>
  );
}
