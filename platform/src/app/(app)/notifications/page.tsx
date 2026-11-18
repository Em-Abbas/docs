import { desc, eq } from "drizzle-orm";
import { Button, Card, EmptyState, PageHeader, cn } from "@/components/ui";
import { markAllReadAction, openNotificationAction } from "@/lib/actions/shop";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(100);
  const unread = rows.some((n) => !n.readAt);

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          unread && (
            <form action={markAllReadAction}>
              <Button variant="secondary" size="sm">
                Mark all as read
              </Button>
            </form>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="You're all caught up" description="Updates about deposits, refunds and payouts appear here." />
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((n) => (
            <form key={n.id} action={openNotificationAction}>
              <input type="hidden" name="id" value={n.id} />
              <button className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-subtle/50">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                  {n.body && <span className="mt-0.5 block whitespace-pre-line text-sm text-muted">{n.body}</span>}
                </span>
                <span className="whitespace-nowrap text-xs text-muted">{timeAgo(n.createdAt)}</span>
              </button>
            </form>
          ))}
        </Card>
      )}
    </>
  );
}
