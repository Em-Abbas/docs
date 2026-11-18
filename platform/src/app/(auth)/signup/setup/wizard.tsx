"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Download, KeyRound, Smartphone, Sparkles, PenLine } from "lucide-react";
import { CopyButton, DownloadTextButton } from "@/components/client/widgets";
import { Alert, Button, Field, Input, Textarea, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import {
  finishSetupAction,
  generatePhraseAction,
  regenerateSetupCodesAction,
  setOwnPhraseAction,
  verifySetupTotpAction,
} from "@/lib/actions/auth";
import { Steps } from "../steps";

type Props = {
  siteName: string;
  username: string;
  totpEnabled: boolean;
  hasPhrase: boolean;
  qrSvg: string;
  secret: string;
};

export function SetupWizard(props: Props) {
  const [step, setStep] = useState<"totp" | "codes" | "phrase">(props.totpEnabled ? "codes" : "totp");
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <>
      <Steps current={step === "totp" ? 1 : step === "codes" ? 2 : 3} />
      {step === "totp" && (
        <TotpStep
          {...props}
          onDone={(c) => {
            setCodes(c);
            setStep("codes");
          }}
        />
      )}
      {step === "codes" && <CodesStep {...props} codes={codes} setCodes={setCodes} onDone={() => setStep("phrase")} />}
      {step === "phrase" && <PhraseStep {...props} />}
    </>
  );
}

function ErrorText({ state }: { state: ActionState }) {
  return state.error ? <Alert tone="error">{state.error}</Alert> : null;
}

/* ----------------------------------------------------------- authenticator */

function TotpStep({ qrSvg, secret, onDone }: Props & { onDone: (codes: string[]) => void }) {
  const [state, run, pending] = useActionState(verifySetupTotpAction, {});
  useEffect(() => {
    if (state.ok) onDone(state.data?.codes as string[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 text-accent">
        <Smartphone className="size-5" />
      </div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Set up your authenticator</h1>
      <p className="mt-1 text-sm text-muted">
        Scan this QR code with Google Authenticator, Authy, 1Password or any TOTP app. You'll need a code from it every time you log in.
      </p>
      <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div
          className="size-44 shrink-0 rounded-xl border border-border bg-white p-2 [&>svg]:size-full"
          aria-label="Authenticator QR code"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
        <div className="w-full min-w-0 text-sm">
          <p className="text-muted">Can't scan? Enter this setup key manually:</p>
          <code className="mt-2 block break-all rounded-lg bg-subtle px-3 py-2 font-mono text-xs leading-relaxed">
            {secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <CopyButton value={secret} label="Copy key" className="mt-2" />
        </div>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => run(fd));
        }}
      >
        <ErrorText state={state} />
        <Field label="Enter the 6-digit code from the app">
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            placeholder="123456"
            required
            className="h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Verifying…" : "Verify and continue"}
        </Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------ backup codes */

function CodesStep({
  siteName,
  username,
  codes,
  setCodes,
  onDone,
}: Props & { codes: string[] | null; setCodes: (c: string[]) => void; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [state, run, pending] = useActionState(regenerateSetupCodesAction, {});
  useEffect(() => {
    if (state.ok) setCodes(state.data?.codes as string[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const file = codes
    ? `${siteName} — backup codes for ${username}\nGenerated ${new Date().toUTCString()}\n\nEach code works once if you lose access to your authenticator app.\n\n${codes.join("\n")}\n`
    : "";

  return (
    <div className="mt-6">
      <KeyRound className="size-5 text-accent" />
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Save your backup codes</h1>
      <p className="mt-1 text-sm text-muted">
        If you lose your phone, each of these codes lets you log in once. Store them somewhere safe and offline.
      </p>
      {!codes ? (
        <div className="mt-6 space-y-3">
          <ErrorText state={state} />
          <Alert>Your authenticator is connected. Generate a fresh set of backup codes to continue.</Alert>
          <Button onClick={() => startTransition(() => run())} disabled={pending} className="w-full" size="lg">
            {pending ? "Generating…" : "Generate backup codes"}
          </Button>
        </div>
      ) : (
        <>
          <ul className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-border bg-subtle p-4 font-mono text-sm">
            {codes.map((c) => (
              <li key={c} className="tabular text-center">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <DownloadTextButton content={file} filename={`${siteName.toLowerCase()}-backup-codes.txt`}>
              <Download className="size-4" /> Download .txt
            </DownloadTextButton>
            <CopyButton value={codes.join("\n")} label="Copy all" className="h-10 px-4 text-sm" />
          </div>
          <label className="mt-6 flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I've saved my backup codes
          </label>
          <Button size="lg" className="mt-4 w-full" disabled={!saved} onClick={onDone}>
            Continue
          </Button>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- recovery phrase */

function PhraseStep({ siteName, username, hasPhrase }: Props) {
  const [mode, setMode] = useState<"generate" | "own" | "keep">("generate");
  const [ack, setAck] = useState(false);
  const [gen, runGen, genPending] = useActionState(generatePhraseAction, {});
  const [own, runOwn, ownPending] = useActionState(setOwnPhraseAction, {});
  const [fin, runFinish, finPending] = useActionState(finishSetupAction, {});

  const phrase = gen.data?.phrase as string | undefined;
  const ready = (mode === "generate" && !!phrase && ack) || (mode === "own" && own.ok) || mode === "keep";
  const file = phrase
    ? `${siteName} — recovery phrase for ${username}\nGenerated ${new Date().toUTCString()}\n\nUse this phrase to reset your password. Anyone with it can take over your account.\n\n${phrase}\n`
    : "";

  const tabs = [
    { id: "generate" as const, label: "Generate for me", icon: Sparkles },
    { id: "own" as const, label: "Create my own", icon: PenLine },
    ...(hasPhrase ? [{ id: "keep" as const, label: "Keep current", icon: KeyRound }] : []),
  ];

  return (
    <div className="mt-6">
      <h1 className="text-xl font-semibold tracking-tight">Create a recovery phrase</h1>
      <p className="mt-1 text-sm text-muted">
        This phrase is the only way to reset your password. We can't recover it for you, so keep it private and safe.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1 text-sm sm:flex">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMode(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 transition",
              mode === t.id ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {mode === "generate" && (
        <div className="mt-5">
          <ErrorText state={gen} />
          {!phrase ? (
            <Button onClick={() => startTransition(() => runGen())} disabled={genPending} size="lg" className="w-full" variant="secondary">
              {genPending ? "Generating…" : "Generate a 12-word phrase"}
            </Button>
          ) : (
            <>
              <ol className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-subtle p-4 text-sm">
                {phrase.split(" ").map((w, i) => (
                  <li key={i} className="flex gap-2 font-mono">
                    <span className="w-5 text-right text-muted">{i + 1}</span>
                    {w}
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <DownloadTextButton content={file} filename={`${siteName.toLowerCase()}-recovery-phrase.txt`}>
                  <Download className="size-4" /> Download .txt
                </DownloadTextButton>
                <CopyButton value={phrase} label="Copy phrase" className="h-10 px-4 text-sm" />
              </div>
              <label className="mt-5 flex items-center gap-3 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I've stored my recovery phrase safely
              </label>
            </>
          )}
        </div>
      )}

      {mode === "own" && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => runOwn(fd));
          }}
        >
          {own.error && <Alert tone="error">{own.fieldErrors?.phrase ?? own.fieldErrors?.confirm ?? own.error}</Alert>}
          {own.ok && <Alert tone="success">Recovery phrase saved.</Alert>}
          <Field label="Your phrase" hint="At least 4 words and 20 characters. Case and extra spaces are ignored.">
            <Textarea name="phrase" rows={2} autoComplete="off" spellCheck={false} required className="font-mono" />
          </Field>
          <Field label="Re-enter phrase">
            <Textarea name="confirm" rows={2} autoComplete="off" spellCheck={false} required className="font-mono" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={ownPending}>
            {ownPending ? "Saving…" : "Save phrase"}
          </Button>
        </form>
      )}

      {mode === "keep" && <Alert className="mt-5">You'll keep the recovery phrase you already have.</Alert>}

      <div className="mt-6 border-t border-border pt-6">
        <ErrorText state={fin} />
        <Button size="lg" className="mt-3 w-full" disabled={!ready || finPending} onClick={() => startTransition(() => runFinish())}>
          {finPending ? "Finishing…" : "Finish setup"}
        </Button>
      </div>
    </div>
  );
}
