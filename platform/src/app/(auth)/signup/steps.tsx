import { Check } from "lucide-react";
import { cn } from "@/components/ui";

const STEPS = ["Account", "Authenticator", "Backup codes", "Recovery phrase"];

export function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 flex-col gap-1.5">
          <span className={cn("h-1 rounded-full", i <= current ? "bg-accent" : "bg-border")} />
          <span className={cn("hidden items-center gap-1 text-[11px] sm:flex", i <= current ? "text-fg" : "text-muted")}>
            {i < current && <Check className="size-3" />}
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}
