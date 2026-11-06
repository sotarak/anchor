import { changePasswordBodySchema, type SessionDto } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { RiComputerLine, RiForbidLine, RiMore2Fill } from "react-icons/ri";
import { toast } from "sonner";
import { useSetHeader } from "@/components/app-shell/header";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { Field } from "@/components/forms/field";
import {
  type FieldErrors,
  PASSWORD_HINT,
  PASSWORD_MISMATCH,
  validate,
} from "@/components/forms/validate";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { formatDate, formatRelative } from "@/lib/format";
import { useLogOut } from "@/lib/use-log-out";

export const Route = createFileRoute("/_app/account")({
  component: AccountPage,
});

function AccountPage() {
  const { me } = Route.useRouteContext();
  useSetHeader({ title: "Account" });
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <Section id="profile" title="Profile">
        <Field htmlFor="profile-name" label="Name">
          <Input id="profile-name" value={me.name} readOnly disabled />
        </Field>
        <Field htmlFor="profile-email" label="Email">
          <Input id="profile-email" type="email" value={me.email} readOnly disabled />
        </Field>
      </Section>
      <Section id="password" title="Password">
        <PasswordForm />
      </Section>
      <Section id="sessions" title="Sessions">
        <Sessions />
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-paragraph-sm text-text-soft">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Key = "currentPassword" | "newPassword" | "confirm";
const EMPTY: Record<Key, string> = { currentPassword: "", newPassword: "", confirm: "" };
const MESSAGES: Record<Key, string> = {
  currentPassword: "Enter your current password",
  newPassword: "Use at least 12 characters",
  confirm: PASSWORD_MISMATCH,
};

/**
 * A plain async call, not useMutation: mutation variables would keep both passwords in the
 * MutationCache after the form is cleared.
 */
function PasswordForm() {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field = (key: Key) => ({
    id: key,
    type: "password",
    value: values[key],
    invalid: !!errors[key],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { currentPassword: values.currentPassword, newPassword: values.newPassword };
    const next = validate(changePasswordBodySchema, body, MESSAGES);
    if (values.confirm !== values.newPassword) next.confirm = PASSWORD_MISMATCH;
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      await api.auth.changePassword(body);
      setValues(EMPTY);
      toast.success("Password updated. Other sessions were signed out.");
      await queryClient.invalidateQueries({ queryKey: qk.sessions });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "invalid_credentials") {
        setErrors({ currentPassword: err.message });
      } else {
        setFailure(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {failure ? <Callout tone="error">{failure}</Callout> : null}
      <Field htmlFor="currentPassword" label="Current password" error={errors.currentPassword}>
        <Input autoComplete="current-password" {...field("currentPassword")} />
      </Field>
      <Field
        htmlFor="newPassword"
        label="New password"
        hint={PASSWORD_HINT}
        error={errors.newPassword}
      >
        <Input autoComplete="new-password" {...field("newPassword")} />
      </Field>
      <Field htmlFor="confirm" label="Confirm new password" error={errors.confirm}>
        <Input autoComplete="new-password" {...field("confirm")} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          Update password
        </Button>
      </div>
    </form>
  );
}

const KIND_LABEL: Record<SessionDto["kind"], string> = { web: "Web", cli: "CLI" };

function Sessions() {
  const queryClient = useQueryClient();
  const logOut = useLogOut();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: api.auth.sessions });
  const page = useClientPages(sessions.data ?? []);
  const [revoking, setRevoking] = useState<SessionDto | null>(null);

  async function revoke(s: SessionDto) {
    try {
      await api.auth.revokeSession(s.id);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Session revoked");
    await queryClient.invalidateQueries({ queryKey: qk.sessions });
  }

  if (sessions.isError) {
    return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;
  }
  if (sessions.data?.length === 0) {
    return (
      <EmptyState
        icon={RiComputerLine}
        title="No active sessions"
        description="Sign-ins from the dashboard and the CLI appear here."
      />
    );
  }
  return (
    <>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.data ? (
              page.rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Tag>{KIND_LABEL[s.kind]}</Tag>
                      <span
                        title={s.userAgent ?? undefined}
                        className="max-w-[40ch] truncate text-paragraph-sm text-text-sub"
                      >
                        {s.userAgent ?? "Unknown device"}
                      </span>
                      {s.current ? <StatusBadge status="info">This session</StatusBadge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Tooltip content={formatRelative(s.createdAt)}>
                      <span>{formatDate(s.createdAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {s.lastUsedAt === null ? (
                      <span className="text-text-soft">–</span>
                    ) : (
                      formatRelative(s.lastUsedAt)
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip content={formatRelative(s.expiresAt)}>
                      <span>{formatDate(s.expiresAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right">
                    {s.current ? (
                      <Button variant="ghost" onClick={() => void logOut()}>
                        Log out
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Actions for ${KIND_LABEL[s.kind]} session`}
                          >
                            <RiMore2Fill aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem destructive onSelect={() => setRevoking(s)}>
                            <RiForbidLine aria-hidden />
                            Revoke
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableSkeletonRows columns={["24ch", "14ch", "8ch", "14ch", "8ch"]} />
            )}
          </TableBody>
        </Table>
        {sessions.data ? <TableFooter {...page.footer} label="sessions" /> : null}
      </TableContainer>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking ? KIND_LABEL[revoking.kind] : ""} session`}
        description="That device is signed out at its next request and has to sign in again."
        confirmLabel="Revoke session"
        destructive
        onConfirm={() => (revoking ? revoke(revoking) : Promise.resolve())}
      />
    </>
  );
}
