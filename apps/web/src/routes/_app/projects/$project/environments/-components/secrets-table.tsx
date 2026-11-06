import type { SecretDto } from "@anchor/shared";
import {
  RiDeleteBinLine,
  RiFileCopyLine,
  RiKey2Line,
  RiMore2Fill,
  RiPencilLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/data/table-states";
import { MaskedValue } from "@/components/secrets/masked-value";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { api } from "@/lib/api/endpoints";
import { formatDate, formatRelative } from "@/lib/format";

/**
 * Secrets at one env + path. Values are masked; Reveal/Copy fetch the one value directly (never a
 * query) and keep it in the row's state only. Render with `key={env + path}` so a different
 * env or path remounts every row and nothing revealed carries over.
 */
export function SecretsTable({
  project,
  env,
  path,
  secrets,
  loading,
  canWrite,
  onEdit,
  onDelete,
}: {
  project: string;
  env: string;
  path: string;
  secrets: SecretDto[];
  loading: boolean;
  canWrite: boolean;
  onEdit: (s: SecretDto) => void;
  onDelete: (s: SecretDto) => void;
}) {
  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast.success("Key copied");
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={["24ch", "14ch", "8ch", "14ch", "8ch"]} />
        ) : (
          secrets.map((s) => (
            <TableRow key={s.key}>
              <TableCell primary>
                <div className="flex items-center gap-2">
                  <RiKey2Line aria-hidden className="size-4 shrink-0 text-text-soft" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{s.key}</span>
                    {s.comment ? (
                      <span className="truncate text-paragraph-xs text-text-soft">{s.comment}</span>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-64">
                <MaskedValue
                  // Any write (edit, or delete then re-add) remounts it: a revealed or copied
                  // value is never the stale plaintext of an earlier version.
                  key={`${s.version}:${s.updatedAt}`}
                  reveal={async () =>
                    (await api.secrets.get(project, env, s.key, path)).value ?? ""
                  }
                />
              </TableCell>
              <TableCell className="text-paragraph-sm">{`v${s.version}`}</TableCell>
              <TableCell className="text-paragraph-sm">
                <Tooltip content={formatRelative(s.updatedAt)}>
                  <span>{formatDate(s.updatedAt)}</span>
                </Tooltip>
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${s.key}`}>
                      <RiMore2Fill aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {canWrite ? (
                      <DropdownMenuItem onSelect={() => onEdit(s)}>
                        <RiPencilLine aria-hidden />
                        Edit
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void copyKey(s.key)}>
                      <RiFileCopyLine aria-hidden />
                      Copy key
                    </DropdownMenuItem>
                    {canWrite ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => onDelete(s)}>
                          <RiDeleteBinLine aria-hidden />
                          Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
