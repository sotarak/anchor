import type { FolderDto, SecretDto } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { RiAddLine, RiFolderAddLine, RiKey2Line } from "react-icons/ri";
import { toast } from "sonner";
import { useSetHeader } from "@/components/app-shell/header";
import { SearchChip } from "@/components/data/search-chip";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  FilteredEmptyState,
  ForbiddenState,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { DeleteFolderDialog } from "@/components/folders/delete-folder-dialog";
import { NewFolderSheet } from "@/components/folders/new-folder-sheet";
import { useFolders } from "@/components/folders/use-folders";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { GoToPathChip } from "@/components/secrets/go-to-path-chip";
import { PathBreadcrumb } from "@/components/secrets/path-breadcrumb";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SplitButton } from "@/components/ui/split-button";
import { TableContainer } from "@/components/ui/table";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { pathSearch } from "@/lib/search";
import { SecretSheet } from "./-components/secret-sheet";
import { SecretsTable } from "./-components/secrets-table";

export const Route = createFileRoute("/_app/projects/$project/environments/$env")({
  validateSearch: pathSearch,
  component: SecretsPage,
});

type SheetState = { mode: "add" } | { mode: "edit"; secret: SecretDto } | null;

function SecretsPage() {
  const { project, env } = Route.useParams();
  const path = Route.useSearch().path ?? "/";
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const envQuery = useQuery({
    queryKey: qk.environments(project),
    queryFn: () => api.environments.list(project),
  });
  const secrets = useQuery({
    queryKey: qk.secrets(project, env, path),
    queryFn: () => api.secrets.list(project, env, path),
  });
  const folders = useFolders(project, env, path);
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<SheetState>(null);
  const [deleting, setDeleting] = useState<SecretDto | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<FolderDto | null>(null);

  const envName = envQuery.data?.find((e) => e.slug === env)?.name ?? env;
  const projectName = projectQuery.data?.name;
  useSetHeader({ title: projectName ? `${projectName} · ${envName}` : "" });

  const access = projectQuery.data?.access;
  const canWrite =
    !!access &&
    access.role !== "viewer" &&
    (access.environments === null || access.environments.includes(env));

  type Row = { folder: FolderDto } | { secret: SecretDto };
  const filtered = useMemo((): Row[] => {
    const needle = search.trim().toLowerCase();
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    return [
      ...(folders.data ?? []).filter((f) => match(f.name)).map((folder) => ({ folder })),
      ...(secrets.data ?? []).filter((s) => match(s.key)).map((secret) => ({ secret })),
    ];
  }, [folders.data, secrets.data, search]);
  const page = useClientPages(filtered, 25);
  const pageFolders = page.rows.flatMap((r) => ("folder" in r ? [r.folder] : []));
  const pageSecrets = page.rows.flatMap((r) => ("secret" in r ? [r.secret] : []));
  const loaded = secrets.data && folders.data;
  const isEmpty = !!loaded && secrets.data.length === 0 && folders.data.length === 0;
  const error = secrets.error ?? folders.error;
  const setPath = (next: string) => void navigate({ search: next === "/" ? {} : { path: next } });

  const addButton = canWrite ? (
    <SplitButton
      onClick={() => setSheet({ mode: "add" })}
      menuLabel="More create options"
      menu={
        <DropdownMenuItem onSelect={() => setNewFolder(true)}>
          <RiFolderAddLine aria-hidden />
          New folder
        </DropdownMenuItem>
      }
    >
      <RiAddLine aria-hidden />
      Add secret
    </SplitButton>
  ) : null;

  let body: ReactNode;
  if (error instanceof ApiClientError && error.status === 403) {
    body = <ForbiddenState what="this environment" />;
  } else if (error) {
    body = (
      <ErrorState
        error={error}
        onRetry={() => void Promise.all([secrets.refetch(), folders.refetch()])}
      />
    );
  } else if (isEmpty) {
    body = (
      <EmptyState
        icon={RiKey2Line}
        title={`No secrets or folders in ${path}`}
        description={
          canWrite
            ? "Add the first secret or folder at this path, or pick another path."
            : "There is nothing at this path yet."
        }
        action={addButton}
      />
    );
  } else if (loaded && filtered.length === 0) {
    body = <FilteredEmptyState what="your search" onClear={() => setSearch("")} />;
  } else {
    body = (
      <TableContainer>
        <SecretsTable
          // A new env or path remounts every row: nothing revealed survives navigation.
          key={`${env}:${path}`}
          project={project}
          env={env}
          path={path}
          folders={pageFolders}
          secrets={pageSecrets}
          loading={!loaded}
          canWrite={canWrite}
          onEdit={(secret) => setSheet({ mode: "edit", secret })}
          onDelete={setDeleting}
          onOpenFolder={(f) => setPath(f.path)}
          onDeleteFolder={setDeletingFolder}
        />
        {loaded ? <TableFooter {...page.footer} /> : null}
      </TableContainer>
    );
  }

  async function remove(secret: SecretDto) {
    try {
      await api.secrets.remove(project, env, secret.key, path);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Secret deleted");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.secretsAll(project, env) }),
      queryClient.invalidateQueries({ queryKey: qk.overviewAll(project) }),
    ]);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchChip value={search} onChange={setSearch} placeholder="Search keys" />
        <GoToPathChip onGo={setPath} />
        <PathBreadcrumb path={path} onNavigate={setPath} />
        <div className="ml-auto">{isEmpty ? null : addButton}</div>
      </div>
      <h2 className="text-paragraph-sm text-text-soft">{`Secrets in ${path}`}</h2>
      {body}
      {sheet ? (
        <SecretSheet
          key={sheet.mode === "edit" ? sheet.secret.key : "add"}
          open
          onOpenChange={(open) => !open && setSheet(null)}
          secret={sheet.mode === "edit" ? sheet.secret : null}
          project={project}
          env={env}
          path={path}
          existingKeys={(secrets.data ?? []).map((s) => s.key)}
        />
      ) : null}
      {newFolder ? (
        <NewFolderSheet
          open
          onOpenChange={setNewFolder}
          project={project}
          env={env}
          parent={path}
        />
      ) : null}
      <DeleteFolderDialog
        folder={deletingFolder}
        onClose={() => setDeletingFolder(null)}
        project={project}
        env={env}
        envName={envName}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete secret ${deleting?.key ?? ""}`}
        description={
          <>
            This deletes <span className="text-code-xs text-text-strong">{deleting?.key}</span> from{" "}
            {envName} at {path}, with its history. Other environments keep their own copies.
          </>
        }
        confirmLabel="Delete secret"
        destructive
        onConfirm={() => (deleting ? remove(deleting) : Promise.resolve())}
      />
    </>
  );
}
