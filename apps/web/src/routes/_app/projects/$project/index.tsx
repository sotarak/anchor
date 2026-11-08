import type { EnvironmentDto, OverviewDto } from "@anchor/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { RiCheckboxCircleFill, RiFolder3Line, RiKey2Line } from "react-icons/ri";
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
type Folder = OverviewDto["folders"][number];
/** One table row: the path's subfolders first, then its keys. */
type Item = { kind: "folder"; folder: Folder } | { kind: "key"; row: Row };

const itemName = (item: Item) => (item.kind === "folder" ? item.folder.name : item.row.key);

function isComplete(item: Item) {
  return item.kind === "folder"
    ? Object.values(item.folder.environments).every(Boolean)
    : Object.values(item.row.cells).every((c) => c !== null);
}

function matches(item: Item, search: string, status: StatusFilter[]) {
  const needle = search.trim().toLowerCase();
  if (needle && !itemName(item).toLowerCase().includes(needle)) return false;
  if (status.length === 0 || status.length === STATUS_OPTIONS.length) return true;
  return status.includes(isComplete(item) ? "complete" : "missing");
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
  const items = useMemo<Item[]>(
    () => [
      ...(overview.data?.folders ?? []).map((folder) => ({ kind: "folder" as const, folder })),
      ...(overview.data?.keys ?? []).map((row) => ({ kind: "key" as const, row })),
    ],
    [overview.data],
  );
  const filtered = useMemo(
    () => items.filter((item) => matches(item, keySearch, status)),
    [items, keySearch, status],
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
  } else if (overview.data && items.length === 0) {
    body = (
      <EmptyState
        icon={RiKey2Line}
        title={path === "/" ? "Nothing in this project yet" : `Nothing in ${path} yet`}
        description="Secrets and folders you add to any environment show up here, one row per key or folder."
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
              page.rows.map((item) =>
                item.kind === "folder" ? (
                  <FolderRow
                    key={`folder:${item.folder.path}`}
                    folder={item.folder}
                    environments={environments}
                    onOpen={() => {
                      // A filter that found this folder rarely matches what is inside it.
                      clearFilters();
                      setPath(item.folder.path);
                    }}
                  />
                ) : (
                  <TableRow key={item.row.key}>
                    <TableCell primary>
                      <span className="flex items-center gap-2">
                        <RiKey2Line aria-hidden className="size-4 shrink-0 text-text-soft" />
                        {item.row.key}
                      </span>
                    </TableCell>
                    {environments.map((e) => (
                      <TableCell key={e.slug}>
                        <MatrixCell project={project} path={path} env={e} row={item.row} />
                      </TableCell>
                    ))}
                  </TableRow>
                ),
              )
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

/** A subfolder of the path: a click (or its name, from the keyboard) opens it here. */
function FolderRow({
  folder,
  environments,
  onOpen,
}: {
  folder: Folder;
  environments: EnvironmentDto[];
  onOpen: () => void;
}) {
  return (
    <TableRow clickable onClick={onOpen}>
      <TableCell primary>
        <span className="flex items-center gap-2">
          <RiFolder3Line aria-hidden className="size-4 shrink-0 text-text-soft" />
          <button
            type="button"
            className="min-w-0 truncate text-left outline-none focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {folder.name}
          </button>
        </span>
      </TableCell>
      {environments.map((e) => (
        <TableCell key={e.slug}>
          {folder.environments[e.slug] ? (
            <RiCheckboxCircleFill
              role="img"
              aria-label={`${folder.name} in ${e.name}: present`}
              className="size-4 text-success-base"
            />
          ) : (
            <StatusBadge status="warning" aria-label={`${folder.name} in ${e.name}: missing`}>
              Missing
            </StatusBadge>
          )}
        </TableCell>
      ))}
    </TableRow>
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
