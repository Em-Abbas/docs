import { and, count, eq, isNull } from "drizzle-orm";
import {
  ArrowLeft,
  Boxes,
  FolderTree,
  Gauge,
  Handshake,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { Shell, type NavGroup } from "@/components/shell";
import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deposits, notifications, payouts, refundRequests, uploadBatches, users } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

export const metadata = { title: { default: "Admin", template: "%s · Admin" } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const s = await getSettings();
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  const [refunds, depositQueue, payoutQueue, batchQueue, appQueue, unread] = await Promise.all([
    n(db.select({ n: count() }).from(refundRequests).where(eq(refundRequests.status, "pending"))),
    n(db.select({ n: count() }).from(deposits).where(eq(deposits.status, "under_review"))),
    n(db.select({ n: count() }).from(payouts).where(eq(payouts.status, "pending"))),
    n(db.select({ n: count() }).from(uploadBatches).where(eq(uploadBatches.status, "pending_review"))),
    n(db.select({ n: count() }).from(users).where(eq(users.resellerStatus, "pending"))),
    n(db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, admin.id), isNull(notifications.readAt)))),
  ]);

  const groups: NavGroup[] = [
    {
      items: [{ href: "/admin", label: "Dashboard", icon: <Gauge />, exact: true }],
    },
    {
      title: "Catalog",
      items: [
        { href: "/admin/products", label: "Products", icon: <Boxes /> },
        { href: "/admin/categories", label: "Categories", icon: <FolderTree /> },
      ],
    },
    {
      title: "Sales",
      items: [
        { href: "/admin/orders", label: "Orders", icon: <Package /> },
        { href: "/admin/refunds", label: "Refunds", icon: <Undo2 />, badge: refunds },
        { href: "/admin/deposits", label: "Deposits", icon: <ReceiptText />, badge: depositQueue },
        { href: "/admin/wallets", label: "Payment wallets", icon: <Wallet /> },
      ],
    },
    {
      title: "People",
      items: [
        { href: "/admin/users", label: "Users", icon: <Users /> },
        { href: "/admin/resellers", label: "Resellers", icon: <Handshake />, badge: payoutQueue + batchQueue + appQueue },
      ],
    },
    {
      title: "System",
      items: [
        { href: "/admin/settings", label: "Settings", icon: <Settings /> },
        { href: "/admin/audit", label: "Audit log", icon: <ScrollText /> },
        { href: "/overview", label: "Back to store", icon: <ArrowLeft /> },
      ],
    },
  ];

  return (
    <Shell siteName={`${s.siteName} Admin`} groups={groups} user={admin} unread={unread} home="/admin">
      {children}
    </Shell>
  );
}
