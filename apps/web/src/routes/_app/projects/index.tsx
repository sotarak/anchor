import { createProjectBodySchema, type ProjectDto } from "@anchor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { RiAddLine, RiFolder3Line } from "react-icons/ri";
import { useSetHeader } from "@/components/app-shell/header";
import { SearchChip } from "@/components/data/search-chip";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  FilteredEmptyState,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { FormSheet } from "@/components/overlays/form-sheet";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { meQueryOptions } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { deriveSlug } from "@/lib/slug";
import { roleLabel } from "@/lib/status";

export const Route = createFileRoute("/_app/projects/")({
  component: ProjectsPage,
});

const COLUMNS = ["24ch", "8ch", "14ch"] as const;

function matches(p: ProjectDto, q: string) {
  const needle = q.trim().toLowerCase();
  return needle === "" || p.name.toLowerCase().includes(needle) || p.slug.includes(needle);
}

function ProjectsPage() {
  const { data: me } = useQuery(meQueryOptions);
  const canCreate = me?.role === "owner" || me?.role === "admin";
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const projects = useQuery({ queryKey: qk.projects, queryFn: api.projects.list });
  const navigate = useNavigate();

  const newButton = canCreate ? (
    <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
      <RiAddLine aria-hidden />
      New project
    </Button>
  ) : null;
  useSetHeader({ title: "Projects" });

  const filtered = useMemo(
    () => (projects.data ?? []).filter((p) => matches(p, search)),
    [projects.data, search],
  );
  const page = useClientPages(filtered);

  let body: ReactNode;
  if (projects.isError) {
    body = <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
  } else if (projects.data?.length === 0) {
    body = canCreate ? (
      <EmptyState
        icon={RiFolder3Line}
        title="No projects yet"
        description="A project holds the secrets of one app or service, split by environment."
        action={newButton}
      />
    ) : (
      <EmptyState
        icon={RiFolder3Line}
        title="No projects yet"
        description="Ask an instance admin to add you to a project."
      />
    );
  } else if (projects.data && filtered.length === 0) {
    body = <FilteredEmptyState what="your search" onClear={() => setSearch("")} />;
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Your role</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.isPending ? (
              <TableSkeletonRows columns={[...COLUMNS]} />
            ) : (
              page.rows.map((p) => (
                <TableRow
                  key={p.id}
                  clickable
                  onClick={() =>
                    void navigate({ to: "/projects/$project", params: { project: p.slug } })
                  }
                >
                  <TableCell primary>
                    <div className="flex items-center gap-2">
                      <RiFolder3Line aria-hidden className="size-4 shrink-0 text-text-soft" />
                      <div className="flex min-w-0 flex-col">
                        {/* The name is the keyboard target; the whole row is the mouse target. */}
                        <Link
                          to="/projects/$project"
                          params={{ project: p.slug }}
                          onClick={(e) => e.stopPropagation()}
                          className="truncate outline-none focus-visible:underline"
                        >
                          {p.name}
                        </Link>
                        <span className="text-code-xs text-text-soft">{p.slug}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.access ? (
                      <Tag>{roleLabel(p.access.role)}</Tag>
                    ) : (
                      <span className="text-text-soft">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-paragraph-sm">
                    <Tooltip content={formatRelative(p.createdAt)}>
                      <span>{formatDate(p.createdAt)}</span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {projects.data ? <TableFooter {...page.footer} /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SearchChip value={search} onChange={setSearch} placeholder="Search projects" />
        {/* The empty state carries the button itself: one primary action per page, and no
            button that appears while loading only to vanish when the list turns out empty. */}
        {projects.isPending || projects.data?.length === 0 ? null : newButton}
      </div>
      {body}
      {canCreate ? (
        <CreateProjectSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={(p) =>
            void navigate({ to: "/projects/$project", params: { project: p.slug } })
          }
        />
      ) : null}
    </>
  );
}

type Key = "name" | "slug";
const MESSAGES: Record<Key, string> = {
  name: "Enter a name (up to 64 characters)",
  slug: "Use lowercase letters, digits and dashes (up to 63, starting with a letter or digit)",
};

function CreateProjectSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (p: ProjectDto) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const create = useMutation({
    mutationFn: api.projects.create,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: qk.projects });
      close(false);
      onCreated(project);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 409) {
        setErrors({ slug: "Slug already in use" });
      }
    },
  });

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setName("");
      setSlug("");
      setSlugEdited(false);
      setErrors({});
      create.reset();
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { name: name.trim(), slug };
    const next = validate(createProjectBodySchema, body, MESSAGES);
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate(body);
  }

  const conflict = create.error instanceof ApiClientError && create.error.status === 409;
  return (
    <FormSheet
      open={open}
      onOpenChange={close}
      title="New project"
      description="Projects start with the dev, staging and prod environments."
      submitLabel="Create project"
      pending={create.isPending}
      onSubmit={submit}
    >
      {create.isError && !conflict ? (
        <Callout tone="error">{errorMessage(create.error)}</Callout>
      ) : null}
      <Field htmlFor="project-name" label="Name" error={errors.name}>
        <Input
          id="project-name"
          autoFocus
          value={name}
          invalid={!!errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(deriveSlug(e.target.value));
          }}
        />
      </Field>
      <Field
        htmlFor="project-slug"
        label="Slug"
        hint="Used in URLs and by the CLI. Cannot be changed later."
        error={errors.slug}
      >
        <Input
          id="project-slug"
          className="font-mono"
          value={slug}
          invalid={!!errors.slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
        />
      </Field>
    </FormSheet>
  );
}
