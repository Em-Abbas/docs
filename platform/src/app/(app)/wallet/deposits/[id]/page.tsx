import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { AlertTriangle, CheckCircle2, Clock, FileCheck2, XCircle } from "lucide-react";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { CopyButton, Countdown } from "@/components/client/widgets";
import { DepositThread } from "@/components/deposit-thread";
import { Alert, Badge, Card, CardHeader, Field, Input, LinkButton, PageHeader, StatusBadge, Textarea, cn, inputClass } from "@/components/ui";
import { cancelDepositAction, replyDepositAction, submitReceiptAction } from "@/lib/actions/wallet";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { depositMessages, deposits } from "@/lib/db/schema";
import { expireStaleDeposits, explorerUrl } from "@/lib/deposits";
import { formatDate, formatMoney } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Deposit" };

export default async function DepositPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const s = await getSettings();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  await expireStaleDeposits();
  const [d] = await db.select().from(deposits).where(and(eq(deposits.id, id), eq(deposits.userId, user.id)));
  if (!d) notFound();
  const messages = await db.select().from(depositMessages).where(eq(depositMessages.depositId, id)).orderBy(asc(depositMessages.createdAt));

  const now = Date.now();
  const windowOpen = d.status === "awaiting_payment" && now < d.expiresAt.getTime();
  const inGrace = d.status === "awaiting_payment" && !windowOpen;
  const graceEnds = new Date(d.expiresAt.getTime() + s.depositGraceMinutes * 60_000);
  const qr =
    d.status === "awaiting_payment"
      ? await QRCode.toString(d.address, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#09090b", light: "#ffffff" } })
      : "";
  const explorer = explorerUrl(d.network, d.txHash);

  return (
    <>
      <PageHeader
        back={{ href: "/wallet", label: "Wallet" }}
        title={
          <span className="flex items-center gap-3">
            Deposit #{d.id} <StatusBadge status={d.status} />
          </span>
        }
        description={`${d.methodName} · requested ${formatDate(d.createdAt)}`}
      />

      {d.status === "awaiting_payment" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="size-4 text-muted" />
                {windowOpen ? (
                  <>
                    Time left to pay <Countdown to={d.expiresAt.toISOString()} className="text-base font-semibold" />
                  </>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">Payment window closed</span>
                )}
              </div>
              <Badge tone="accent">{d.network}</Badge>
            </div>
            <div className="space-y-5 p-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Send exactly</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span className="text-3xl font-semibold tracking-tight tabular">
                    {d.payAmount} <span className="text-xl text-muted">{d.asset}</span>
                  </span>
                  <CopyButton value={d.payAmount} label="Copy amount" />
                </div>
                <p className="mt-1 text-sm text-muted">You'll be credited {formatMoney(d.amount)}.</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">To this {d.network} address</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded-lg bg-subtle px-3 py-2 font-mono text-sm">{d.address}</code>
                  <CopyButton value={d.address} label="Copy address" />
                </div>
                {d.memo && (
                  <p className="mt-2 text-sm">
                    Memo / tag: <code className="rounded bg-subtle px-1.5 py-0.5 font-mono">{d.memo}</code>
                  </p>
                )}
              </div>
              <Alert tone="warn" className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Send only <b>{d.asset}</b> on the <b>{d.network}</b> network. Sending another coin or using another network will lose your funds. Send the
                  exact amount in one transfer.
                </span>
              </Alert>
            </div>
          </Card>
          <Card className="flex flex-col items-center p-5">
            <div className="size-52 rounded-xl border border-border bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="mt-3 text-center text-xs text-muted">Scan with your wallet app to fill in the address.</p>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="2. Upload your payment receipt"
              description={
                inGrace
                  ? `Already sent the payment? Upload your receipt before ${formatDate(graceEnds)}.`
                  : "After sending, upload a screenshot of the completed transfer. Adding the transaction hash speeds up approval."
              }
            />
            <ActionForm action={submitReceiptAction} className="grid gap-4 p-5 sm:grid-cols-2">
              <input type="hidden" name="id" value={d.id} />
              <Field label="Receipt (image or PDF, max 8 MB)">
                <input name="receipt" type="file" accept="image/*,application/pdf" required className={cn(inputClass, "w-full py-1.5")} />
                <FieldError name="receipt" />
              </Field>
              <Field label="Transaction hash (optional)">
                <Input name="txHash" placeholder="0x… / tx id" className="font-mono" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <SubmitButton variant="accent" pendingText="Uploading…">
                  I've paid — submit receipt
                </SubmitButton>
              </div>
            </ActionForm>
            <form action={cancelDepositAction} className="px-5 pb-5">
              <input type="hidden" name="id" value={d.id} />
              <button className="text-xs text-muted hover:text-red-600">Cancel this deposit</button>
            </form>
          </Card>
        </div>
      )}

      {d.status !== "awaiting_payment" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <StatusPanel status={d.status} credited={d.creditedAmount} note={d.adminNote} />
            {(messages.length > 0 || d.status === "needs_info") && (
              <Card>
                <CardHeader title="Messages" />
                <div className="space-y-5 p-5">
                  <DepositThread messages={messages} viewer="user" />
                  {d.status === "needs_info" && (
                    <ActionForm action={replyDepositAction} resetOnSuccess className="space-y-3 border-t border-border pt-5">
                      <input type="hidden" name="id" value={d.id} />
                      <Textarea name="body" placeholder="Your reply…" rows={3} />
                      <div className="flex flex-wrap items-center gap-3">
                        <input name="attachment" type="file" accept="image/*,application/pdf" className={cn(inputClass, "w-auto py-1.5 text-xs")} />
                        <SubmitButton>Send reply</SubmitButton>
                      </div>
                    </ActionForm>
                  )}
                </div>
              </Card>
            )}
          </div>
          <Card className="h-fit">
            <CardHeader title="Details" />
            <dl className="space-y-3 p-5 text-sm">
              <Row label="Amount sent">
                {d.payAmount} {d.asset}
              </Row>
              <Row label="Network">{d.network}</Row>
              <Row label="To address">
                <span className="break-all font-mono text-xs">{d.address}</span>
              </Row>
              {d.txHash && (
                <Row label="Transaction">
                  {explorer ? (
                    <a href={explorer} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent hover:underline">
                      {d.txHash}
                    </a>
                  ) : (
                    <span className="break-all font-mono text-xs">{d.txHash}</span>
                  )}
                </Row>
              )}
              {d.receiptPath && (
                <Row label="Receipt">
                  <a href={fileUrl(d.receiptPath)!} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    View upload
                  </a>
                </Row>
              )}
              {d.submittedAt && <Row label="Submitted">{formatDate(d.submittedAt)}</Row>}
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function StatusPanel({ status, credited, note }: { status: string; credited: number | null; note: string | null }) {
  const map: Record<string, { icon: React.ReactNode; title: string; body: string; tone: string }> = {
    under_review: {
      icon: <FileCheck2 className="size-6" />,
      title: "We're confirming your payment",
      body: "Our team is checking the transfer on-chain. Your balance is credited as soon as it's confirmed — usually within minutes.",
      tone: "text-amber-600",
    },
    needs_info: {
      icon: <AlertTriangle className="size-6" />,
      title: "We need a bit more information",
      body: "Please read the message below and reply so we can finish reviewing your deposit.",
      tone: "text-amber-600",
    },
    approved: {
      icon: <CheckCircle2 className="size-6" />,
      title: `${formatMoney(credited ?? 0)} added to your balance`,
      body: "Your deposit was approved. Happy shopping!",
      tone: "text-emerald-600",
    },
    rejected: { icon: <XCircle className="size-6" />, title: "Deposit rejected", body: note ?? "", tone: "text-red-600" },
    expired: {
      icon: <Clock className="size-6" />,
      title: "This deposit expired",
      body: "No receipt was submitted in time. If you sent a payment, contact support with the transaction details.",
      tone: "text-muted",
    },
    cancelled: { icon: <XCircle className="size-6" />, title: "Deposit cancelled", body: "", tone: "text-muted" },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <Card className="p-6">
      <div className={m.tone}>{m.icon}</div>
      <h2 className="mt-3 text-lg font-semibold tracking-tight">{m.title}</h2>
      {m.body && <p className="mt-1 text-sm text-muted">{m.body}</p>}
      {status === "approved" && note && <p className="mt-2 text-sm text-muted">Note: {note}</p>}
      {(status === "expired" || status === "cancelled" || status === "rejected") && (
        <LinkButton href="/wallet" className="mt-4" variant="secondary">
          Start a new deposit
        </LinkButton>
      )}
    </Card>
  );
}
