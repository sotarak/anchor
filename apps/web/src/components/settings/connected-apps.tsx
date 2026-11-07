import type { OAuthGrantDto, OAuthScope } from "@anchor/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RiPlugLine } from "react-icons/ri";
import { toast } from "sonner";
import { TableFooter } from "@/components/data/table-footer";
import {
  EmptyState,
  ErrorState,
  errorMessage,
  TableSkeletonRows,
} from "@/components/data/table-states";
import { useClientPages } from "@/components/data/use-client-pages";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { formatDate, formatRelative } from "@/lib/format";

const SCOPE_LABEL: Record<OAuthScope, string> = {
  "secrets:read": "Read",
  "secrets:write": "Write",
  "secrets:reveal": "Reveal",
};

/** Account → Connected apps: AI agents and apps the user approved over OAuth. */
export function ConnectedApps() {
  const queryClient = useQueryClient();
  const grants = useQuery({ queryKey: qk.oauthGrants, queryFn: api.oauth.grants });
  const page = useClientPages(grants.data ?? []);
  const [revoking, setRevoking] = useState<OAuthGrantDto | null>(null);

  async function revoke(g: OAuthGrantDto) {
    try {
      await api.oauth.revokeGrant(g.id);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    toast.success("App disconnected");
    await queryClient.invalidateQueries({ queryKey: qk.oauthGrants });
  }

  if (grants.isError) {
    return <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />;
  }
  if (grants.data?.length === 0) {
    return (
      <EmptyState
        icon={RiPlugLine}
        title="No apps are connected."
        description="AI agents you connect to Anchor over MCP appear here."
      />
    );
  }
  return (
    <>
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.data ? (
              page.rows.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-label-sm text-text-strong">{g.clientName}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {g.scopes.map((s) => (
                        <Tag key={s}>{SCOPE_LABEL[s]}</Tag>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Tooltip content={formatRelative(g.createdAt)}>
                      <span>{formatDate(g.createdAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {g.lastUsedAt === null ? (
                      <span className="text-text-soft">–</span>
                    ) : (
                      formatRelative(g.lastUsedAt)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      aria-label={`Revoke ${g.clientName}`}
                      onClick={() => setRevoking(g)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableSkeletonRows columns={["24ch", "14ch", "14ch", "8ch", "8ch"]} />
            )}
          </TableBody>
        </Table>
        {grants.data ? <TableFooter {...page.footer} label="apps" /> : null}
      </TableContainer>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.clientName ?? ""}`}
        description="The app loses access at its next request. Connect it again to restore access."
        confirmLabel="Revoke app"
        destructive
        onConfirm={() => (revoking ? revoke(revoking) : Promise.resolve())}
      />
    </>
  );
}
