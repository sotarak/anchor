import type { TotpSetupDto } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { IconType } from "react-icons";
import { RiKey2Line, RiShieldKeyholeLine } from "react-icons/ri";
import { toast } from "sonner";
import { ErrorState, errorMessage } from "@/components/data/table-states";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { Passkeys } from "./passkeys";
import { RecoveryCodesDialog } from "./recovery-codes-dialog";
import { TotpDialog } from "./totp-dialog";
import { isReauthCancel, useReauth } from "./use-reauth";

/** Account page section: authenticator app, recovery codes and passkeys. */
export function TwoFactor() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: qk.mfa, queryFn: api.mfa.status });
  const { run, dialog } = useReauth();
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<"disable" | "regenerate" | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.mfa });

  /** Runs a step-up guarded call; reports failures except a cancelled confirmation. */
  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await run(fn);
    } catch (e) {
      if (!isReauthCancel(e)) toast.error(errorMessage(e));
      throw e;
    }
  }

  async function startSetup() {
    setStarting(true);
    try {
      setSetup(await guarded(api.mfa.setupTotp));
    } catch {
      // Reported by `guarded`.
    } finally {
      setStarting(false);
    }
  }

  async function enabled(recoveryCodes: string[] | undefined) {
    setSetup(null);
    if (recoveryCodes) setCodes(recoveryCodes);
    toast.success("Authenticator app turned on");
    await refresh();
  }

  async function disable() {
    await guarded(api.mfa.disableTotp);
    toast.success("Authenticator app turned off");
    await refresh();
  }

  async function regenerate() {
    setCodes(await guarded(api.mfa.regenerateRecoveryCodes));
    await refresh();
  }

  if (status.isError) {
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  }
  const s = status.data;
  return (
    <>
      <div className="flex flex-col divide-y rounded-lg border shadow-xs">
        <Row
          icon={RiShieldKeyholeLine}
          title="Authenticator app"
          description="Codes from an app such as 1Password or Google Authenticator."
          badge={
            s ? (
              <StatusBadge status={s.totp ? "success" : "neutral"}>
                {s.totp ? "On" : "Off"}
              </StatusBadge>
            ) : null
          }
          action={
            !s ? null : s.totp ? (
              <Button onClick={() => setConfirming("disable")}>Turn off</Button>
            ) : (
              <Button disabled={starting} onClick={() => void startSetup()}>
                Set up
              </Button>
            )
          }
        />
        {s?.enabled ? (
          <Row
            icon={RiKey2Line}
            title="Recovery codes"
            description={`${s.recoveryCodesRemaining} recovery codes left`}
            action={<Button onClick={() => setConfirming("regenerate")}>Generate new codes</Button>}
          />
        ) : null}
      </div>
      {s ? <Passkeys status={s} run={run} onCodes={setCodes} onChanged={refresh} /> : null}
      {setup ? (
        <TotpDialog
          setup={setup}
          run={run}
          onCancel={() => setSetup(null)}
          onEnabled={(c) => void enabled(c)}
        />
      ) : null}
      {codes ? <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} /> : null}
      <ConfirmDialog
        open={confirming === "disable"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Turn off authenticator app?"
        description={
          s?.passkeys.length
            ? "You will confirm sign-ins with a passkey or a recovery code."
            : "Two-factor authentication turns off: you will sign in with your password only."
        }
        confirmLabel="Turn off"
        destructive
        onConfirm={disable}
      />
      <ConfirmDialog
        open={confirming === "regenerate"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Generate new recovery codes?"
        description="Your current recovery codes stop working."
        confirmLabel="Generate codes"
        onConfirm={regenerate}
      />
      {dialog}
    </>
  );
}

function Row({
  icon: Icon,
  title,
  description,
  badge,
  action,
}: {
  icon: IconType;
  title: string;
  description: string;
  badge?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon aria-hidden className="size-4 shrink-0 text-text-soft" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-sm text-text-strong">{title}</span>
        <span className="text-paragraph-xs text-text-soft">{description}</span>
      </div>
      {badge}
      {action}
    </div>
  );
}
