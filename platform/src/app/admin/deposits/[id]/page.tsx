import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { DepositThread } from "@/components/deposit-thread";
import { Alert, Card, CardHeader, Field, Input, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { reviewDepositAction } from "@/lib/actions/wallet";
import { db } from "@/lib/db";
import { depositMessages, deposits, users } from "@/lib/db/schema";
import { explorerUrl } from "@/lib/deposits";
import { centsToInput, formatDate, formatMoney } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Review deposit" };

export default async function AdminDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [row] = await db.select({ d: deposits, user: users }).from(deposits).innerJoin(users, eq(users.id, deposits.userId)).where(eq(deposits.id, id));
  if (!row) notFound();
  const { d, user } = row;
  const [messages, [{ approvedCount }]] = await Promise.all([
    db.select().from(depositMessages).where(eq(depositMessages.depositId, id)).orderBy(asc(depositMessages.createdAt)),
    db
      .select({ approvedCount: count() })
      .from(deposits)
      .where(and(eq(deposits.userId, user.id), eq(deposits.status, "approved"))),
  ]);
  const receipt = fileUrl(d.receiptPath);
  const isPdf = d.receiptPath?.endsWith(".pdf");
  const explorer = explorerUrl(d.network, d.txHash);
  const open = !["approved", "rejected", "cancelled"].includes(d.status);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/deposits", label: "Deposits" }}
        title={
          <span className="flex items-center gap-3">
            Deposit #{d.id} <StatusBadge status={d.status} />
          </span>
        }
        description={`${user.username} · ${d.methodName} · created ${formatDate(d.createdAt)}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Payment" />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <Item label="Expected amount">
                <span className="text-lg font-semibold tabular">
                  {d.payAmount} {d.asset}
                </span>
                <span className="block text-xs text-muted">credits {formatMoney(d.amount)}</span>
              </Item>
              <Item label="Network">{d.network}</Item>
              <Item label="Your receiving address">
                <span className="break-all font-mono text-xs">{d.address}</span>
              </Item>
              <Item label="Transaction hash">
                {d.txHash ? (
                  explorer ? (
                    <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-xs text-accent hover:underline">
                      {d.txHash} <ExternalLink className="size-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="break-all font-mono text-xs">{d.txHash}</span>
                  )
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </Item>
              <Item label="Payment window ended">{formatDate(d.expiresAt)}</Item>
              <Item label="Receipt submitted">{formatDate(d.submittedAt)}</Item>
              {d.creditedAmount != null && <Item label="Credited">{formatMoney(d.creditedAmount)}</Item>}
              {d.adminNote && <Item label="Admin note">{d.adminNote}</Item>}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Receipt" action={receipt && <a href={receipt} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Open full size</a>} />
            <div className="p-5">
              {!receipt ? (
                <p className="text-sm text-muted">No receipt uploaded yet.</p>
              ) : isPdf ? (
                <iframe src={receipt} className="h-[32rem] w-full rounded-lg border border-border" title="Receipt PDF" />
              ) : (
                <img src={receipt} alt="Payment receipt" className="max-h-[36rem] rounded-lg border border-border" />
              )}
            </div>
          </Card>

          {messages.length > 0 && (
            <Card>
              <CardHeader title="Conversation" />
              <div className="p-5">
                <DepositThread messages={messages} viewer="admin" />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="User" />
            <dl className="space-y-3 p-5 text-sm">
              <Item label="Username">
                <Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">
                  {user.username}
                </Link>
              </Item>
              <Item label="Balance">{formatMoney(user.balance)}</Item>
              <Item label="Approved deposits">
                {approvedCount} · {formatMoney(user.totalDeposited)} total
              </Item>
              <Item label="Member since">{formatDate(user.createdAt, false)}</Item>
            </dl>
          </Card>

          {open ? (
            <>
              <Card>
                <CardHeader title="Approve" description="Credit the user's balance. Adjust if they sent a different amount." />
                <ActionForm action={reviewDepositAction} className="space-y-3 p-5">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <Field label="Amount to credit (USD)">
                    <Input name="credit" inputMode="decimal" defaultValue={centsToInput(d.amount)} required />
                  </Field>
                  <Input name="note" placeholder="Internal / user note (optional)" />
                  <SubmitButton className="w-full" confirm="Credit this amount to the user's balance?">
                    Approve and credit
                  </SubmitButton>
                </ActionForm>
              </Card>
              <Card>
                <CardHeader title="Ask for clarification" description="The user is notified and can reply with a message or file." />
                <ActionForm action={reviewDepositAction} resetOnSuccess className="space-y-3 p-5">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="decision" value="info" />
                  <Textarea name="note" rows={3} placeholder="e.g. The amount received was 99.50 — please send a screenshot showing the full transaction." required />
                  <SubmitButton variant="secondary" className="w-full">
                    Send request
                  </SubmitButton>
                </ActionForm>
              </Card>
              <Card>
                <CardHeader title="Reject" />
                <ActionForm action={reviewDepositAction} className="space-y-3 p-5">
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <Input name="note" placeholder="Reason shown to the user" required />
                  <SubmitButton variant="danger" className="w-full" confirm="Reject this deposit?">
                    Reject deposit
                  </SubmitButton>
                </ActionForm>
              </Card>
            </>
          ) : (
            <Alert>This deposit is closed.</Alert>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
