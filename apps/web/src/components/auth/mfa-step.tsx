import type { LoginResponse, MfaMethod, MfaRequiredResponse, UserDto } from "@anchor/shared";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { RiFingerprintLine } from "react-icons/ri";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { getPasskeyAssertion, isPasskeyCancel, passkeysSupported } from "@/lib/webauthn";

type CodeMethod = "totp" | "recovery";

export const SIGN_IN_EXPIRED = "Your sign-in expired. Enter your password again.";

function factorError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.code === "invalid_credentials") return "Invalid authentication code";
    if (e.code === "rate_limited") return "Too many failed attempts. Try again in 15 minutes.";
  }
  return errorMessage(e);
}

const expired = (e: unknown) => e instanceof ApiClientError && e.code === "unauthenticated";

/**
 * Second sign-in step. The ticket and code are read from props and state inside the mutation
 * functions, never passed as variables, so neither sits in the MutationCache.
 */
export function MfaStep({
  challenge,
  onDone,
  onRestart,
}: {
  challenge: MfaRequiredResponse;
  onDone: (user: UserDto) => void | Promise<void>;
  onRestart: (message: string) => void;
}) {
  const offers = (m: MfaMethod) => challenge.methods.includes(m);
  const [method, setMethod] = useState<CodeMethod>(offers("totp") ? "totp" : "recovery");
  const [code, setCode] = useState("");
  const showPasskey = offers("passkey") && passkeysSupported();

  const settle = {
    onSuccess: async ({ user }: LoginResponse) => onDone(user),
    onError: (e: unknown) => {
      if (expired(e)) onRestart(SIGN_IN_EXPIRED);
    },
  };
  const verify = useMutation({
    mutationFn: () => api.auth.loginMfa({ ticket: challenge.ticket, method, code: code.trim() }),
    ...settle,
  });
  const passkey = useMutation({
    mutationFn: async () => {
      const options = await api.auth.loginPasskeyOptions(challenge.ticket);
      const response = await getPasskeyAssertion(options);
      return api.auth.loginPasskey({ ticket: challenge.ticket, response });
    },
    ...settle,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (code.trim() === "") return;
    passkey.reset();
    verify.mutate();
  }

  function switchTo(next: CodeMethod) {
    setMethod(next);
    setCode("");
    verify.reset();
  }

  const failure = verify.isError
    ? verify.error
    : passkey.isError && !isPasskeyCancel(passkey.error)
      ? passkey.error
      : null;
  const busy = verify.isPending || passkey.isPending;
  const totp = method === "totp";

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {failure && !expired(failure) ? <Callout tone="error">{factorError(failure)}</Callout> : null}
      <p className="text-paragraph-sm text-text-sub">
        {totp
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of the recovery codes you saved."}
      </p>
      <Field htmlFor="mfa-code" label={totp ? "Authentication code" : "Recovery code"}>
        <Input
          id="mfa-code"
          autoFocus
          autoComplete={totp ? "one-time-code" : "off"}
          inputMode={totp ? "numeric" : "text"}
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        Verify
      </Button>
      <div className="flex flex-col items-center gap-1">
        {showPasskey ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => {
              verify.reset();
              passkey.mutate();
            }}
          >
            <RiFingerprintLine aria-hidden />
            Use a passkey
          </Button>
        ) : null}
        {totp ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => switchTo("recovery")}>
            Use a recovery code
          </Button>
        ) : offers("totp") ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => switchTo("totp")}>
            Use your authenticator app
          </Button>
        ) : null}
      </div>
    </form>
  );
}
