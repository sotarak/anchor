import { normalizeSecretPath, type ServiceTokenDto } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import {
  RiAddLine,
  RiCloseLine,
  RiForbidLine,
  RiMore2Fill,
  RiShieldKeyholeLine,
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
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { FormSheet } from "@/components/overlays/form-sheet";
import { OneTimeSecretDialog } from "@/components/overlays/one-time-secret-dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { type TokenStatusLabel, tokenStatus } from "@/lib/status";

export const Route = createFileRoute("/_app/projects/$project/settings/service-tokens")({
  component: ServiceTokensPage,
});

const STATUS_OPTIONS: { value: TokenStatusLabel; label: string }[] = [
  { value: "Active", label: "Active" },
  { value: "Expiring", label: "Expiring" },
  { value: "Expired", label: "Expired" },
  { value: "Revoked", label: "Revoked" },
];
const PERMISSION_LABEL = { read: "Read", "read-write": "Read & write" } as const;

function ServiceTokensPage() {
  const { project } = Route.useParams();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const tokens = useQuery({
    queryKey: qk.serviceTokens(project),
    queryFn: () => api.serviceTokens.list(project),
  });
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<TokenStatusLabel[]>([]);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ServiceTokenDto | null>(null);
  // The one-time token: component state only, cleared when the dialog is done.
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  useSetHeader({ title: "Service tokens" });

  const canManage = projectQuery.data?.access?.role === "admin" && !tokens.isError;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (tokens.data ?? []).filter(
      (t) =>
        (!needle || t.name.toLowerCase().includes(needle)) &&
        (statuses.length === 0 || statuses.includes(tokenStatus(t).label)),
    );
  }, [tokens.data, search, statuses]);
  const page = useClientPages(filtered);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.serviceTokens(project) });

  async function revoke(t: ServiceTokenDto) {
    try {
      await api.serviceTokens.revoke(project, t.id);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Token revoked");
    await refresh();
  }

  const newButton = canManage ? (
    <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
      <RiAddLine aria-hidden />
      New token
    </Button>
  ) : null;

  let body: ReactNode;
  if (tokens.error instanceof ApiClientError && tokens.error.status === 403) {
    body = <ForbiddenState what="this project's service tokens" />;
  } else if (tokens.isError) {
    body = <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />;
  } else if (tokens.data?.length === 0) {
    body = (
      <EmptyState
        icon={RiShieldKeyholeLine}
        title="No service tokens"
        description="Service tokens let CI and servers read (or write) secrets without a user login."
        action={newButton}
      />
    );
  } else if (tokens.data && filtered.length === 0) {
    body = (
      <FilteredEmptyState
        what="your filters"
        onClear={() => {
          setSearch("");
          setStatuses([]);
        }}
      />
    );
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Permission</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Last used</TableHead>
              {canManage ? (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.isPending ? (
              <TableSkeletonRows columns={["24ch", "8ch", "14ch", "8ch", "14ch", "8ch"]} />
            ) : (
              page.rows.map((t) => {
                const status = tokenStatus(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell primary>
                      <div className="flex items-center gap-2">
                        <RiShieldKeyholeLine
                          aria-hidden
                          className="size-4 shrink-0 text-text-soft"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate">{t.name}</span>
                          <span className="text-code-xs text-text-soft">{`${t.tokenPrefix}…`}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Tag>{PERMISSION_LABEL[t.permission]}</Tag>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.scopes.map((s) => (
                          <Tag key={`${s.environment}:${s.path}`} tone="neutral">
                            {`${s.environment}:${s.path}`}
                          </Tag>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status.status}>{status.label}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-paragraph-sm">
                      <Tooltip content={formatRelative(t.expiresAt)}>
                        <span>{formatDate(t.expiresAt)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-paragraph-sm">
                      {t.lastUsedAt === null ? (
                        <span className="text-text-soft">–</span>
                      ) : (
                        formatRelative(t.lastUsedAt)
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Actions for ${t.name}`}
                            >
                              <RiMore2Fill aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              destructive
                              disabled={t.revokedAt !== null}
                              onSelect={() => setRevoking(t)}
                            >
                              <RiForbidLine aria-hidden />
                              Revoke
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {tokens.data ? <TableFooter {...page.footer} label="tokens" /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchChip value={search} onChange={setSearch} placeholder="Search tokens" />
        <FilterChip
          label="Status"
          options={STATUS_OPTIONS}
          value={statuses}
          onChange={setStatuses}
        />
        <div className="ml-auto">{tokens.data?.length ? newButton : null}</div>
      </div>
      {body}
      {creating ? (
        <CreateTokenSheet
          project={project}
          onClose={() => setCreating(false)}
          onCreated={(name, token) => {
            setCreating(false);
            setCreated({ name, token });
            void refresh();
          }}
        />
      ) : null}
      <OneTimeSecretDialog
        open={created !== null}
        title="Copy your service token"
        label={created?.name ?? ""}
        value={created?.token ?? ""}
        notice="This token is shown once. Store it in your CI secret store now."
        onDone={() => setCreated(null)}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke token ${revoking?.name ?? ""}`}
        description="Anything using this token loses access immediately. This cannot be undone."
        confirmLabel="Revoke token"
        destructive
        onConfirm={() => (revoking ? revoke(revoking) : Promise.resolve())}
      />
    </>
  );
}

const EXPIRY_DAYS = [7, 30, 90, 365];
const PATH_ERROR = "Use folders of letters, digits, - and _, like /api/v1";
type Scope = { environment: string; path: string };

/**
 * Create form. Not a useMutation: the response carries the plaintext token, and mutation state
 * would keep it in the MutationCache. The token goes straight to the caller's dialog state.
 */
function CreateTokenSheet({
  project,
  onClose,
  onCreated,
}: {
  project: string;
  onClose: () => void;
  onCreated: (name: string, token: string) => void;
}) {
  const envQuery = useQuery({
    queryKey: qk.environments(project),
    queryFn: () => api.environments.list(project),
  });
  const envs = [...(envQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<"read" | "read-write">("read");
  const [scopes, setScopes] = useState<Scope[]>([{ environment: "", path: "/" }]);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [errors, setErrors] = useState<{ name?: string; scopes: (string | undefined)[] }>({
    scopes: [],
  });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const envOf = (s: Scope) => s.environment || envs[0]?.slug || "";
  const setScope = (i: number, patch: Partial<Scope>) =>
    setScopes((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    const next: typeof errors = { scopes: [] };
    if (trimmed.length < 1 || trimmed.length > 64) next.name = "Enter a name (up to 64 characters)";
    const body: Scope[] = scopes.map((s, i) => {
      try {
        return { environment: envOf(s), path: normalizeSecretPath(s.path.trim()) };
      } catch {
        next.scopes[i] = PATH_ERROR;
        return s;
      }
    });
    body.forEach((s, i) => {
      if (!s.environment) next.scopes[i] ??= "Pick an environment";
    });
    setErrors(next);
    if (next.name || next.scopes.some(Boolean)) return;
    setPending(true);
    setFailure(null);
    try {
      const { token } = await api.serviceTokens.create(project, {
        name: trimmed,
        permission,
        scopes: body,
        expiresInDays,
      });
      onCreated(trimmed, token);
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
      title="New service token"
      description="The token is shown once after you create it."
      submitLabel="Create token"
      pending={pending}
      onSubmit={submit}
    >
      {failure ? <Callout tone="error">{failure}</Callout> : null}
      <Field htmlFor="token-name" label="Name" error={errors.name}>
        <Input
          id="token-name"
          autoFocus
          placeholder="ci-deploy"
          value={name}
          invalid={!!errors.name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field htmlFor="token-permission" label="Permission">
        <Select value={permission} onValueChange={(v) => setPermission(v as typeof permission)}>
          <SelectTrigger id="token-permission">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="read" description="Read secrets in its scopes">
              Read
            </SelectItem>
            <SelectItem value="read-write" description="Read and write secrets in its scopes">
              Read & write
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-label-sm text-text-strong">Scopes</legend>
        {scopes.map((s, i) => {
          const n = i + 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides position
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Select value={envOf(s)} onValueChange={(v) => setScope(i, { environment: v })}>
                  <SelectTrigger
                    aria-label={`Environment for scope ${n}`}
                    className="w-40 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {envs.map((env) => (
                      <SelectItem key={env.slug} value={env.slug}>
                        {env.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Path for scope ${n}`}
                  className="font-mono"
                  value={s.path}
                  invalid={!!errors.scopes[i]}
                  onChange={(e) => setScope(i, { path: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove scope ${n}`}
                  disabled={scopes.length === 1}
                  onClick={() => setScopes((all) => all.filter((_, j) => j !== i))}
                >
                  <RiCloseLine aria-hidden />
                </Button>
              </div>
              {errors.scopes[i] ? <FieldError>{errors.scopes[i]}</FieldError> : null}
            </div>
          );
        })}
        <div>
          <Button
            variant="dashed"
            size="xs"
            disabled={scopes.length >= 20}
            onClick={() => setScopes((all) => [...all, { environment: "", path: "/" }])}
          >
            <RiAddLine aria-hidden />
            Add scope
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label htmlFor="token-expiry">Expires in</Label>
        <Select value={String(expiresInDays)} onValueChange={(v) => setExpiresInDays(Number(v))}>
          <SelectTrigger id="token-expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_DAYS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {`${d} days`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </FormSheet>
  );
}
