import type { TotpSetupDto } from "@anchor/shared";
import { type FormEvent, useState } from "react";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { QrCode } from "@/components/qr-code";
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
import { isReauthCancel } from "./use-reauth";

function confirmError(e: unknown): string {
  if (e instanceof ApiClientError && e.code === "invalid_credentials") {
    return "Invalid authentication code";
  }
  return errorMessage(e);
}

/**
 * Enrollment: the QR code and key for the pending secret, then a code to prove the app has it.
 * The secret lives only in the caller's state for as long as this dialog is open.
 */
export function TotpDialog({
  setup,
  run,
  onCancel,
  onEnabled,
}: {
  setup: TotpSetupDto;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  onCancel: () => void;
  onEnabled: (recoveryCodes: string[] | undefined) => void;
}) {
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const entered = code.replace(/\s/g, "");
    if (entered === "") return;
    setBusy(true);
    setFailure(null);
    try {
      const { recoveryCodes } = await run(() => api.mfa.confirmTotp(entered));
      onEnabled(recoveryCodes);
    } catch (err) {
      if (!isReauthCancel(err)) setFailure(confirmError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Set up an authenticator app</DialogTitle>
            <DialogDescription>Scan the QR code, or enter this key:</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            <QrCode value={setup.otpauthUri} />
            <code className="break-all rounded-lg bg-bg-weak px-3 py-2 text-center text-code-xs text-text-strong">
              {setup.secret}
            </code>
          </div>
          {failure ? <Callout tone="error">{failure}</Callout> : null}
          <Field
            htmlFor="totp-code"
            label="Authentication code"
            hint="Enter the 6-digit code the app shows."
          >
            <Input
              id="totp-code"
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
