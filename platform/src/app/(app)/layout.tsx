import { and, count, eq, isNull } from "drizzle-orm";
import { Bell, Handshake, LayoutGrid, Package, Settings, Shield, Store, Wallet } from "lucide-react";
import { Shell, type NavGroup } from "@/components/shell";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const s = await getSettings();
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  const groups: NavGroup[] = [
    {
      items: [
        { href: "/overview", label: "Overview", icon: <LayoutGrid /> },
        { href: "/shop", label: "Shop", icon: <Store /> },
        { href: "/orders", label: "Orders", icon: <Package /> },
        { href: "/wallet", label: "Wallet", icon: <Wallet /> },
        ...(s.resellerProgramEnabled || user.resellerStatus === "approved"
          ? [{ href: "/reseller", label: "Reseller", icon: <Handshake /> }]
          : []),
      ],
    },
    {
      title: "Account",
      items: [
        { href: "/notifications", label: "Notifications", icon: <Bell />, badge: n },
        { href: "/settings", label: "Security", icon: <Settings /> },
        ...(user.role === "admin" ? [{ href: "/admin", label: "Admin panel", icon: <Shield /> }] : []),
      ],
    },
  ];

  return (
    <Shell siteName={s.siteName} groups={groups} user={user} unread={n} home="/overview" announcement={s.announcement || undefined}>
      {children}
    </Shell>
  );
}
