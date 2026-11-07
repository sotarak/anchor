import type { SecretDto } from "@anchor/shared";
import { type ReactNode, useState } from "react";
import { RiHistoryLine } from "react-icons/ri";
import { EmptyState, ErrorState, TableSkeletonRows } from "@/components/data/table-states";
import { MaskedValue } from "@/components/secrets/masked-value";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { api } from "@/lib/api/endpoints";
import { formatDate, formatRelative } from "@/lib/format";
import { RollbackDialog } from "./rollback-dialog";
import { useSecretVersions } from "./use-secret-history";

const NONE = <span className="text-text-soft">–</span>;

/**
 * Every version of one secret. Values stay masked; a reveal fetches that one version's value
 * into the row's MaskedValue state only. Rolling back needs write access.
 */
export function SecretHistorySheet({
  project,
  env,
  path,
  secret,
  canWrite,
  onOpenChange,
}: {
  project: string;
  env: string;
  path: string;
  secret: SecretDto;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const target = { project, env, path, key: secret.key };
  const versions = useSecretVersions(target);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  let body: ReactNode;
  if (versions.isError) {
    body = <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />;
  } else if (versions.data?.length === 0) {
    body = (
      <EmptyState
        icon={RiHistoryLine}
        title="No versions yet"
        description="Versions appear here after the secret is saved."
      />
    );
  } else {
    body = (
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.isPending ? (
              <TableSkeletonRows columns={["8ch", "14ch", "14ch", "14ch", "8ch"]} rows={3} />
            ) : (
              versions.data.map((v) => {
                const current = v.version === secret.version;
                return (
                  <TableRow key={v.version}>
                    <TableCell primary>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{`v${v.version}`}</span>
                          {current ? <StatusBadge status="success">Current</StatusBadge> : null}
                        </div>
                        {v.comment ? (
                          <span className="truncate text-paragraph-xs text-text-soft">
                            {v.comment}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-48">
                      <MaskedValue
                        reveal={() =>
                          api.secrets.versionValue(project, env, secret.key, v.version, path)
                        }
                      />
                    </TableCell>
                    <TableCell className="text-paragraph-sm">
                      {/* The sheet is narrow: long emails truncate, dates never wrap. */}
                      {v.createdBy?.label ? (
                        <span className="block max-w-36 truncate">{v.createdBy.label}</span>
                      ) : (
                        NONE
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-paragraph-sm">
                      <Tooltip content={formatRelative(v.createdAt)}>
                        <span>{formatDate(v.createdAt)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && !current ? (
                        <Button
                          variant="ghost"
                          size="2xs"
                          aria-label={`Roll back to v${v.version}`}
                          onClick={() => setRollingBack(v.version)}
                        >
                          Roll back
                        </Button>
                      ) : null}
                    </TableCell>
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
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent size="wide">
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>{`Every saved version of ${secret.key} at ${path}, newest first.`}</SheetDescription>
        </SheetHeader>
        <SheetBody>{body}</SheetBody>
      </SheetContent>
      <RollbackDialog target={target} version={rollingBack} onClose={() => setRollingBack(null)} />
    </Sheet>
  );
}
