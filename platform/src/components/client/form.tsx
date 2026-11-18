"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";
import { Alert, buttonClass, cn, type ButtonVariant } from "@/components/ui";

type Ctx = { pending: boolean; state: ActionState };
const FormCtx = createContext<Ctx>({ pending: false, state: {} });

/**
 * Form bound to a Server Action. Shows errors/success, keeps inputs on error
 * (unlike a bare `<form action>`, which React resets after every submit).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  hideMessages,
  onSuccess,
}: {
  action: (prev: ActionState, data: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideMessages?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, run, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <FormCtx.Provider value={{ pending, state }}>
      <form
        ref={ref}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => run(data));
        }}
      >
        {!hideMessages && <FormMessage />}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function useFormCtx() {
  return useContext(FormCtx);
}

export function FormMessage({ className }: { className?: string }) {
  const { state } = useContext(FormCtx);
  if (state.error)
    return (
      <Alert tone="error" className={cn("mb-4", className)}>
        {state.error}
      </Alert>
    );
  if (state.ok && state.message)
    return (
      <Alert tone="success" className={cn("mb-4", className)}>
        {state.message}
      </Alert>
    );
  return null;
}

export function FieldError({ name }: { name: string }) {
  const { state } = useContext(FormCtx);
  const msg = state.fieldErrors?.[name];
  return msg ? <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{msg}</p> : null;
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  confirm: confirmText,
  pendingText,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
  pendingText?: string;
}) {
  const { pending } = useContext(FormCtx);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {pending && (
        <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
