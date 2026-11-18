"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ActionForm, FieldError, SubmitButton } from "@/components/client/form";
import { CopyButton, DownloadTextButton } from "@/components/client/widgets";
import { Field, Input, Textarea, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { changePhraseAction, regenerateBackupCodesAction, resetAuthenticatorAction } from "@/lib/actions/auth";

export function BackupCodesForm({ siteName, username }: { siteName: string; username: string }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <>
      <ActionForm action={regenerateBackupCodesAction} resetOnSuccess onSuccess={(s: ActionState) => setCodes(s.data?.codes as string[])} className="flex flex-wrap items-end gap-3">
        <Field label="Authenticator code" className="w-40">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
        </Field>
        <SubmitButton variant="secondary" confirm="Generate new codes? Your current backup codes will stop working.">
          Generate new codes
        </SubmitButton>
      </ActionForm>
      {codes && (
        <div className="mt-4">
          <ul className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-subtle p-4 font-mono text-sm sm:grid-cols-5">
            {codes.map((c) => (
              <li key={c} className="text-center">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <DownloadTextButton
              content={`${siteName} — backup codes for ${username}\nGenerated ${new Date().toUTCString()}\n\n${codes.join("\n")}\n`}
              filename={`${siteName.toLowerCase()}-backup-codes.txt`}
            >
              <Download className="size-4" /> Download .txt
            </DownloadTextButton>
            <CopyButton value={codes.join("\n")} label="Copy all" className="h-10 px-4 text-sm" />
          </div>
        </div>
      )}
    </>
  );
}

export function PhraseForm({ siteName, username }: { siteName: string; username: string }) {
  const [mode, setMode] = useState<"generate" | "own">("generate");
  const [phrase, setPhrase] = useState<string | null>(null);
  return (
    <>
      <ActionForm
        action={changePhraseAction}
        resetOnSuccess
        onSuccess={(s: ActionState) => setPhrase((s.data?.phrase as string) ?? null)}
        className="space-y-4"
      >
        <input type="hidden" name="mode" value={mode} />
        <div className="inline-flex rounded-lg bg-subtle p-1 text-sm">
          {(["generate", "own"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn("rounded-md px-3 py-1", mode === m ? "bg-surface font-medium shadow-sm" : "text-muted")}
            >
              {m === "generate" ? "Generate for me" : "Create my own"}
            </button>
          ))}
        </div>
        {mode === "own" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New phrase" hint="4+ words, 20+ characters">
              <Textarea name="phrase" rows={2} className="font-mono" autoComplete="off" />
              <FieldError name="phrase" />
            </Field>
            <Field label="Re-enter phrase">
              <Textarea name="confirm" rows={2} className="font-mono" autoComplete="off" />
              <FieldError name="confirm" />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Current password" className="w-64">
            <Input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton variant="secondary">{mode === "generate" ? "Generate new phrase" : "Save phrase"}</SubmitButton>
        </div>
      </ActionForm>
      {phrase && (
        <div className="mt-4">
          <ol className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-subtle p-4 text-sm sm:grid-cols-6">
            {phrase.split(" ").map((w, i) => (
              <li key={i} className="font-mono">
                <span className="mr-1.5 text-muted">{i + 1}</span>
                {w}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <DownloadTextButton
              content={`${siteName} — recovery phrase for ${username}\nGenerated ${new Date().toUTCString()}\n\n${phrase}\n`}
              filename={`${siteName.toLowerCase()}-recovery-phrase.txt`}
            >
              <Download className="size-4" /> Download .txt
            </DownloadTextButton>
            <CopyButton value={phrase} label="Copy" className="h-10 px-4 text-sm" />
          </div>
        </div>
      )}
    </>
  );
}

export function ResetAuthenticatorForm() {
  return (
    <ActionForm action={resetAuthenticatorAction} className="flex flex-wrap items-end gap-3">
      <Field label="Current password" className="w-56">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Authenticator code" className="w-36">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
      </Field>
      <SubmitButton variant="danger" confirm="You'll be signed out and asked to scan a new QR code. Continue?">
        Reset authenticator
      </SubmitButton>
    </ActionForm>
  );
}
