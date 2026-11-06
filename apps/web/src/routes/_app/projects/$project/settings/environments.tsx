import {
  createEnvironmentBodySchema,
  type EnvironmentDto,
  updateEnvironmentBodySchema,
} from "@anchor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { RiAddLine, RiDeleteBinLine, RiMore2Fill, RiPencilLine, RiStackLine } from "react-icons/ri";
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
import { type FieldErrors, validate } from "@/components/forms/validate";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { FormSheet } from "@/components/overlays/form-sheet";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { cn } from "@/lib/cn";
import { deriveSlug } from "@/lib/slug";
import { environmentTone, TONE_TILE } from "@/lib/status";

export const Route = createFileRoute("/_app/projects/$project/settings/environments")({
  component: EnvironmentsPage,
});

type SheetState = { mode: "create" } | { mode: "rename"; env: EnvironmentDto } | null;

function EnvironmentsPage() {
  const { project } = Route.useParams();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: qk.project(project),
    queryFn: () => api.projects.get(project),
  });
  const envs = useQuery({
    queryKey: qk.environments(project),
    queryFn: () => api.environments.list(project),
  });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [deleting, setDeleting] = useState<EnvironmentDto | null>(null);
  useSetHeader({ title: "Environments" });

  const isAdmin = projectQuery.data?.access?.role === "admin";
  const sorted = useMemo(
    () => [...(envs.data ?? [])].sort((a, b) => a.position - b.position),
    [envs.data],
  );
  const page = useClientPages(sorted);
  // qk.project is a prefix of the project's environments, overview and secrets keys.
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.project(project) });

  const newButton = isAdmin ? (
    <Button variant="primary" size="sm" onClick={() => setSheet({ mode: "create" })}>
      <RiAddLine aria-hidden />
      New environment
    </Button>
  ) : null;

  async function remove(env: EnvironmentDto) {
    try {
      await api.environments.remove(project, env.slug);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("Environment deleted");
    await refresh();
  }

  let body: ReactNode;
  if (envs.isError) {
    body = <ErrorState error={envs.error} onRetry={() => void envs.refetch()} />;
  } else if (envs.data?.length === 0) {
    body = (
      <EmptyState
        icon={RiStackLine}
        title="No environments"
        description="Environments split a project's secrets, for example dev, staging and prod."
        action={newButton}
      />
    );
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Environment</TableHead>
              <TableHead>Position</TableHead>
              {isAdmin ? (
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {envs.isPending ? (
              <TableSkeletonRows columns={["24ch", "8ch"]} />
            ) : (
              page.rows.map((env) => (
                <TableRow key={env.id}>
                  <TableCell primary>
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-4",
                          TONE_TILE[environmentTone(env.slug)],
                        )}
                      >
                        <RiStackLine aria-hidden />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{env.name}</span>
                        <span className="text-code-xs text-text-soft">{env.slug}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-paragraph-sm">{env.position + 1}</TableCell>
                  {isAdmin ? (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Actions for ${env.name}`}
                          >
                            <RiMore2Fill aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setSheet({ mode: "rename", env })}>
                            <RiPencilLine aria-hidden />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={() => setDeleting(env)}>
                            <RiDeleteBinLine aria-hidden />
                            Delete
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
        {envs.data ? <TableFooter {...page.footer} label="environments" /> : null}
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {envs.isPending || envs.data?.length === 0 ? null : newButton}
      </div>
      {body}
      {sheet ? (
        <EnvironmentSheet
          key={sheet.mode === "rename" ? sheet.env.id : "create"}
          project={project}
          env={sheet.mode === "rename" ? sheet.env : null}
          onClose={() => setSheet(null)}
          onSaved={refresh}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete environment ${deleting?.name ?? ""}`}
        description={`Deletes every secret in ${deleting?.name ?? ""}, with its history. Service tokens scoped to it stop working there. This cannot be undone.`}
        confirmLabel="Delete environment"
        destructive
        onConfirm={() => (deleting ? remove(deleting) : Promise.resolve())}
      />
    </>
  );
}

type Key = "name" | "slug";
const MESSAGES: Record<Key, string> = {
  name: "Enter a name (up to 64 characters)",
  slug: "Use lowercase letters, digits and dashes (up to 63, starting with a letter or digit)",
};

/** Create (name + slug) or rename (name only) one environment. */
function EnvironmentSheet({
  project,
  env,
  onClose,
  onSaved,
}: {
  project: string;
  env: EnvironmentDto | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const renaming = env !== null;
  const [name, setName] = useState(env?.name ?? "");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const save = useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      env
        ? api.environments.update(project, env.slug, { name: body.name })
        : api.environments.create(project, body),
    onSuccess: async () => {
      toast.success(renaming ? "Environment renamed" : "Environment created");
      onClose();
      await onSaved();
    },
    onError: (e) => {
      if (!renaming && e instanceof ApiClientError && e.status === 409) {
        setErrors({ slug: "Slug already in use" });
      }
    },
  });
  const slugConflict = save.error instanceof ApiClientError && save.error.status === 409;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { name: name.trim(), slug };
    const next = renaming
      ? validate(updateEnvironmentBodySchema, body, MESSAGES)
      : validate(createEnvironmentBodySchema, body, MESSAGES);
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate(body);
  }

  return (
    <FormSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={renaming ? `Rename ${env.name}` : "New environment"}
      description={
        renaming
          ? "The slug stays the same, so the CLI and service tokens keep working."
          : "A new, empty environment. Add secrets to it afterwards."
      }
      submitLabel={renaming ? "Save changes" : "Create environment"}
      pending={save.isPending}
      onSubmit={submit}
    >
      {save.isError && !(slugConflict && !renaming) ? (
        <Callout tone="error">{errorMessage(save.error)}</Callout>
      ) : null}
      <Field htmlFor="env-name" label="Name" error={errors.name}>
        <Input
          id="env-name"
          autoFocus
          value={name}
          invalid={!!errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!renaming && !slugEdited) setSlug(deriveSlug(e.target.value));
          }}
        />
      </Field>
      {renaming ? null : (
        <Field
          htmlFor="env-slug"
          label="Slug"
          hint="Used by the CLI and service tokens. Cannot be changed later."
          error={errors.slug}
        >
          <Input
            id="env-slug"
            className="font-mono"
            value={slug}
            invalid={!!errors.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
          />
        </Field>
      )}
    </FormSheet>
  );
}
