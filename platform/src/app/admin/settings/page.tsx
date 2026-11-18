import { ActionForm, SubmitButton } from "@/components/client/form";
import { Card, CardHeader, Checkbox, Field, Input, PageHeader } from "@/components/ui";
import { saveSettingsAction } from "@/lib/actions/admin";
import { centsToInput } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Settings" />
      <ActionForm action={saveSettingsAction} className="space-y-6">
        <Card>
          <CardHeader title="General" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Site name">
              <Input name="siteName" defaultValue={s.siteName} required />
            </Field>
            <Field label="Admin notification email" hint="Receives new deposit receipts, refund requests and payout requests.">
              <Input name="adminEmail" type="email" defaultValue={s.adminEmail} placeholder="ops@yourdomain.com" />
            </Field>
            <Field label="Announcement banner" hint="Shown at the top of every user page. Leave empty to hide." className="sm:col-span-2">
              <Input name="announcement" defaultValue={s.announcement} maxLength={300} />
            </Field>
            <Checkbox name="signupEnabled" label="Allow new sign-ups" defaultChecked={s.signupEnabled} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Deposits" />
          <div className="grid gap-4 p-5 sm:grid-cols-4">
            <Field label="Minimum deposit (USD)">
              <Input name="depositMin" inputMode="decimal" defaultValue={centsToInput(s.depositMin)} />
            </Field>
            <Field label="Payment window (min)" hint="Countdown shown to users">
              <Input name="depositExpiryMinutes" type="number" min={5} defaultValue={s.depositExpiryMinutes} />
            </Field>
            <Field label="Late receipt grace (min)" hint="Receipts accepted after the timer">
              <Input name="depositGraceMinutes" type="number" min={0} defaultValue={s.depositGraceMinutes} />
            </Field>
            <Field label="Max open deposits per user">
              <Input name="maxOpenDeposits" type="number" min={1} defaultValue={s.maxOpenDeposits} />
            </Field>
            <div className="sm:col-span-4">
              <Checkbox
                name="depositUniqueCents"
                label="Add unique cents to each deposit"
                hint="e.g. 100.00 becomes 100.37 so every incoming transfer matches exactly one request."
                defaultChecked={s.depositUniqueCents}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reseller program" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Platform fee (%)" hint="Kept from each reseller sale">
              <Input name="resellerFeePercent" type="number" min={0} max={100} defaultValue={s.resellerFeePercent} />
            </Field>
            <Field label="Earnings hold (days)" hint="Or the product's refund window, if longer">
              <Input name="resellerHoldDays" type="number" min={0} defaultValue={s.resellerHoldDays} />
            </Field>
            <Field label="Minimum payout (USD)">
              <Input name="payoutMin" inputMode="decimal" defaultValue={centsToInput(s.payoutMin)} />
            </Field>
            <div className="sm:col-span-3">
              <Checkbox name="resellerProgramEnabled" label="Accept new reseller applications" defaultChecked={s.resellerProgramEnabled} />
            </div>
          </div>
        </Card>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
