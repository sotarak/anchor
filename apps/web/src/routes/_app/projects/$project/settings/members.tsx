import {
  addMemberBodySchema,
  type EnvironmentDto,
  type MemberDto,
  type ProjectRole,
  updateMemberBodySchema,
} from "@anchor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  RiGroupLine,
  RiMore2Fill,
  RiPencilLine,
  RiUserAddLine,
  RiUserUnfollowLine,
} from "react-icons/ri";
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
  ForbiddenState,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { FormSheet } from "@/components/overlays/form-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { roleLabel } from "@/lib/status";

export const Route = createFileRoute("/_app/projects/$project/settings/members")({
  component: MembersPage,
});

const ROLES: { value: ProjectRole; label: string; description: string }[] = [
  { value: "admin", label: "Admin", description: "Everything, including members and tokens" },
  { value: "developer", label: "Developer", description: "Read and write secrets" },
  { value: "viewer", label: "Viewer", description: "Read secrets only" },
];

type SheetState = { mode: "add" } | { mode: "edit"; member: MemberDto } | null;

function matches(m: MemberDto, search: string, roles: ProjectRole[]) {
  const needle = search.trim().toLowerCase();
  if (needle && !m.name.toLowerCase().includes(needle) && !m.email.toLowerCase().includes(needle)) {
    return false;
  }
  return roles.length === 0 || roles.includes(m.role);
}

function MembersPage() {
  const { project } = Route.useParams();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const members = useQuery({
    queryKey: qk.members(project),
    queryFn: () => api.members.list(project),
  });
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<ProjectRole[]>([]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  useSetHeader({ title: "Members" });

  const canManage = projectQuery.data?.access?.role === "admin" && !members.isError;
  const filtered = useMemo(
    () => (members.data ?? []).filter((m) => matches(m, search, roles)),
    [members.data, search, roles],
  );
  const page = useClientPages(filtered);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.members(project) });
  const projectName = projectQuery.data?.name ?? project;

  async function remove(m: MemberDto) {
    try {
      await api.members.remove(project, m.userId);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Member removed");
    await refresh();
  }

  const addButton = canManage ? (
    <Button variant="primary" size="sm" onClick={() => setSheet({ mode: "add" })}>
      <RiUserAddLine aria-hidden />
      Add member
    </Button>
  ) : null;

  let body: ReactNode;
  if (members.error instanceof ApiClientError && members.error.status === 403) {
    body = <ForbiddenState what="this project's members" />;
  } else if (members.isError) {
    body = <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  } else if (members.data?.length === 0) {
    body = (
      <EmptyState
        icon={RiGroupLine}
        title="No members yet"
        description="Add people who already have an account; invite new people from Users."
        action={addButton}
      />
    );
  } else if (members.data && filtered.length === 0) {
    body = (
      <FilteredEmptyState
        what="your filters"
        onClear={() => {
          setSearch("");
          setRoles([]);
        }}
      />
    );
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Environments</TableHead>
              {canManage ? (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isPending ? (
              <TableSkeletonRows columns={["24ch", "8ch", "14ch"]} />
            ) : (
              page.rows.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell primary>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.name} size="md" />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{m.name}</span>
                        <span className="truncate text-paragraph-xs text-text-soft">{m.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Tag>{roleLabel(m.role)}</Tag>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.environments === null ? (
                        <Tag tone="neutral">All environments</Tag>
                      ) : (
                        m.environments.map((slug) => (
                          <Tag key={slug} tone="neutral">
                            {slug}
                          </Tag>
                        ))
                      )}
                    </div>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Actions for ${m.name}`}
                          >
                            <RiMore2Fill aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setSheet({ mode: "edit", member: m })}>
                            <RiPencilLine aria-hidden />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setRemoving(m)}>
                            <RiUserUnfollowLine aria-hidden />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {members.data ? <TableFooter {...page.footer} label="members" /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchChip value={search} onChange={setSearch} placeholder="Search members" />
        <FilterChip
          label="Role"
          options={ROLES.map(({ value, label }) => ({ value, label }))}
          value={roles}
          onChange={setRoles}
        />
        <div className="ml-auto">{members.data?.length ? addButton : null}</div>
      </div>
      {body}
      {sheet ? (
        <MemberSheet
          key={sheet.mode === "edit" ? sheet.member.userId : "add"}
          project={project}
          member={sheet.mode === "edit" ? sheet.member : null}
          onClose={() => setSheet(null)}
          onSaved={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""} from ${projectName}`}
        description="They lose access to this project's secrets right away. Their account stays."
        confirmLabel="Remove member"
        destructive
        onConfirm={() => (removing ? remove(removing) : Promise.resolve())}
      />
    </>
  );
}

/** "All environments", or a checkbox per environment (at least one). */
function EnvironmentsField({
  environments,
  value,
  onChange,
  locked,
  error,
}: {
  environments: EnvironmentDto[];
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  locked: boolean;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-label-sm text-text-strong">Environments</legend>
      <div className="flex items-center gap-2">
        <Checkbox
          id="env-all"
          checked={value === null}
          disabled={locked}
          onCheckedChange={(on) => onChange(on ? null : [])}
        />
        <label htmlFor="env-all" className="text-paragraph-sm text-text-strong">
          All environments
        </label>
      </div>
      {locked ? (
        <p className="text-paragraph-xs text-text-soft">
          Project admins always have every environment.
        </p>
      ) : null}
      {value !== null ? (
        <div className="flex flex-col gap-2 pl-6">
          {environments.map((e) => (
            <div key={e.slug} className="flex items-center gap-2">
              <Checkbox
                id={`env-${e.slug}`}
                checked={value.includes(e.slug)}
                onCheckedChange={(on) =>
                  onChange(on ? [...value, e.slug] : value.filter((s) => s !== e.slug))
                }
              />
              <label htmlFor={`env-${e.slug}`} className="text-paragraph-sm text-text-sub">
                {e.name} <span className="text-code-xs text-text-soft">{e.slug}</span>
              </label>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </fieldset>
  );
}

type Key = "email" | "environments";
const MESSAGES: Record<Key, string> = {
  email: "Enter a valid email address",
  environments: "Pick at least one environment",
};

function MemberSheet({
  project,
  member,
  onClose,
  onSaved,
}: {
  project: string;
  member: MemberDto | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const editing = member !== null;
  const envQuery = useQuery({
    queryKey: qk.environments(project),
    queryFn: () => api.environments.list(project),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>(member?.role ?? "developer");
  const [environments, setEnvironments] = useState<string[] | null>(member?.environments ?? null);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const save = useMutation({
    mutationFn: (body: { role: ProjectRole; environments: string[] | null }) =>
      member
        ? api.members.update(project, member.userId, body)
        : api.members.add(project, { email: email.trim(), ...body }),
    onSuccess: async () => {
      toast.success(editing ? "Member updated" : "Member added");
      onClose();
      await onSaved();
    },
    onError: (e) => {
      if (!editing && e instanceof ApiClientError && e.status === 404) {
        setErrors({ email: "No user with this email. Invite them from Users first." });
      }
    },
  });
  const notFound = save.error instanceof ApiClientError && save.error.status === 404;

  // Environments in position order, ignoring slugs that no longer exist.
  const ordered = [...(envQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const effective = role === "admin" ? null : environments;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const envs =
      effective === null ? null : ordered.map((x) => x.slug).filter((s) => effective.includes(s));
    const next = editing
      ? validate(updateMemberBodySchema, { role, environments: envs }, MESSAGES)
      : validate(addMemberBodySchema, { email, role, environments: envs }, MESSAGES);
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate({ role, environments: envs });
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? `Edit ${member.name}` : "Add member"}
      description={
        editing
          ? member.email
          : "Give an existing user access to this project. New people need an invite first."
      }
      submitLabel={editing ? "Save changes" : "Add member"}
      pending={save.isPending}
      onSubmit={submit}
    >
      {save.isError && !(notFound && !editing) ? (
        <Callout tone="error">{errorMessage(save.error)}</Callout>
      ) : null}
      {editing ? null : (
        <Field htmlFor="member-email" label="Email" error={errors.email}>
          <Input
            id="member-email"
            type="email"
            autoFocus
            value={email}
            invalid={!!errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
      )}
      <Field htmlFor="member-role" label="Role">
        <Select value={role} onValueChange={(v) => setRole(v as ProjectRole)}>
          <SelectTrigger id="member-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value} description={r.description}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <EnvironmentsField
        environments={ordered}
        value={effective}
        onChange={setEnvironments}
        locked={role === "admin"}
        error={errors.environments}
      />
    </FormSheet>
  );
}
