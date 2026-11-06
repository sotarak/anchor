import { AUDIT_ACTIONS, type AuditAction, type AuditEventDto } from "@anchor/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { RiFileListLine } from "react-icons/ri";
import { z } from "zod";
import { useSetHeader } from "@/components/app-shell/header";
import { AuditDetailSheet, AuditTable } from "@/components/audit/audit-table";
import { FilterChip } from "@/components/data/filter-chip";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  ForbiddenState,
} from "@/components/data/table-states";
import { TableContainer } from "@/components/ui/table";
import { ApiClientError } from "@/lib/api/client";
import { type AuditFilters, api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

const LIMITS = [25, 50, 100] as const;
const DEFAULT_LIMIT = 50;
const idSchema = z.string().min(1).max(64);
const actionSchema = z.enum(AUDIT_ACTIONS);

type AuditSearch = {
  projectId?: string;
  actorId?: string;
  action?: AuditAction;
  limit?: (typeof LIMITS)[number];
};

/**
 * Filters live in the URL so links are shareable. Every key is returned (invalid → undefined)
 * because the router lays validated search over the raw one; the default limit stays implicit.
 */
export function auditSearch(raw: Record<string, unknown>): AuditSearch {
  const pick = <T,>(schema: z.ZodType<T>, v: unknown) => {
    const r = schema.safeParse(v);
    return r.success ? r.data : undefined;
  };
  const limit = LIMITS.find((l) => l === raw.limit && l !== DEFAULT_LIMIT);
  return {
    projectId: pick(idSchema, raw.projectId),
    actorId: pick(idSchema, raw.actorId),
    action: pick(actionSchema, raw.action),
    limit,
  };
}

export const Route = createFileRoute("/_app/audit")({
  validateSearch: auditSearch,
  component: AuditPage,
});

const ACTION_OPTIONS = AUDIT_ACTIONS.map((a) => ({ value: a, label: a }));
const last = <T,>(values: T[]) => values.at(-1);

function AuditPage() {
  const { me } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isAdmin = me.role === "owner" || me.role === "admin";
  const limit = search.limit ?? DEFAULT_LIMIT;
  useSetHeader({ title: "Audit log" });

  const projects = useQuery({ queryKey: qk.projects, queryFn: api.projects.list });
  const users = useQuery({ queryKey: qk.users, queryFn: api.users.list, enabled: isAdmin });
  const projectSlugs = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.slug])),
    [projects.data],
  );
  // Non-instance admins read one project's log, addressed by slug.
  const projectSlug = search.projectId ? projectSlugs.get(search.projectId) : undefined;

  // Cursor stack for the current filters; a filter change starts again from the first page.
  const filterKey = JSON.stringify([search.projectId, search.actorId, search.action, limit]);
  const [cursors, setCursors] = useState<{ key: string; stack: string[] }>({
    key: filterKey,
    stack: [],
  });
  const stack = cursors.key === filterKey ? cursors.stack : [];
  const setStack = (next: string[]) => setCursors({ key: filterKey, stack: next });

  const filters: AuditFilters = {
    actorId: search.actorId,
    action: search.action,
    before: stack.at(-1),
    limit,
  };
  const audit = useQuery({
    queryKey: isAdmin
      ? qk.audit({ ...filters, projectId: search.projectId })
      : qk.projectAudit(projectSlug ?? "", filters),
    queryFn: () =>
      isAdmin
        ? api.audit.list({ ...filters, projectId: search.projectId })
        : api.audit.listForProject(projectSlug as string, filters),
    enabled: isAdmin || projectSlug !== undefined,
  });
  const [open, setOpen] = useState<AuditEventDto | null>(null);

  const setSearch = (patch: Partial<AuditSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  const filtered = !!(search.action || search.actorId || (isAdmin && search.projectId));
  const forbidden =
    (audit.error instanceof ApiClientError && audit.error.status === 403) ||
    (!isAdmin && (!search.projectId || (projects.isSuccess && projectSlug === undefined)));

  let body: ReactNode;
  if (forbidden) {
    body = <ForbiddenState what="the audit log" />;
  } else if (audit.isError) {
    body = <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;
  } else if (audit.data?.events.length === 0 && stack.length === 0) {
    body = filtered ? (
      <FilteredEmptyState
        what="your filters"
        onClear={() => void navigate({ search: isAdmin ? {} : { projectId: search.projectId } })}
      />
    ) : (
      <EmptyState
        icon={RiFileListLine}
        title="No audit events yet"
        description="Sign-ins, secret reads and changes, and admin actions are recorded here."
      />
    );
  } else {
    body = (
      <TableContainer>
        <AuditTable
          events={audit.data?.events ?? []}
          projectSlugs={projectSlugs}
          loading={!audit.data}
          onOpen={setOpen}
        />
        {audit.data ? (
          <TableFooter
            total={null}
            shown={audit.data.events.length}
            canPrev={stack.length > 0}
            canNext={audit.data.nextCursor !== null}
            onPrev={() => setStack(stack.slice(0, -1))}
            onNext={() => audit.data?.nextCursor && setStack([...stack, audit.data.nextCursor])}
            pageSize={limit}
            pageSizes={[...LIMITS]}
            onPageSize={(n) =>
              setSearch({ limit: n === DEFAULT_LIMIT ? undefined : (n as AuditSearch["limit"]) })
            }
          />
        ) : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Action"
          options={ACTION_OPTIONS}
          value={search.action ? [search.action] : []}
          onChange={(v) => setSearch({ action: last(v) })}
        />
        {isAdmin ? (
          <FilterChip
            label="Actor"
            options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
            value={search.actorId ? [search.actorId] : []}
            onChange={(v) => setSearch({ actorId: last(v) })}
          />
        ) : null}
        <FilterChip
          label="Project"
          options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          value={search.projectId ? [search.projectId] : []}
          onChange={(v) => setSearch({ projectId: last(v) })}
        />
      </div>
      {body}
      <AuditDetailSheet event={open} projectSlugs={projectSlugs} onClose={() => setOpen(null)} />
    </>
  );
}
