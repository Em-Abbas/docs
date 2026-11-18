import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Clock, Download, Handshake, PiggyBank, Wallet } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Stat,
  StatusBadge,
  Table,
  Textarea,
  cn,
  inputClass,
  td,
  th,
} from "@/components/ui";
import { applyResellerAction, requestPayoutAction, resellerUploadAction, setPayoutWalletAction } from "@/lib/actions/reseller";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { payouts, products, resellerEarnings, uploadBatches, users } from "@/lib/db/schema";
import { centsToInput, formatDate, formatMoney } from "@/lib/format";
import { releaseMaturedEarnings } from "@/lib/reseller";
import { getSettings } from "@/lib/settings";

export const metadata = { title: "Reseller" };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "stock", label: "Supply stock" },
  { id: "payouts", label: "Payouts" },
] as const;

export default async function ResellerPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  let user = await requireUser();
  const s = await getSettings();
  const sp = await searchParams;

  if (user.resellerStatus !== "approved") {
    return (
      <>
        <PageHeader title="Reseller program" description="Supply stock to the marketplace and earn on every sale." />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card className="p-6">
            <Handshake className="size-6 text-accent" />
            <h2 className="mt-3 text-lg font-semibold tracking-tight">How it works</h2>
            <ol className="mt-4 space-y-3 text-sm text-muted">
              <li>
                <b className="text-fg">1. Apply.</b> Tell us what you can supply. We review every application.
              </li>
              <li>
                <b className="text-fg">2. Upload stock.</b> Download a product's CSV template, fill it in and upload. We check it before it goes live.
              </li>
              <li>
                <b className="text-fg">3. Earn.</b> You keep {100 - s.resellerFeePercent}% of each sale. Earnings unlock after {s.resellerHoldDays} days (or the
                refund window).
              </li>
              <li>
                <b className="text-fg">4. Get paid.</b> Request a crypto payout to your wallet any time above {formatMoney(s.payoutMin)}.
              </li>
            </ol>
          </Card>
          <Card className="h-fit p-6">
            {user.resellerStatus === "pending" ? (
              <>
                <Clock className="size-5 text-amber-600" />
                <p className="mt-2 font-medium">Application under review</p>
                <p className="mt-1 text-sm text-muted">We'll notify you as soon as it's reviewed.</p>
              </>
            ) : !s.resellerProgramEnabled ? (
              <Alert>The program isn't accepting applications right now.</Alert>
            ) : (
              <>
                {user.resellerStatus === "rejected" && (
                  <Alert tone="warn" className="mb-4">
                    Your previous application was declined{user.resellerNote ? `: ${user.resellerNote}` : "."} You can apply again.
                  </Alert>
                )}
                <ActionForm action={applyResellerAction} className="space-y-3">
                  <Field label="What would you supply?" hint="Product types, volumes, how you source them.">
                    <Textarea name="application" rows={5} required minLength={20} />
                  </Field>
                  <SubmitButton className="w-full">Apply</SubmitButton>
                </ActionForm>
              </>
            )}
          </Card>
        </div>
      </>
    );
  }

  await releaseMaturedEarnings(user.id);
  [user] = await db.select().from(users).where(eq(users.id, user.id));
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab : "overview";

  return (
    <>
      <PageHeader title="Reseller" description={`You earn ${100 - s.resellerFeePercent}% of every sale of your stock.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pending" value={formatMoney(user.earningsPending)} icon={<Clock className="size-4" />} hint={`Unlocks after ${s.resellerHoldDays} days`} />
        <Stat label="Available" value={formatMoney(user.earningsAvailable)} icon={<Wallet className="size-4" />} tone="accent" hint="Ready to withdraw" />
        <Stat label="Paid out" value={formatMoney(user.earningsPaid)} icon={<PiggyBank className="size-4" />} />
      </div>
      <nav className="my-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/reseller?tab=${t.id}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.id ? "border-fg font-medium" : "border-transparent text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <SalesTab userId={user.id} />}
      {tab === "stock" && <StockTab userId={user.id} />}
      {tab === "payouts" && <PayoutsTab user={user} payoutMin={s.payoutMin} />}
    </>
  );
}

async function SalesTab({ userId }: { userId: number }) {
  const rows = await db.select().from(resellerEarnings).where(eq(resellerEarnings.resellerId, userId)).orderBy(desc(resellerEarnings.createdAt)).limit(100);
  if (!rows.length) return <EmptyState title="No sales yet" description="Once your stock sells, each sale appears here." action={<LinkButton href="/reseller?tab=stock">Supply stock</LinkButton>} />;
  return (
    <Card>
      <CardHeader title="Sales" />
      <Table>
        <thead>
          <tr>
            <th className={th}>Product</th>
            <th className={th}>Sale</th>
            <th className={th}>Fee</th>
            <th className={th}>You earn</th>
            <th className={th}>Status</th>
            <th className={th}>Unlocks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className={td}>{e.productName}</td>
              <td className={`${td} tabular`}>{formatMoney(e.gross)}</td>
              <td className={`${td} tabular text-muted`}>−{formatMoney(e.fee)}</td>
              <td className={`${td} font-medium tabular`}>{formatMoney(e.net)}</td>
              <td className={td}>
                <StatusBadge status={e.status} />
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{e.status === "pending" ? formatDate(e.releaseAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function StockTab({ userId }: { userId: number }) {
  const [open, batches] = await Promise.all([
    db.select().from(products).where(and(eq(products.resellerEnabled, true), eq(products.status, "active"))).orderBy(products.name),
    db
      .select({ b: uploadBatches, product: products.name })
      .from(uploadBatches)
      .innerJoin(products, eq(products.id, uploadBatches.productId))
      .where(eq(uploadBatches.uploaderId, userId))
      .orderBy(desc(uploadBatches.createdAt))
      .limit(50),
  ]);
  return (
    <div className="space-y-6">
      {open.length === 0 ? (
        <EmptyState title="No products are accepting stock" description="Check back later." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="1. Get a template" description="Each product has its own columns. Fill one row per item." />
            <ul className="divide-y divide-border">
              {open.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">Sells at {formatMoney(p.price)}</span>
                  </span>
                  <a href={`/admin/products/${p.id}/template`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    <Download className="size-3.5" /> CSV template
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="2. Upload" description="Uploads are reviewed before going live. Duplicates are skipped." />
            <ActionForm action={resellerUploadAction} resetOnSuccess className="space-y-3 p-5">
              <Field label="Product">
                <Select name="productId" required>
                  {open.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <input name="file" type="file" accept=".csv,text/csv" required className={cn(inputClass, "w-full py-2")} />
              <SubmitButton pendingText="Uploading…">Submit for review</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader title="Your uploads" />
        <Table>
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>File</th>
              <th className={th}>Submitted</th>
              <th className={th}>Rejected</th>
              <th className={th}>Status</th>
              <th className={th}>Date</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(({ b, product }) => (
              <tr key={b.id}>
                <td className={td}>{product}</td>
                <td className={`${td} text-muted`}>{b.filename}</td>
                <td className={`${td} tabular`}>{b.totalRows - b.rejectedRows}</td>
                <td className={`${td} tabular text-muted`}>{b.rejectedRows}</td>
                <td className={td}>
                  <StatusBadge status={b.status} />
                  {b.reviewNote && <p className="mt-1 text-xs text-muted">{b.reviewNote}</p>}
                </td>
                <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(b.createdAt)}</td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td className={`${td} text-center text-muted`} colSpan={6}>
                  No uploads yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

async function PayoutsTab({ user, payoutMin }: { user: typeof users.$inferSelect; payoutMin: number }) {
  const history = await db.select().from(payouts).where(eq(payouts.resellerId, user.id)).orderBy(desc(payouts.createdAt)).limit(50);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payout wallet" description="Where we send your earnings. Changing it requires your authenticator code." />
          <ActionForm action={setPayoutWalletAction} className="space-y-3 p-5">
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label="Network">
                <Select name="network" defaultValue={user.payoutNetwork ?? "TRC20"}>
                  {["TRC20", "ERC20", "BEP20", "POLYGON", "SOL", "BTC"].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Address">
                <Input name="address" defaultValue={user.payoutAddress ?? ""} required className="font-mono" />
              </Field>
            </div>
            <div className="flex items-end gap-3">
              <Field label="Authenticator code" className="w-36">
                <Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
              </Field>
              <SubmitButton variant="secondary">Save wallet</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardHeader title="Request a payout" description={`Minimum ${formatMoney(payoutMin)}. Sent manually after review.`} />
          <ActionForm action={requestPayoutAction} className="space-y-3 p-5">
            {!user.payoutAddress && <Alert tone="warn">Set a payout wallet first.</Alert>}
            <Field label="Amount (USD)" hint={`Available: ${formatMoney(user.earningsAvailable)}`}>
              <Input name="amount" inputMode="decimal" defaultValue={centsToInput(user.earningsAvailable)} required className="w-40" />
            </Field>
            <SubmitButton>Request payout</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <Card>
        <CardHeader title="Payout history" />
        <Table>
          <thead>
            <tr>
              <th className={th}>Amount</th>
              <th className={th}>To</th>
              <th className={th}>Status</th>
              <th className={th}>TX</th>
              <th className={th}>Requested</th>
            </tr>
          </thead>
          <tbody>
            {history.map((p) => (
              <tr key={p.id}>
                <td className={`${td} font-medium tabular`}>{formatMoney(p.amount)}</td>
                <td className={`${td} max-w-48 truncate font-mono text-xs text-muted`}>
                  {p.network} · {p.address}
                </td>
                <td className={td}>
                  <StatusBadge status={p.status} />
                  {p.adminNote && <p className="mt-1 text-xs text-muted">{p.adminNote}</p>}
                </td>
                <td className={`${td} max-w-40 truncate font-mono text-xs text-muted`}>{p.txHash ?? "—"}</td>
                <td className={`${td} whitespace-nowrap text-muted`}>{formatDate(p.createdAt)}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td className={`${td} text-center text-muted`} colSpan={5}>
                  No payouts yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
