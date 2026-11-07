import type { EnvironmentDto, OverviewDto } from "@anchor/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { RiCheckboxCircleFill, RiKey2Line } from "react-icons/ri";
import { useSetHeader } from "@/components/app-shell/header";
import { FilterChip } from "@/components/data/filter-chip";
import { SearchChip } from "@/components/data/search-chip";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  FilteredEmptyState,
  ForbiddenState,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { PathBreadcrumb } from "@/components/secrets/path-breadcrumb";
import { Button } from "@/components/ui/button";
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
import { Tooltip } from "@/components/ui/tooltip";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { useCurrentEnvironment } from "@/lib/current-env";
import { formatRelative } from "@/lib/format";
import { pathSearch } from "@/lib/search";

export const Route = createFileRoute("/_app/projects/$project/")({
  validateSearch: pathSearch,
  component: OverviewPage,
});

type StatusFilter = "missing" | "complete";
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "missing", label: "Missing somewhere" },
  { value: "complete", label: "Present everywhere" },
];
type Row = OverviewDto["keys"][number];

function isComplete(row: Row) {
  return Object.values(row.cells).every((c) => c !== null);
}

function matches(row: Row, search: string, status: StatusFilter[]) {
  if (search.trim() && !row.key.toLowerCase().includes(search.trim().toLowerCase())) return false;
  if (status.length === 0 || status.length === STATUS_OPTIONS.length) return true;
  return status.includes(isComplete(row) ? "complete" : "missing");
}

function OverviewPage() {
  const { project } = Route.useParams();
  const search = Route.useSearch();
  const path = search.path ?? "/";
  const navigate = Route.useNavigate();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const overview = useQuery({
    queryKey: qk.overview(project, path),
    queryFn: () => api.projects.overview(project, path),
  });
  const [keySearch, setKeySearch] = useState("");
  const [status, setStatus] = useState<StatusFilter[]>([]);
  const [currentEnv] = useCurrentEnvironment(overview.data?.environments);
  useSetHeader({ title: projectQuery.data?.name ?? "" });

  const environments = overview.data?.environments ?? [];
  const filtered = useMemo(
    () => (overview.data?.keys ?? []).filter((r) => matches(r, keySearch, status)),
    [overview.data, keySearch, status],
  );
  const page = useClientPages(filtered, 25);
  const setPath = (next: string) => void navigate({ search: next === "/" ? {} : { path: next } });
  const clearFilters = () => {
    setKeySearch("");
    setStatus([]);
  };

  let body: ReactNode;
  if (overview.error instanceof ApiClientError && overview.error.status === 403) {
    body = <ForbiddenState what="this project" />;
  } else if (overview.isError) {
    body = <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  } else if (overview.data?.keys.length === 0) {
    body = (
      <EmptyState
        icon={RiKey2Line}
        title="No secrets at this path"
        description="Secrets you add to any environment of this project show up here, one row per key."
        action={
          currentEnv ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                void navigate({
                  to: "/projects/$project/environments/$env",
                  params: { project, env: currentEnv },
                  search: path === "/" ? {} : { path },
                })
              }
            >
              Add a secret
            </Button>
          ) : null
        }
      />
    );
  } else if (overview.data && filtered.length === 0) {
    body = <FilteredEmptyState what="your filters" onClear={clearFilters} />;
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              {environments.map((e) => (
                <TableHead key={e.slug}>
                  <span>{e.name}</span>{" "}
                  <span className="text-code-xs text-text-soft">{e.slug}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.isPending ? (
              <TableSkeletonRows columns={["24ch", "8ch", "8ch", "8ch"]} />
            ) : (
              page.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell primary>
                    <span className="flex items-center gap-2">
                      <RiKey2Line aria-hidden className="size-4 shrink-0 text-text-soft" />
                      {row.key}
                    </span>
                  </TableCell>
                  {environments.map((e) => (
                    <TableCell key={e.slug}>
                      <MatrixCell project={project} path={path} env={e} row={row} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {overview.data ? <TableFooter {...page.footer} /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchChip value={keySearch} onChange={setKeySearch} placeholder="Search keys" />
        <FilterChip label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <div className="ml-auto">
          <PathBreadcrumb path={path} onNavigate={setPath} />
        </div>
      </div>
      {body}
    </>
  );
}

function MatrixCell({
  project,
  path,
  env,
  row,
}: {
  project: string;
  path: string;
  env: EnvironmentDto;
  row: Row;
}) {
  const cell = row.cells[env.slug] ?? null;
  const link = {
    to: "/projects/$project/environments/$env",
    params: { project, env: env.slug },
    search: path === "/" ? {} : { path },
  } as const;
  const focus =
    "inline-flex items-center align-middle rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-base";
  if (cell === null) {
    return (
      <Link {...link} className={focus} aria-label={`${row.key} in ${env.name}: missing`}>
        <StatusBadge status="warning">Missing</StatusBadge>
      </Link>
    );
  }
  return (
    <Tooltip content={`v${cell.version}, updated ${formatRelative(cell.updatedAt)}`}>
      <Link {...link} className={focus} aria-label={`${row.key} in ${env.name}: v${cell.version}`}>
        <RiCheckboxCircleFill aria-hidden className="size-4 text-success-base" />
      </Link>
    </Tooltip>
  );
}
