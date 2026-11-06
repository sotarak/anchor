import { useState } from "react";
import { RiEyeLine, RiEyeOffLine } from "react-icons/ri";
import { errorMessage } from "@/components/data/table-states";
import { MASK } from "@/components/secrets/masked-value";
import { Button } from "@/components/ui/button";
import { FieldHint, Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

type State =
  | { kind: "masked" }
  | { kind: "loading" }
  | { kind: "shown"; value: string; expanded: boolean }
  | { kind: "error"; message: string };

/**
 * The saved secret with its references expanded. Masked until asked for; the expanded value
 * lives in this component's state only. A 400/403 shows only the server's message.
 */
export function ResolvedPreview({
  project,
  env,
  path,
  secretKey,
}: {
  project: string;
  env: string;
  path: string;
  secretKey: string;
}) {
  const [state, setState] = useState<State>({ kind: "masked" });

  async function show() {
    setState({ kind: "loading" });
    try {
      const secret = await api.secrets.get(project, env, secretKey, path, { expand: true });
      setState({
        kind: "shown",
        value: secret.value ?? "",
        expanded: secret.rawValue !== undefined,
      });
    } catch (e) {
      const known = e instanceof ApiClientError && (e.status === 400 || e.status === 403);
      setState({ kind: "error", message: known ? e.message : errorMessage(e) });
    }
  }

  const shown = state.kind === "shown";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label>Resolved value</Label>
        <Button
          variant="ghost"
          size="2xs"
          disabled={state.kind === "loading"}
          onClick={() => (shown ? setState({ kind: "masked" }) : void show())}
        >
          {shown ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
          {shown ? "Hide resolved value" : "Show resolved value"}
        </Button>
      </div>
      <span className="whitespace-pre-wrap break-all text-code-xs text-text-sub">
        {shown ? state.value : MASK}
      </span>
      {state.kind === "error" ? (
        <p className="text-paragraph-xs text-error-base">{state.message}</p>
      ) : shown && !state.expanded ? (
        <FieldHint>The saved value has no references.</FieldHint>
      ) : (
        <FieldHint>The saved value with references expanded.</FieldHint>
      )}
    </div>
  );
}
