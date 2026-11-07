import {
  createInviteBodySchema,
  type InstanceRole,
  type InviteDto,
  type UserDto,
} from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { RiMailLine, RiUserAddLine } from "react-icons/ri";
import { toast } from "sonner";
import { useSetHeader } from "@/components/app-shell/header";
import { FilterChip } from "@/components/data/filter-chip";
import { SearchChip } from "@/components/data/search-chip";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  FilteredEmptyState,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { FormSheet } from "@/components/overlays/form-sheet";
import { OneTimeSecretDialog } from "@/components/overlays/one-time-secret-dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableContainer } from "@/components/ui/table";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { formatDateTime } from "@/lib/format";
import { roleLabel } from "@/lib/status";
import { InvitesTable } from "./-components/invites-table";
import { UsersTable } from "./-components/users-table";

export const Route = createFileRoute("/_app/users")({
  beforeLoad: ({ context }) => {
    if (context.me.role !== "owner" && context.me.role !== "admin") {
      throw redirect({ to: "/projects", replace: true });
    }
  },
  component: UsersPage,
});

type UserStatus = "active" | "disabled";
const ROLE_OPTIONS: { value: InstanceRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
];
const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
];

/** A one-time link shown in the undismissable dialog; held in state only until Done. */
type Reveal = { title: string; label: string; value: string; notice: string };

function SectionLabel({ children }: { children: string }) {
  return <h2 className="text-paragraph-sm text-text-soft">{children}</h2>;
}

function UsersPage() {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: qk.users, queryFn: api.users.list });
  const invites = useQuery({ queryKey: qk.invites, queryFn: api.invites.list });
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<InstanceRole[]>([]);
  const [statuses, setStatuses] = useState<UserStatus[]>([]);
  const [inviting, setInviting] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [deleting, setDeleting] = useState<UserDto | null>(null);
  const [revoking, setRevoking] = useState<InviteDto | null>(null);
  useSetHeader({ title: "Users" });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (users.data ?? []).filter(
      (u) =>
        (!needle ||
          u.name.toLowerCase().includes(needle) ||
          u.email.toLowerCase().includes(needle)) &&
        (roles.length === 0 || roles.includes(u.role)) &&
        (statuses.length === 0 || statuses.includes(u.disabledAt ? "disabled" : "active")),
    );
  }, [users.data, search, roles, statuses]);
  const userPage = useClientPages(filtered);
  const invitePage = useClientPages(invites.data ?? []);
  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: qk.users });
  const refreshInvites = () => queryClient.invalidateQueries({ queryKey: qk.invites });

  /** Runs one user action; reports the server's message (e.g. last owner) as a toast. */
  async function act(run: () => Promise<unknown>, success: string) {
    try {
      await run();
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success(success);
    await refreshUsers();
  }
  const quietly = (p: Promise<unknown>) => void p.catch(() => {});

  const actions = {
    onChangeRole: (u: UserDto, role: InstanceRole) =>
      quietly(act(() => api.users.update(u.id, { role }), `${u.name} is now ${roleLabel(role)}`)),
    onToggleDisabled: (u: UserDto) =>
      quietly(
        act(
          () => api.users.update(u.id, { disabled: !u.disabledAt }),
          u.disabledAt ? `${u.name} enabled` : `${u.name} disabled`,
        ),
      ),
    onResetLink: (u: UserDto) =>
      quietly(
        (async () => {
          try {
            const { url, expiresAt } = await api.users.createPasswordReset(u.id);
            setReveal({
              title: "Copy the password reset link",
              label: `${u.name}, expires ${formatDateTime(expiresAt)}`,
              value: url,
              notice: `Send this link to ${u.name}. It works once and expires in 1 hour.`,
            });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        })(),
      ),
    onDelete: setDeleting,
  };

  const inviteButton = (
    <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
      <RiUserAddLine aria-hidden />
      Invite user
    </Button>
  );

  let usersBody: ReactNode;
  if (users.isError) {
    usersBody = <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
  } else if (users.data && filtered.length === 0) {
    usersBody = (
      <FilteredEmptyState
        what="your filters"
        onClear={() => {
          setSearch("");
          setRoles([]);
          setStatuses([]);
        }}
      />
    );
  } else {
    usersBody = (
      <TableContainer>
        <UsersTable users={userPage.rows} me={me} loading={users.isPending} actions={actions} />
        {users.data ? <TableFooter {...userPage.footer} label="users" /> : null}
      </TableContainer>
    );
  }

  let invitesBody: ReactNode;
  if (invites.isError) {
    invitesBody = <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />;
  } else if (invites.data?.length === 0) {
    invitesBody = (
      <EmptyState
        icon={RiMailLine}
        title="No invites"
        description="Invite links you create appear here until they are used, revoked or expire."
      />
    );
  } else {
    invitesBody = (
      <TableContainer>
        <InvitesTable
          invites={invitePage.rows}
          loading={invites.isPending}
          onRevoke={setRevoking}
        />
        {invites.data ? <TableFooter {...invitePage.footer} label="invites" /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchChip value={search} onChange={setSearch} placeholder="Search users" />
        <FilterChip label="Role" options={ROLE_OPTIONS} value={roles} onChange={setRoles} />
        <FilterChip
          label="Status"
          options={STATUS_OPTIONS}
          value={statuses}
          onChange={setStatuses}
        />
        <div className="ml-auto">{inviteButton}</div>
      </div>
      <SectionLabel>Users</SectionLabel>
      {usersBody}
      <SectionLabel>Invites</SectionLabel>
      {invitesBody}
      {inviting ? (
        <InviteSheet
          me={me}
          onClose={() => setInviting(false)}
          onCreated={(email, url) => {
            setInviting(false);
            setReveal({
              title: "Copy the invite link",
              label: email,
              value: url,
              notice: `Share this link with ${email}. It works once and expires in 72 hours.`,
            });
            void refreshInvites();
          }}
        />
      ) : null}
      <OneTimeSecretDialog
        open={reveal !== null}
        title={reveal?.title ?? ""}
        label={reveal?.label ?? ""}
        value={reveal?.value ?? ""}
        notice={reveal?.notice ?? ""}
        onDone={() => setReveal(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete user ${deleting?.name ?? ""}`}
        description="Their sessions end and they lose access to every project. This cannot be undone."
        confirmLabel="Delete user"
        destructive
        onConfirm={() =>
          deleting
            ? act(() => api.users.remove(deleting.id), `${deleting.name} deleted`)
            : Promise.resolve()
        }
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke invite for ${revoking?.email ?? ""}`}
        description="The invite link stops working immediately."
        confirmLabel="Revoke invite"
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await api.invites.revoke(revoking.id);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
          toast.success("Invite revoked");
          await refreshInvites();
        }}
      />
    </>
  );
}

type Key = "email";
const MESSAGES: Record<Key, string> = { email: "Enter a valid email address" };
const INVITE_ROLES: { value: InstanceRole; description: string }[] = [
  { value: "owner", description: "Everything, including other owners" },
  { value: "admin", description: "Manage users, projects and the audit log" },
  { value: "member", description: "Only projects they are added to" },
];

/**
 * Invite form. A plain call, not useMutation: the response carries the one-time invite URL, which
 * must not linger in the MutationCache.
 */
function InviteSheet({
  me,
  onClose,
  onCreated,
}: {
  me: UserDto;
  onClose: () => void;
  onCreated: (email: string, url: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InstanceRole>("member");
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const roles = INVITE_ROLES.filter((r) => r.value !== "owner" || me.role === "owner");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate(createInviteBodySchema, { email, role }, MESSAGES);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const { url } = await api.invites.create({ email: email.trim(), role });
      onCreated(email.trim(), url);
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Invite user"
      description="You get a one-time link to send them. It expires in 72 hours."
      submitLabel="Send invite"
      pending={pending}
      onSubmit={submit}
    >
      {failure ? <Callout tone="error">{failure}</Callout> : null}
      <Field htmlFor="invite-email" label="Email" error={errors.email}>
        <Input
          id="invite-email"
          type="email"
          autoFocus
          value={email}
          invalid={!!errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field htmlFor="invite-role" label="Role">
        <Select value={role} onValueChange={(v) => setRole(v as InstanceRole)}>
          <SelectTrigger id="invite-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.value} value={r.value} description={r.description}>
                {roleLabel(r.value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </FormSheet>
  );
}
