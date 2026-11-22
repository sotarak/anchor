import type { MfaStatusDto, PasskeyDto } from "@anchor/shared";
import { type FormEvent, useState } from "react";
import { RiDeleteBinLine, RiFingerprintLine, RiMore2Fill } from "react-icons/ri";
import { toast } from "sonner";
import { TableFooter } from "@/components/data/table-footer";
import { errorMessage } from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { Field } from "@/components/forms/field";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api/endpoints";
import { formatDate, formatRelative } from "@/lib/format";
import { createPasskey, isPasskeyCancel, passkeysSupported } from "@/lib/webauthn";
import { isReauthCancel } from "./use-reauth";

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

/** Passkeys as a second factor: list, add (name → browser prompt) and remove. */
export function Passkeys({
  status,
  run,
  onCodes,
  onChanged,
}: {
  status: MfaStatusDto;
  run: Run;
  onCodes: (codes: string[]) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PasskeyDto | null>(null);
  const page = useClientPages(status.passkeys);
  const supported = passkeysSupported();
  const lastFactor = !status.totp && status.passkeys.length === 1;

  async function remove(p: PasskeyDto) {
    try {
      await run(() => api.mfa.removePasskey(p.id));
    } catch (e) {
      if (!isReauthCancel(e)) toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Passkey removed");
    await onChanged();
  }

  return (
    <section aria-labelledby="passkeys-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="passkeys-title" className="text-label-sm text-text-strong">
          Passkeys
        </h3>
        {supported ? (
          <Button onClick={() => setAdding(true)}>
            <RiFingerprintLine aria-hidden />
            Add a passkey
          </Button>
        ) : (
          <span className="text-paragraph-xs text-text-soft">
            This browser does not support passkeys.
          </span>
        )}
      </div>
      {status.passkeys.length === 0 ? (
        <p className="text-paragraph-sm text-text-soft">No passkeys yet.</p>
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <RiFingerprintLine aria-hidden className="size-4 text-text-soft" />
                      <span className="text-label-sm text-text-strong">{p.name}</span>
                      {p.usableHere ? null : <Tag>Registered on {p.rpId}</Tag>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Tooltip content={formatRelative(p.createdAt)}>
                      <span>{formatDate(p.createdAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {p.lastUsedAt === null ? (
                      <span className="text-text-soft">–</span>
                    ) : (
                      formatRelative(p.lastUsedAt)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${p.name}`}>
                          <RiMore2Fill aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem destructive onSelect={() => setRemoving(p)}>
                          <RiDeleteBinLine aria-hidden />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableFooter {...page.footer} label="passkeys" />
        </TableContainer>
      )}
      {adding ? (
        <AddPasskeyDialog
          run={run}
          onCancel={() => setAdding(false)}
          onAdded={async (codes) => {
            setAdding(false);
            if (codes) onCodes(codes);
            toast.success("Passkey added");
            await onChanged();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove passkey "${removing?.name ?? ""}"?`}
        description={
          lastFactor
            ? "Two-factor authentication turns off: you will sign in with your password only."
            : "It can no longer be used to sign in to Anchor."
        }
        confirmLabel="Remove passkey"
        destructive
        onConfirm={() => (removing ? remove(removing) : Promise.resolve())}
      />
    </section>
  );
}

function AddPasskeyDialog({
  run,
  onCancel,
  onAdded,
}: {
  run: Run;
  onCancel: () => void;
  onAdded: (codes: string[] | undefined) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > 64) {
      setNameError("Use 1 to 64 characters");
      return;
    }
    setNameError(undefined);
    setFailure(null);
    setBusy(true);
    try {
      const options = await run(api.mfa.passkeyOptions);
      const response = await createPasskey(options);
      const { recoveryCodes } = await run(() => api.mfa.addPasskey({ name: trimmed, response }));
      await onAdded(recoveryCodes);
    } catch (err) {
      if (!isReauthCancel(err) && !isPasskeyCancel(err)) setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Add a passkey</DialogTitle>
            <DialogDescription>
              Your browser asks you to create it after you continue.
            </DialogDescription>
          </DialogHeader>
          {failure ? <Callout tone="error">{failure}</Callout> : null}
          <Field
            htmlFor="passkey-name"
            label="Passkey name"
            hint="For example the device or password manager that holds it."
            error={nameError}
          >
            <Input
              id="passkey-name"
              autoFocus
              maxLength={64}
              value={name}
              invalid={!!nameError}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
