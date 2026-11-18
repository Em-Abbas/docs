import { asc } from "drizzle-orm";
import QRCode from "qrcode";
import { ActionForm, SubmitButton } from "@/components/client/form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { deletePaymentMethodAction, savePaymentMethodAction } from "@/lib/actions/wallet";
import { db } from "@/lib/db";
import { paymentMethods, type PaymentMethod } from "@/lib/db/schema";
import { centsToInput, formatMoney } from "@/lib/format";

export const metadata = { title: "Payment wallets" };

function MethodFields({ m }: { m?: PaymentMethod }) {
  return (
    <>
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Display name">
          <Input name="name" defaultValue={m?.name} placeholder="USDT · TRON" required />
        </Field>
        <Field label="Asset">
          <Input name="asset" defaultValue={m?.asset} placeholder="USDT" required />
        </Field>
        <Field label="Network">
          <Input name="network" defaultValue={m?.network} placeholder="TRC20" required list="networks" />
        </Field>
      </div>
      <Field label="Receiving address">
        <Input name="address" defaultValue={m?.address} required className="font-mono" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Memo / tag" hint="If the network needs one">
          <Input name="memo" defaultValue={m?.memo ?? ""} />
        </Field>
        <Field label="USD per 1 unit" hint="1 for stablecoins">
          <Input name="rate" defaultValue={m?.rate ?? "1"} inputMode="decimal" />
        </Field>
        <Field label="Decimals" hint="2 for USDT, 8 for BTC">
          <Input name="decimals" type="number" min={0} max={8} defaultValue={m?.decimals ?? 2} />
        </Field>
        <Field label="Minimum (USD)">
          <Input name="minAmount" inputMode="decimal" defaultValue={centsToInput(m?.minAmount ?? 0)} />
        </Field>
      </div>
      <Field label="Instructions shown to users">
        <Textarea name="instructions" defaultValue={m?.instructions ?? ""} rows={2} className="min-h-0" />
      </Field>
      <div className="flex flex-wrap items-center gap-6">
        <Field label="Sort order" className="w-28">
          <Input name="sortOrder" type="number" defaultValue={m?.sortOrder ?? 0} />
        </Field>
        {m && <Checkbox name="isActive" label="Active" hint="Shown on the deposit page" defaultChecked={m.isActive} />}
      </div>
    </>
  );
}

export default async function WalletsPage() {
  const methods = await db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder));
  const qrs = await Promise.all(methods.map((m) => QRCode.toString(m.address, { type: "svg", margin: 1, color: { dark: "#09090b", light: "#ffffff" } })));

  return (
    <>
      <PageHeader title="Payment wallets" description="Crypto addresses users pay into. Users see the address, network and a QR code." />
      <datalist id="networks">
        {["TRC20", "ERC20", "BEP20", "POLYGON", "SOL", "BTC"].map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="space-y-4">
        {methods.map((m, i) => (
          <Card key={m.id}>
            <details>
              <summary className="flex cursor-pointer items-center gap-4 p-5">
                <div className="size-16 shrink-0 rounded-lg border border-border bg-white p-1 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrs[i] }} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {m.name} <Badge tone="accent">{m.network}</Badge> {!m.isActive && <Badge>inactive</Badge>}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-muted">{m.address}</p>
                  {m.address.includes("REPLACE") && <p className="mt-1 text-xs text-red-600">Placeholder address — replace it before going live.</p>}
                </div>
                <span className="hidden text-xs text-muted sm:block">min {formatMoney(m.minAmount)}</span>
              </summary>
              <div className="border-t border-border p-5">
                <ActionForm action={savePaymentMethodAction} className="space-y-3">
                  <MethodFields m={m} />
                  <SubmitButton>Save wallet</SubmitButton>
                </ActionForm>
                <form action={deletePaymentMethodAction} className="mt-3">
                  <input type="hidden" name="id" value={m.id} />
                  <button className="text-xs text-red-600 hover:underline">Delete wallet</button>
                </form>
              </div>
            </details>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader title="Add a wallet" />
        <ActionForm action={savePaymentMethodAction} resetOnSuccess className="space-y-3 p-5">
          <MethodFields />
          <SubmitButton>Add wallet</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
