import type { KeyRotationDto, ProjectKeyDto } from "@anchor/shared";
import { type ReactNode, useState } from "react";
import { RiHistoryLine, RiRefreshLine } from "react-icons/ri";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  ForbiddenState,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { Button } from "@/components/ui/button";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiClientError } from "@/lib/api/client";
import { formatDate, formatRelative } from "@/lib/format";
import { useProjectKeys, useRotateKey } from "./use-project-keys";

const KEY_STATUS: Record<ProjectKeyDto["status"], { status: Status; label: string }> = {
  active: { status: "success", label: "Active" },
  retiring: { status: "warning", label: "Retiring" },
  retired: { status: "neutral", label: "Retired" },
};

function rotationBadge(r: KeyRotationDto): { status: Status; label: string } {
  if (r.status === "running") return { status: "info", label: `Running ${r.done} of ${r.total}` };
  if (r.status === "completed") return { status: "success", label: "Completed" };
  return { status: "error", label: `Failed: ${r.error ?? "unknown"}` };
}

const DateCell = ({ at }: { at: number }) => (
  <TableCell className="text-paragraph-sm">
    <Tooltip content={formatRelative(at)}>
      <span>{formatDate(at)}</span>
    </Tooltip>
  </TableCell>
);

/**
 * Project key (KEK) versions and rotations. Reading it needs project admin rights (the API
 * answers 403 otherwise), so a loaded page implies the caller may rotate.
 */
export function EncryptionSection({ project }: { project: string }) {
  const status = useProjectKeys(project);
  const rotate = useRotateKey(project);
  const [confirming, setConfirming] = useState(false);
  const running = status.data?.rotations[0]?.status === "running";

  if (status.error instanceof ApiClientError && status.error.status === 403) {
    return <ForbiddenState what="this project's encryption settings" />;
  }
  if (status.isError) {
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  }

  let rotations: ReactNode;
  if (status.data && status.data.rotations.length === 0) {
    rotations = (
      <EmptyState
        icon={RiHistoryLine}
        title="No rotations yet"
        description="Rotating creates a new key version and re-encrypts every value with it."
      />
    );
  } else {
    rotations = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rotation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.isPending ? (
              <TableSkeletonRows columns={["14ch", "14ch", "14ch"]} rows={2} />
            ) : (
              status.data.rotations.map((r) => {
                const badge = rotationBadge(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell primary>{`v${r.fromVersion} → v${r.toVersion}`}</TableCell>
                    <TableCell>
                      <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
                    </TableCell>
                    <DateCell at={r.startedAt} />
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-paragraph-sm text-text-soft">Key versions</h2>
        {status.data ? (
          <Button
            className="ml-auto"
            disabled={rotate.isPending}
            onClick={() => setConfirming(true)}
          >
            <RiRefreshLine aria-hidden />
            {running ? "Resume rotation" : "Rotate key"}
          </Button>
        ) : null}
      </div>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Root key</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {status.isPending ? (
              <TableSkeletonRows columns={["8ch", "14ch", "8ch", "14ch"]} rows={2} />
            ) : (
              status.data.keys.map((k) => (
                <TableRow key={k.version}>
                  <TableCell primary>{`v${k.version}`}</TableCell>
                  <TableCell>
                    <StatusBadge status={KEY_STATUS[k.status].status}>
                      {KEY_STATUS[k.status].label}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-code-xs text-text-sub">{k.rootKeyId}</TableCell>
                  <DateCell at={k.createdAt} />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <h2 className="text-paragraph-sm text-text-soft">Rotations</h2>
      {rotations}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={running ? "Resume the key rotation" : "Rotate the project key"}
        description={
          running
            ? "The running rotation continues from where it stopped. Values stay readable."
            : "A new key version encrypts new writes, and every stored value is re-encrypted in the background. Values stay readable the whole time; the old key is retired when it finishes."
        }
        confirmLabel={running ? "Resume rotation" : "Rotate key"}
        onConfirm={async () => {
          try {
            await rotate.mutateAsync();
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
          toast.success(running ? "Key rotation resumed" : "Key rotation started");
        }}
      />
    </>
  );
}
