import type { InviteDto } from "@anchor/shared";
import { RiForbidLine, RiMailLine, RiMore2Fill } from "react-icons/ri";
import { TableSkeletonRows } from "@/components/data/table-states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatRelative } from "@/lib/format";
import { inviteStatus, roleLabel } from "@/lib/status";

export function InvitesTable({
  invites,
  loading,
  onRevoke,
}: {
  invites: InviteDto[];
  loading: boolean;
  onRevoke: (i: InviteDto) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={["24ch", "8ch", "8ch", "14ch", "8ch"]} />
        ) : (
          invites.map((i) => {
            const status = inviteStatus(i);
            return (
              <TableRow key={i.id}>
                <TableCell primary>
                  <div className="flex items-center gap-2">
                    <RiMailLine aria-hidden className="size-4 shrink-0 text-text-soft" />
                    <span className="truncate">{i.email}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Tag>{roleLabel(i.role)}</Tag>
                </TableCell>
                <TableCell>
                  <StatusBadge status={status.status}>{status.label}</StatusBadge>
                </TableCell>
                <TableCell className="text-paragraph-sm">
                  <Tooltip content={formatRelative(i.expiresAt)}>
                    <span>{formatDate(i.expiresAt)}</span>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-right">
                  {status.label === "Pending" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Actions for ${i.email}`}
                        >
                          <RiMore2Fill aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem destructive onSelect={() => onRevoke(i)}>
                          <RiForbidLine aria-hidden />
                          Revoke
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
