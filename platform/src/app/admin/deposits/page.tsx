import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Card, EmptyState, PageHeader, StatusBadge, Table, cn, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { deposits, users } from "@/lib/db/schema";
import { expireStaleDeposits } from "@/lib/deposits";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Deposits" };

const TABS = {
  review: { label: "To review", statuses: ["under_review"] },
  info: { label: "Waiting on user", statuses: ["needs_info"] },
  open: { label: "Awaiting payment", statuses: ["awaiting_payment"] },
  approved: { label: "Approved", statuses: ["approved"] },
  closed: { label: "Rejected / expired", statuses: ["rejected", "expired", "cancelled"] },
} as const;

export default async function AdminDepositsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = (sp.tab && sp.tab in TABS ? sp.tab : "review") as keyof typeof TABS;
  await expireStaleDeposits();
  const rows = await db
    .select({ d: deposits, username: users.username })
    .from(deposits)
    .innerJoin(users, eq(users.id, deposits.userId))
    .where(inArray(deposits.status, [...TABS[tab].statuses]))
    .orderBy(tab === "review" ? deposits.submittedAt : desc(deposits.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader title="Deposits" description="Check each receipt against your wallet, then approve, reject or ask for clarification." />
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(TABS).map(([k, t]) => (
          <Link
            key={k}
            href={`/admin/deposits?tab=${k}`}
            className={cn("rounded-full border px-3 py-1 text-xs", tab === k ? "border-fg bg-fg text-bg" : "border-border text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" description={tab === "review" ? "No receipts waiting for review." : undefined} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Deposit</th>
                <th className={th}>User</th>
                <th className={th}>Amount</th>
                <th className={th}>Network</th>
                <th className={th}>TX hash</th>
                <th className={th}>{tab === "review" ? "Submitted" : "Created"}</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, username }) => (
                <tr key={d.id} className="hover:bg-subtle/50">
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/admin/deposits/${d.id}`} className="font-medium hover:underline">
                      #{d.id}
                    </Link>
                  </td>
                  <td className={td}>{username}</td>
                  <td className={`${td} tabular`}>
                    <span className="font-medium">
                      {d.payAmount} {d.asset}
                    </span>
                    <span className="block text-xs text-muted">≈ {formatMoney(d.creditedAmount ?? d.amount)}</span>
                  </td>
                  <td className={td}>{d.network}</td>
                  <td className={`${td} max-w-40 truncate font-mono text-xs text-muted`}>{d.txHash ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(tab === "review" ? d.submittedAt : d.createdAt)}</td>
                  <td className={td}>
                    <StatusBadge status={d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
