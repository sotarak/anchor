import { type RefTarget, tokenizeValue } from "@anchor/shared";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";

/** `env:path/KEY` of a reference; a same-folder `${KEY}` resolves against `env` and `path`. */
export function referenceTarget(t: RefTarget, env?: string, path?: string): string {
  const environment = t.environment ?? env;
  const folder = t.environment === null ? path : t.path;
  if (!environment || !folder) return t.key;
  return `${environment}:${folder === "/" ? "" : folder}/${t.key}`;
}

/** True when the value contains at least one reference (escapes do not count). */
export function hasReferences(value: string): boolean {
  return tokenizeValue(value).some((t) => t.type === "ref");
}

/**
 * A stored value with its references as path/key chips (tooltip: the target). `$${` shows as a
 * literal `${`. `env` and `path` are where the value is stored, for same-folder references.
 */
export function ReferenceText({
  value,
  env,
  path,
}: {
  value: string;
  env?: string;
  path?: string;
}) {
  return (
    <span className="whitespace-pre-wrap break-all text-code-xs">
      {tokenizeValue(value).map((t, i) =>
        t.type === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens of one immutable string
          <span key={i}>{t.text}</span>
        ) : (
          <Tooltip key={t.start} content={referenceTarget(t.target, env, path)}>
            <Tag tone="neutral" tabIndex={0} className="mx-px align-baseline">
              {t.raw}
            </Tag>
          </Tooltip>
        ),
      )}
    </span>
  );
}
