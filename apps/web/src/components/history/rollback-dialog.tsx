import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { useRollback } from "./use-secret-history";

/** Confirms restoring `version` as a new version of the secret. */
export function RollbackDialog({
  target,
  version,
  onClose,
}: {
  target: { project: string; env: string; path: string; key: string };
  version: number | null;
  onClose: () => void;
}) {
  const rollback = useRollback(target);
  return (
    <ConfirmDialog
      open={version !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Roll back ${target.key} to v${version ?? ""}`}
      description={
        <>
          This saves the value and comment of v{version} as a new version of{" "}
          <span className="text-code-xs text-text-strong">{target.key}</span> at {target.path}.
          Every version stays in the history.
        </>
      }
      confirmLabel="Roll back"
      onConfirm={async () => {
        if (version === null) return;
        try {
          const { changed } = await rollback.mutateAsync(version);
          toast.success(changed ? `Rolled back to v${version}` : "Already at that content");
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      }}
    />
  );
}
