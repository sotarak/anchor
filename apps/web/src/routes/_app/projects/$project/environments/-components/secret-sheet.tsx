import { putSecretBodySchema, type SecretDto, secretKeySchema } from "@anchor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { FormSheet } from "@/components/overlays/form-sheet";
import { ResolvedPreview } from "@/components/references/resolved-preview";
import { SecretValueField } from "@/components/secrets/secret-value-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";

type Key = "key" | "value" | "comment";
const MESSAGES: Record<Key, string> = {
  key: "Use letters, digits and _; start with a letter or _",
  value: "Value is larger than 64 KiB",
  comment: "Keep the comment under 500 characters",
};
const CONFLICT = "This secret was changed elsewhere. Reload and try again.";

/**
 * Add or edit one secret. The value lives in this form's state only and is sent with a direct
 * call; an untouched value in edit mode is fetched at submit time and re-sent unchanged.
 */
export function SecretSheet({
  open,
  onOpenChange,
  secret,
  project,
  env,
  path,
  existingKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The secret being edited; absent when adding. */
  secret: SecretDto | null;
  project: string;
  env: string;
  path: string;
  existingKeys: string[];
}) {
  const editing = secret !== null;
  const queryClient = useQueryClient();
  const [key, setKey] = useState(secret?.key ?? "");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [comment, setComment] = useState(secret?.comment ?? "");
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const loadCurrent = async () => (await api.secrets.get(project, env, key, path)).value ?? "";

  // No mutation variables: the value never enters the mutation cache.
  const save = useMutation({
    mutationFn: async () => {
      const toSend = editing && !touched ? await loadCurrent() : value;
      return api.secrets.put(project, env, key, { value: toSend, comment, path });
    },
    onSuccess: async () => {
      toast.success("Secret saved");
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.secretsAll(project, env) }),
        queryClient.invalidateQueries({ queryKey: qk.overviewAll(project) }),
      ]);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 409) toast.error(CONFLICT);
      else if (e instanceof ApiClientError && e.status === 413)
        setErrors({ value: MESSAGES.value });
      else toast.error(errorMessage(e));
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate(putSecretBodySchema, { value, comment, path }, MESSAGES);
    if (!secretKeySchema.safeParse(key).success) next.key = MESSAGES.key;
    else if (!editing && existingKeys.includes(key)) {
      next.key = "A secret with this key already exists here";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${secret.key}` : "Add secret"}
      description={`Path ${path} in this environment only.`}
      submitLabel={editing ? "Save changes" : "Add secret"}
      pending={save.isPending}
      onSubmit={submit}
    >
      <Field htmlFor="secret-key" label="Key" error={errors.key}>
        <Input
          id="secret-key"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          autoFocus={!editing}
          readOnly={editing}
          disabled={editing}
          value={key}
          invalid={!!errors.key}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field htmlFor="secret-value" label="Value" error={errors.value}>
        <SecretValueField
          id="secret-value"
          mode={editing ? "edit" : "new"}
          value={value}
          touched={touched}
          invalid={!!errors.value}
          onChange={(v) => {
            setValue(v);
            setTouched(true);
          }}
          onLoadCurrent={editing ? loadCurrent : undefined}
        />
      </Field>
      {editing ? (
        <ResolvedPreview project={project} env={env} path={path} secretKey={secret.key} />
      ) : null}
      <Field htmlFor="secret-comment" label="Comment" hint="Optional" error={errors.comment}>
        <Textarea
          id="secret-comment"
          rows={2}
          value={comment}
          invalid={!!errors.comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
    </FormSheet>
  );
}
