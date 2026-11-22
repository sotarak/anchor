import type { MfaStatusDto } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useCallback, useRef, useState } from "react";
import { RiFingerprintLine } from "react-icons/ri";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { getPasskeyAssertion, isPasskeyCancel, passkeysSupported } from "@/lib/webauthn";

/** Thrown by `run` when the user closes the "Confirm it's you" dialog. Callers stay silent. */
export class ReauthCancelled extends Error {
  override name = "ReauthCancelled";
}

export const isReauthCancel = (e: unknown): e is ReauthCancelled => e instanceof ReauthCancelled;

const needsReauth = (e: unknown) => e instanceof ApiClientError && e.code === "reauth_required";

/**
 * Step-up for MFA changes. `run(fn)` calls `fn`; when the server answers 403 reauth_required it
 * asks the user to confirm (password without MFA, a factor with it) and retries `fn` once.
 */
export function useReauth(): { run<T>(fn: () => Promise<T>): Promise<T>; dialog: ReactNode } {
  const status = useQuery({ queryKey: qk.mfa, queryFn: api.mfa.status });
  const [open, setOpen] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!needsReauth(e)) throw e;
    }
    await new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setOpen(true);
    });
    return fn();
  }, []);

  const finish = (confirmed: boolean) => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    if (confirmed) p?.resolve();
    else p?.reject(new ReauthCancelled("Cancelled"));
  };

  return {
    run,
    dialog: open ? (
      <ReauthDialog
        status={status.data}
        onConfirmed={() => finish(true)}
        onCancel={() => finish(false)}
      />
    ) : null,
  };
}

type Method = "password" | "totp" | "recovery";

const DESCRIPTIONS: Record<Method, string> = {
  password: "Enter your password to continue.",
  totp: "Enter a code from your authenticator app to continue.",
  recovery: "Enter one of your recovery codes to continue. It stops working once used.",
};

function reauthError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.code === "invalid_credentials") return e.message;
    if (e.code === "rate_limited") return "Too many failed attempts. Try again in 15 minutes.";
  }
  return errorMessage(e);
}

/**
 * Plain async calls, not useMutation: mutation variables would keep the password or code in
 * the MutationCache after the dialog closes.
 */
function ReauthDialog({
  status,
  onConfirmed,
  onCancel,
}: {
  status: MfaStatusDto | undefined;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const initial: Method = !status?.enabled ? "password" : status.totp ? "totp" : "recovery";
  const [method, setMethod] = useState<Method>(initial);
  const [value, setValue] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeyHere =
    !!status?.enabled && status.passkeys.some((p) => p.usableHere) && passkeysSupported();

  async function attempt(call: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await call();
      setValue("");
      await queryClient.invalidateQueries({ queryKey: qk.mfa });
      onConfirmed();
    } catch (e) {
      if (!isPasskeyCancel(e)) setFailure(reauthError(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entered = method === "password" ? value : value.trim();
    if (entered === "" || !status) return;
    void attempt(() =>
      method === "password"
        ? api.auth.reauth({ method, password: entered })
        : api.auth.reauth({ method, code: entered }),
    );
  }

  function switchTo(next: Method) {
    setMethod(next);
    setValue("");
    setFailure(null);
  }

  const label =
    method === "password"
      ? "Password"
      : method === "totp"
        ? "Authentication code"
        : "Recovery code";

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent showClose={false}>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Confirm it's you</DialogTitle>
            <DialogDescription>{DESCRIPTIONS[method]}</DialogDescription>
          </DialogHeader>
          {failure ? <Callout tone="error">{failure}</Callout> : null}
          <Field htmlFor="reauth-value" label={label}>
            <Input
              id="reauth-value"
              autoFocus
              type={method === "password" ? "password" : "text"}
              autoComplete={
                method === "password"
                  ? "current-password"
                  : method === "totp"
                    ? "one-time-code"
                    : "off"
              }
              inputMode={method === "totp" ? "numeric" : undefined}
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          {method !== "password" ? (
            <div className="flex flex-wrap gap-1">
              {passkeyHere ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void attempt(async () =>
                      api.auth.reauthPasskey(
                        await getPasskeyAssertion(await api.auth.reauthPasskeyOptions()),
                      ),
                    )
                  }
                >
                  <RiFingerprintLine aria-hidden />
                  Use a passkey
                </Button>
              ) : null}
              {method === "totp" ? (
                <Button type="button" variant="ghost" onClick={() => switchTo("recovery")}>
                  Use a recovery code
                </Button>
              ) : status?.totp ? (
                <Button type="button" variant="ghost" onClick={() => switchTo("totp")}>
                  Use your authenticator app
                </Button>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !status}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
