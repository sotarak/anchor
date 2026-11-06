import { createFolderBodySchema } from "@anchor/shared";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { FormSheet } from "@/components/overlays/form-sheet";
import { Input } from "@/components/ui/input";
import { useCreateFolder } from "./use-folders";

const INVALID = "Use letters, digits, '_' or '-', separated by '/'";

/** `name` is relative to `parent`: "v2" or "v2/beta" inside /api. Undefined when not a path. */
export function childPath(parent: string, name: string): string | undefined {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return undefined;
  const path = parent === "/" ? `/${trimmed}` : `${parent}/${trimmed}`;
  return createFolderBodySchema.safeParse({ path }).success ? path : undefined;
}

export function NewFolderSheet({
  open,
  onOpenChange,
  project,
  env,
  parent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  env: string;
  parent: string;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const create = useCreateFolder(project, env);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const path = childPath(parent, name);
    if (!path) {
      setError(INVALID);
      return;
    }
    setError(undefined);
    create.mutate(path, {
      onSuccess: () => {
        toast.success("Folder created");
        onOpenChange(false);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New folder"
      description={`Created inside ${parent}.`}
      submitLabel="Create folder"
      pending={create.isPending}
      onSubmit={submit}
    >
      <Field
        htmlFor="folder-name"
        label="Name"
        hint="Nested names like v2/beta create both folders."
        error={error}
      >
        <Input
          id="folder-name"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={name}
          invalid={!!error}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </FormSheet>
  );
}
