import { type EnvironmentDto, secretPathSchema } from "@anchor/shared";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { FormSheet } from "@/components/overlays/form-sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiClientError } from "@/lib/api/client";
import { useCreateImport } from "./use-imports";

type Errors = { environment?: string; path?: string; server?: string };
const PATH_ERROR = "Use /folder/sub with letters, digits, '_' or '-'";

export function AddImportSheet({
  open,
  onOpenChange,
  project,
  env,
  path,
  environments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  env: string;
  path: string;
  environments: EnvironmentDto[];
}) {
  const [environment, setEnvironment] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const create = useCreateImport(project, env);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Errors = {};
    if (!environment) next.environment = "Pick the environment to import from";
    const parsed = secretPathSchema.safeParse(sourcePath.trim());
    if (!sourcePath.trim() || !parsed.success) next.path = PATH_ERROR;
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;
    create.mutate(
      { path, source: { environment, path: parsed.data } },
      {
        onSuccess: () => {
          toast.success("Import added");
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiClientError && (err.status === 400 || err.status === 409)) {
            setErrors({ server: err.message });
          } else toast.error(errorMessage(err));
        },
      },
    );
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add import"
      description={`Secrets of the source folder appear at ${path}. Keys defined here win.`}
      submitLabel="Add import"
      pending={create.isPending}
      onSubmit={submit}
    >
      <Field htmlFor="import-env" label="Source environment" error={errors.environment}>
        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger id="import-env" aria-label="Source environment">
            <SelectValue placeholder="Choose an environment" />
          </SelectTrigger>
          <SelectContent>
            {environments.map((e) => (
              <SelectItem key={e.slug} value={e.slug}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field
        htmlFor="import-path"
        label="Source path"
        hint="The folder to import, e.g. /shared"
        error={errors.path ?? errors.server}
      >
        <Input
          id="import-path"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="/shared"
          value={sourcePath}
          invalid={!!(errors.path ?? errors.server)}
          onChange={(e) => setSourcePath(e.target.value)}
        />
      </Field>
    </FormSheet>
  );
}
