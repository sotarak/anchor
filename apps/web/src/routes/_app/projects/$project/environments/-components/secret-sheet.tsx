import {
  checkTypedValue,
  putSecretBodySchema,
  SECRET_VALUE_TYPES,
  type SecretDto,
  type SecretValueType,
  secretKeySchema,
} from "@anchor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { RiEyeLine, RiPencilLine } from "react-icons/ri";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { FormSheet } from "@/components/overlays/form-sheet";
import { ResolvedPreview } from "@/components/references/resolved-preview";
import { TypedValueEditor } from "@/components/secrets/typed-value-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { jsonProblem, TYPE_META } from "@/lib/typed-value";

type Key = "key" | "value" | "comment";
const MESSAGES: Record<Key, string> = {
  key: "Use letters, digits and _; start with a letter or _",
  value: "Value is larger than 64 KiB",
  comment: "Keep the comment under 500 characters",
};
const CONFLICT = "This secret was changed elsewhere. Reload and try again.";
const TYPE_ERROR = "value is not valid for type ";

/** Why `value` is not valid text of `type`, or undefined. JSON names the parser's position. */
function typeProblem(type: SecretValueType, value: string): string | undefined {
  if (type === "json") return jsonProblem(value) ?? undefined;
  const check = checkTypedValue(type, value);
  return check.ok ? undefined : check.reason;
}

/** The reason of a server type rejection ("value is not valid for type json: not valid JSON"). */
function typeReason(e: unknown): string | null {
  if (!(e instanceof ApiClientError) || e.status !== 400 || !e.message.startsWith(TYPE_ERROR)) {
    return null;
  }
  return e.message.slice(e.message.lastIndexOf(": ") + 2);
}

/**
 * Add or edit one secret. The value lives in this form's state only and is sent with a direct
 * call. In edit mode the value starts as a closed "Value unchanged" row: saving then fetches the
 * stored value at submit time and re-sends it unchanged.
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
  // "closed": keep the stored value (edit mode only); "open": send what the editor holds.
  const [valueMode, setValueMode] = useState<"closed" | "open">(editing ? "closed" : "open");
  // Type errors show once the editor has lost focus or the form was submitted.
  const [checkValue, setCheckValue] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [comment, setComment] = useState(secret?.comment ?? "");
  const [type, setType] = useState<SecretValueType>(secret?.type ?? "string");
  const [sensitive, setSensitive] = useState(secret?.sensitive ?? true);
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const loadCurrent = async () => (await api.secrets.get(project, env, key, path)).value ?? "";

  // No mutation variables: the value never enters the mutation cache.
  const save = useMutation({
    mutationFn: async () => {
      const toSend = valueMode === "closed" ? await loadCurrent() : value;
      return api.secrets.put(project, env, key, { value: toSend, comment, path, type, sensitive });
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
      const reason = typeReason(e);
      // An untouched value re-sent under a new type is only checked by the server.
      if (reason) setErrors({ value: reason });
      else if (e instanceof ApiClientError && e.status === 409) toast.error(CONFLICT);
      else if (e instanceof ApiClientError && e.status === 413)
        setErrors({ value: MESSAGES.value });
      else toast.error(errorMessage(e));
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate(putSecretBodySchema, { value, comment, path }, MESSAGES);
    const open = valueMode === "open";
    if (!next.value && open) {
      const problem = typeProblem(type, value);
      if (problem) next.value = problem;
    }
    setCheckValue(open);
    if (!secretKeySchema.safeParse(key).success) next.key = MESSAGES.key;
    else if (!editing && existingKeys.includes(key)) {
      next.key = "A secret with this key already exists here";
    }
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  function changeValue(v: string) {
    setValue(v);
    setErrors(({ value: _, ...rest }) => rest);
  }

  async function reveal() {
    setRevealing(true);
    try {
      changeValue(await loadCurrent());
      setValueMode("open");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRevealing(false);
    }
  }

  function setClosed(mode: "closed" | "open") {
    setValueMode(mode);
    changeValue("");
    setCheckValue(false);
  }

  const liveProblem = checkValue && valueMode === "open" ? typeProblem(type, value) : undefined;
  const valueError = errors.value ?? liveProblem;

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
      <Field htmlFor="secret-type" label="Type">
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v as SecretValueType);
            setErrors(({ value: _, ...rest }) => rest);
          }}
        >
          <SelectTrigger id="secret-type" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECRET_VALUE_TYPES.map((t) => (
              <SelectItem key={t} value={t} description={TYPE_META[t].help}>
                {TYPE_META[t].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field htmlFor="secret-value" label="Value" error={valueError}>
        {valueMode === "closed" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-weak px-3 py-2">
            <span className="text-paragraph-sm text-text-sub">Value unchanged</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="2xs" disabled={revealing} onClick={reveal}>
                <RiEyeLine aria-hidden />
                Reveal current value
              </Button>
              <Button variant="ghost" size="2xs" onClick={() => setClosed("open")}>
                <RiPencilLine aria-hidden />
                Replace value
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <TypedValueEditor
              key={type}
              id="secret-value"
              type={type}
              value={value}
              invalid={!!valueError}
              onChange={changeValue}
              onBlur={() => setCheckValue(true)}
            />
            {editing ? (
              <Button
                variant="ghost"
                size="2xs"
                className="self-start"
                onClick={() => setClosed("closed")}
              >
                Keep current value
              </Button>
            ) : null}
          </div>
        )}
      </Field>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="secret-sensitive" className="text-label-sm text-text-strong">
            Sensitive
          </label>
          <p className="text-paragraph-xs text-text-soft">
            Hidden in lists until revealed. Turn off for plain config such as ports or feature
            flags.
          </p>
        </div>
        <Switch id="secret-sensitive" checked={sensitive} onCheckedChange={setSensitive} />
      </div>
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
