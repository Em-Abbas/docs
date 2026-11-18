import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Card, CardHeader, EmptyState, Input, PageHeader, StatusBadge, Table, cn, td, th } from "@/components/ui";
import { processPayoutAction, reviewApplicationAction, reviewBatchAction } from "@/lib/actions/reseller";
import { db } from "@/lib/db";
import { inventoryItems, payouts, productFields, products, uploadBatches, users } from "@/lib/db/schema";
import { formatDate, formatMoney } from "@/lib/format";
import { releaseMaturedEarnings } from "@/lib/reseller";

export const metadata = { title: "Resellers" };

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "stock", label: "Stock reviews" },
  { id: "payouts", label: "Payouts" },
  { id: "resellers", label: "Resellers" },
] as const;

export default async function AdminResellersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "applications";
  return (
    <>
      <PageHeader title="Resellers" description="Approve suppliers, review their stock before it goes live, and send payouts." />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/admin/resellers?tab=${t.id}`}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-fg font-medium" : "border-transparent text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "applications" && <Applications />}
      {tab === "stock" && <StockReviews />}
      {tab === "payouts" && <Payouts />}
      {tab === "resellers" && <ResellerList />}
    </>
  );
}

async function Applications() {
  const rows = await db.select().from(users).where(eq(users.resellerStatus, "pending")).orderBy(asc(users.createdAt));
  if (!rows.length) return <EmptyState title="No pending applications" />;
  return (
    <div className="space-y-3">
      {rows.map((u) => (
        <Card key={u.id} className="p-5">
          <p className="font-medium">
            {u.username} <span className="text-xs font-normal text-muted">· member since {formatDate(u.createdAt, false)} · spent {formatMoney(u.totalSpent)}</span>
          </p>
          <p className="mt-2 whitespace-pre-line text-sm">{u.resellerApplication}</p>
          <ActionForm action={reviewApplicationAction} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={u.id} />
            <Input name="note" placeholder="Note to applicant (optional)" className="h-9 min-w-56 flex-1" />
            <SubmitButton name="decision" value="approve" size="sm">
              Approve
            </SubmitButton>
            <SubmitButton name="decision" value="reject" size="sm" variant="secondary">
              Decline
            </SubmitButton>
          </ActionForm>
        </Card>
      ))}
    </div>
  );
}

async function StockReviews() {
  const batches = await db
    .select({ b: uploadBatches, product: products, username: users.username })
    .from(uploadBatches)
    .innerJoin(products, eq(products.id, uploadBatches.productId))
    .innerJoin(users, eq(users.id, uploadBatches.uploaderId))
    .where(eq(uploadBatches.status, "pending_review"))
    .orderBy(asc(uploadBatches.createdAt));
  if (!batches.length) return <EmptyState title="No stock waiting for review" />;

  const productIds = [...new Set(batches.map((b) => b.product.id))];
  const fields = await db.select().from(productFields).where(inArray(productFields.productId, productIds)).orderBy(asc(productFields.key));
  const samples = await Promise.all(
    batches.map((b) => db.select().from(inventoryItems).where(eq(inventoryItems.batchId, b.b.id)).orderBy(asc(inventoryItems.id)).limit(8)),
  );

  return (
    <div className="space-y-4">
      {batches.map(({ b, product, username }, i) => {
        const cols = fields.filter((f) => f.productId === product.id && f.enabled);
        return (
          <Card key={b.id}>
            <CardHeader
              title={`${username} → ${product.name}`}
              description={`${b.acceptedRows} items · ${b.filename} · ${formatDate(b.createdAt)}${b.rejectedRows ? ` · ${b.rejectedRows} rows rejected at upload` : ""}`}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    {cols.map((f) => (
                      <th key={f.key} className="whitespace-nowrap px-4 py-2 font-medium">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {samples[i].map((it) => (
                    <tr key={it.id} className="border-b border-border">
                      {cols.map((f) => (
                        <td key={f.key} className="max-w-48 truncate px-4 py-2 font-mono">
                          {it.data[f.key] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 pt-3 text-xs text-muted">
              Showing {samples[i].length} of {b.acceptedRows}.{" "}
              <Link href={`/admin/products/${product.id}?tab=inventory&status=pending_review`} className="text-accent hover:underline">
                See all pending items
              </Link>
            </p>
            <ActionForm action={reviewBatchAction} className="flex flex-wrap gap-2 p-5">
              <input type="hidden" name="id" value={b.id} />
              <Input name="note" placeholder="Note to reseller (optional)" className="h-9 min-w-56 flex-1" />
              <SubmitButton name="decision" value="approve" size="sm">
                Approve — go live
              </SubmitButton>
              <SubmitButton name="decision" value="reject" size="sm" variant="secondary">
                Reject
              </SubmitButton>
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}

async function Payouts() {
  const rows = await db
    .select({ p: payouts, username: users.username })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.resellerId))
    .orderBy(desc(payouts.status), desc(payouts.createdAt))
    .limit(100);
  const pending = rows.filter((r) => r.p.status === "pending");
  const done = rows.filter((r) => r.p.status !== "pending");
  return (
    <div className="space-y-6">
      {pending.length === 0 ? (
        <EmptyState title="No payouts waiting" />
      ) : (
        pending.map(({ p, username }) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm">
                  <span className="font-medium">{username}</span> <span className="text-muted">· requested {formatDate(p.createdAt)}</span>
                </p>
                <p className="mt-2 text-xs text-muted">Send to ({p.network})</p>
                <code className="break-all font-mono text-sm">{p.address}</code>
              </div>
              <p className="text-2xl font-semibold tabular">{formatMoney(p.amount)}</p>
            </div>
            <ActionForm action={processPayoutAction} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={p.id} />
              <Input name="txHash" placeholder="Payout transaction hash" className="h-9 min-w-56 flex-1 font-mono" />
              <Input name="note" placeholder="Note (optional)" className="h-9 w-48" />
              <SubmitButton name="decision" value="paid" size="sm">
                Mark as paid
              </SubmitButton>
              <SubmitButton name="decision" value="reject" size="sm" variant="secondary">
                Reject & return
              </SubmitButton>
            </ActionForm>
          </Card>
        ))
      )}
      {done.length > 0 && (
        <Card>
          <CardHeader title="History" />
          <Table>
            <thead>
              <tr>
                <th className={th}>Reseller</th>
                <th className={th}>Amount</th>
                <th className={th}>Status</th>
                <th className={th}>TX</th>
                <th className={th}>Processed</th>
              </tr>
            </thead>
            <tbody>
              {done.map(({ p, username }) => (
                <tr key={p.id}>
                  <td className={td}>{username}</td>
                  <td className={`${td} tabular`}>{formatMoney(p.amount)}</td>
                  <td className={td}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td className={`${td} max-w-48 truncate font-mono text-xs text-muted`}>{p.txHash ?? p.adminNote ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(p.processedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

async function ResellerList() {
  await releaseMaturedEarnings();
  const rows = await db.select().from(users).where(eq(users.resellerStatus, "approved")).orderBy(desc(users.earningsPaid));
  if (!rows.length) return <EmptyState title="No resellers yet" />;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <th className={th}>Reseller</th>
            <th className={th}>Pending</th>
            <th className={th}>Available</th>
            <th className={th}>Paid out</th>
            <th className={th}>Payout wallet</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className={td}>
                <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                  {u.username}
                </Link>
              </td>
              <td className={`${td} tabular`}>{formatMoney(u.earningsPending)}</td>
              <td className={`${td} tabular`}>{formatMoney(u.earningsAvailable)}</td>
              <td className={`${td} tabular`}>{formatMoney(u.earningsPaid)}</td>
              <td className={`${td} max-w-48 truncate font-mono text-xs text-muted`}>{u.payoutAddress ? `${u.payoutNetwork} · ${u.payoutAddress}` : "—"}</td>
              <td className={td}>
                <ActionForm action={reviewApplicationAction} hideMessages>
                  <input type="hidden" name="id" value={u.id} />
                  <SubmitButton name="decision" value="revoke" size="sm" variant="ghost" confirm={`Revoke ${u.username}'s reseller access and pull their unsold stock?`}>
                    Revoke
                  </SubmitButton>
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
