import { useState } from "react";
import { RiBracesLine, RiCodeLine } from "react-icons/ri";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { MaskedValue } from "@/components/secrets/masked-value";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { hasReferences, ReferenceText } from "./reference-text";

/**
 * A table value cell: masked, then the stored value with reference chips, then (on request)
 * the resolved value. Hiding drops both from state.
 */
export function ReferenceValue({
  project,
  env,
  path,
  secretKey,
  importedFrom,
}: {
  project: string;
  env: string;
  path: string;
  secretKey: string;
  /** Set for a row composed from an import: read through the import, chips relative to it. */
  importedFrom?: { environment: string; path: string };
}) {
  const read = { includeImports: importedFrom ? true : undefined };
  const [resolved, setResolved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      const s = await api.secrets.get(project, env, secretKey, path, { ...read, expand: true });
      setResolved(s.value ?? "");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MaskedValue
      reveal={async () => (await api.secrets.get(project, env, secretKey, path, read)).value ?? ""}
      onHide={() => setResolved(null)}
      render={(v) =>
        resolved ?? (
          <ReferenceText
            value={v}
            env={importedFrom?.environment ?? env}
            path={importedFrom?.path ?? path}
          />
        )
      }
      actions={(v) =>
        hasReferences(v) ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={resolved === null ? "Show resolved value" : "Show stored value"}
            disabled={busy}
            onClick={() => (resolved === null ? void resolve() : setResolved(null))}
          >
            {resolved === null ? <RiBracesLine aria-hidden /> : <RiCodeLine aria-hidden />}
          </Button>
        ) : null
      }
    />
  );
}
