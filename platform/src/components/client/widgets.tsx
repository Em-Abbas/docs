"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass, cn, type ButtonVariant } from "@/components/ui";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm", className)}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function DownloadTextButton({
  content,
  filename,
  children,
  variant = "secondary",
  onDownloaded,
}: {
  content: string;
  filename: string;
  children: ReactNode;
  variant?: ButtonVariant;
  onDownloaded?: () => void;
}) {
  return (
    <button
      type="button"
      className={buttonClass(variant, "md")}
      onClick={() => {
        const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        onDownloaded?.();
      }}
    >
      {children}
    </button>
  );
}

/** Live mm:ss countdown. Refreshes the page once when it reaches zero. */
export function Countdown({ to, className }: { to: string; className?: string }) {
  const target = new Date(to).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, target - Date.now());
      setLeft(ms);
      if (ms === 0 && !fired.current) {
        fired.current = true;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [target, router]);

  const total = Math.ceil(left / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (
    <span className={cn("tabular font-mono", total < 120 && "text-red-600 dark:text-red-400", className)} suppressHydrationWarning>
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
}

export function NavLink({
  href,
  children,
  exact,
  badge,
  onNavigate,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        active ? "bg-subtle font-medium text-fg" : "text-muted hover:bg-subtle hover:text-fg",
      )}
    >
      {children}
      {!!badge && (
        <span className="ml-auto rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-accent-fg tabular">{badge}</span>
      )}
    </Link>
  );
}

/** Mobile drawer: closes itself when a link inside is clicked. */
export function MobileMenu({ children, trigger }: { children: ReactNode; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button type="button" aria-label="Open menu" className={buttonClass("ghost", "sm", "px-2")} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-border bg-surface p-4">{children}</div>
        </div>
      )}
    </>
  );
}

/** Product item picker: live running total for selected rows. */
export function SelectionSummary({ formId, currency }: { formId: string; currency: string }) {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const update = () => {
      const boxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="item"]:checked'));
      setCount(boxes.length);
      setTotal(boxes.reduce((sum, b) => sum + Number(b.dataset.price ?? 0), 0));
    };
    form.addEventListener("change", update);
    update();
    return () => form.removeEventListener("change", update);
  }, [formId]);
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency });
  return (
    <span className="text-sm text-muted">
      <span className="font-medium text-fg tabular">{count}</span> selected · est.{" "}
      <span className="font-medium text-fg tabular">{fmt.format(total / 100)}</span>
    </span>
  );
}

export function SelectAll({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="size-4 accent-[var(--accent)]"
      onChange={(e) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="item"]').forEach((b) => (b.checked = e.target.checked));
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

/** Auto-submit a GET form when a select/checkbox changes (filters). */
export function AutoSubmit({ children, className, action }: { children: ReactNode; className?: string; action: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const submit = () => {
    if (!ref.current) return;
    const params = new URLSearchParams();
    new FormData(ref.current).forEach((v, k) => {
      if (String(v) !== "") params.append(k, String(v));
    });
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action);
  };
  return (
    <form
      ref={ref}
      className={className}
      onChange={(e) => {
        const el = e.target as unknown as HTMLInputElement;
        if (el.tagName !== "INPUT" || (el.type !== "text" && el.type !== "search" && el.type !== "number")) submit();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {children}
    </form>
  );
}
