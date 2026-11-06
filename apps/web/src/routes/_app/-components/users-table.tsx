import type { InstanceRole, UserDto } from "@anchor/shared";
import {
  RiDeleteBinLine,
  RiForbidLine,
  RiLockPasswordLine,
  RiMore2Fill,
  RiShieldUserLine,
  RiUserFollowLine,
} from "react-icons/ri";
import { TableSkeletonRows } from "@/components/data/table-states";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { roleLabel } from "@/lib/status";

export type UserActions = {
  onChangeRole: (u: UserDto, role: InstanceRole) => void;
  onToggleDisabled: (u: UserDto) => void;
  onResetLink: (u: UserDto) => void;
  onDelete: (u: UserDto) => void;
};

/**
 * What `me` may do to `target`, mirroring the server: nothing to yourself; only owners touch
 * owners or grant the owner role; admins create reset links for members only.
 */
export function permissions(me: UserDto, target: UserDto) {
  const self = me.id === target.id;
  const manage = !self && (me.role === "owner" || target.role !== "owner");
  return {
    manage,
    roles: (me.role === "owner"
      ? ["owner", "admin", "member"]
      : ["admin", "member"]) as InstanceRole[],
    resetLink: manage && !target.disabledAt && (me.role === "owner" || target.role === "member"),
  };
}

export function UsersTable({
  users,
  me,
  loading,
  actions,
}: {
  users: UserDto[];
  me: UserDto;
  loading: boolean;
  actions: UserActions;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={["24ch", "8ch", "8ch", "8ch"]} />
        ) : (
          users.map((u) => {
            const can = permissions(me, u);
            return (
              <TableRow key={u.id}>
                <TableCell primary>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.name} size="md" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">
                        {u.name}
                        {u.id === me.id ? <span className="text-text-soft"> (you)</span> : null}
                      </span>
                      <span className="truncate text-paragraph-xs text-text-soft">{u.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Tag>{roleLabel(u.role)}</Tag>
                </TableCell>
                <TableCell>
                  {u.disabledAt ? (
                    <StatusBadge status="neutral">Disabled</StatusBadge>
                  ) : (
                    <StatusBadge status="success">Active</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {can.manage ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${u.name}`}>
                          <RiMore2Fill aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <RiShieldUserLine aria-hidden />
                            Change role
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              value={u.role}
                              onValueChange={(role) => {
                                if (role !== u.role) actions.onChangeRole(u, role as InstanceRole);
                              }}
                            >
                              {can.roles.map((role) => (
                                <DropdownMenuRadioItem key={role} value={role}>
                                  {roleLabel(role)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onSelect={() => actions.onToggleDisabled(u)}>
                          {u.disabledAt ? (
                            <RiUserFollowLine aria-hidden />
                          ) : (
                            <RiForbidLine aria-hidden />
                          )}
                          {u.disabledAt ? "Enable" : "Disable"}
                        </DropdownMenuItem>
                        {can.resetLink ? (
                          <DropdownMenuItem onSelect={() => actions.onResetLink(u)}>
                            <RiLockPasswordLine aria-hidden />
                            Create password reset link
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => actions.onDelete(u)}>
                          <RiDeleteBinLine aria-hidden />
                          Delete
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
