import { Paperclip } from "lucide-react";
import { cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

type Msg = { id: number; fromAdmin: boolean; body: string; attachmentPath: string | null; createdAt: Date };

export function DepositThread({ messages, viewer }: { messages: Msg[]; viewer: "user" | "admin" }) {
  if (!messages.length) return null;
  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const mine = viewer === "admin" ? m.fromAdmin : !m.fromAdmin;
        return (
          <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-xl px-4 py-2.5 text-sm", mine ? "bg-fg text-bg" : "bg-subtle")}>
              <p className="mb-0.5 text-[11px] opacity-60">
                {m.fromAdmin ? "Support" : "User"} · {formatDate(m.createdAt)}
              </p>
              <p className="whitespace-pre-line">{m.body}</p>
              {m.attachmentPath && (
                <a href={fileUrl(m.attachmentPath)!} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs underline">
                  <Paperclip className="size-3" /> Attachment
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
