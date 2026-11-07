import type { FolderDto, SecretDto } from "@anchor/shared";
import {
  RiDeleteBinLine,
  RiFileCopyLine,
  RiHistoryLine,
  RiKey2Line,
  RiMore2Fill,
  RiPencilLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/data/table-states";
import { FolderRows } from "@/components/folders/folder-rows";
import { ReferenceValue } from "@/components/references/reference-value";
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
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatRelative } from "@/lib/format";

const source = (f: { environment: string; path: string }) => `${f.environment}:${f.path}`;

/**
 * Folders, then secrets, at one env + path. Rows composed from imports carry a "from" tag and
 * are read-only. Values are masked; Reveal/Copy fetch the one value directly (never a
 * query) and keep it in the row's state only. Render with `key={env + path}` so a different
 * env or path remounts every row and nothing revealed carries over.
 */
export function SecretsTable({
  project,
  env,
  path,
  folders = [],
  secrets,
  loading,
  canWrite,
  onEdit,
  onDelete,
  onOpenFolder = () => {},
  onDeleteFolder = () => {},
  onHistory = () => {},
}: {
  onHistory?: (s: SecretDto) => void;
  folders?: FolderDto[];
  onOpenFolder?: (f: FolderDto) => void;
  onDeleteFolder?: (f: FolderDto) => void;
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
          <TableHead className="w-[32%]">Key</TableHead>
          <TableHead className="w-64">Value</TableHead>
          <TableHead>Comment</TableHead>
          <TableHead className="w-20">Version</TableHead>
          <TableHead className="w-36">Updated</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={["24ch", "14ch", "14ch", "8ch", "14ch", "8ch"]} />
        ) : (
          <>
            <FolderRows
              folders={folders}
              canWrite={canWrite}
              onOpen={onOpenFolder}
              onDelete={onDeleteFolder}
            />
            {secrets.map((s) => (
              <TableRow key={s.key}>
                <TableCell primary>
                  <div className="flex items-center gap-2">
                    <RiKey2Line aria-hidden className="size-4 shrink-0 text-text-soft" />
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{s.key}</span>
                      {s.importedFrom ? (
                        <Tooltip content={`Edit in ${source(s.importedFrom)}`}>
                          <Tag tabIndex={0}>{`from ${source(s.importedFrom)}`}</Tag>
                        </Tooltip>
                      ) : null}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-64">
                  <ReferenceValue
                    // Any write (edit, or delete then re-add) remounts it: a revealed or copied
                    // value is never the stale plaintext of an earlier version.
                    key={`${s.version}:${s.updatedAt}`}
                    project={project}
                    env={env}
                    path={path}
                    secretKey={s.key}
                    importedFrom={s.importedFrom}
                  />
                </TableCell>
                <TableCell className="text-paragraph-sm">
                  {/* Its own column keeps every row one line; the full text is in the tooltip. */}
                  {s.comment ? (
                    <Tooltip content={s.comment}>
                      <span className="block max-w-72 truncate text-text-soft">{s.comment}</span>
                    </Tooltip>
                  ) : (
                    <span className="text-text-soft">–</span>
                  )}
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
                      {/* An imported row is read-only here: it is edited in its source folder. */}
                      {canWrite && !s.importedFrom ? (
                        <DropdownMenuItem onSelect={() => onEdit(s)}>
                          <RiPencilLine aria-hidden />
                          Edit
                        </DropdownMenuItem>
                      ) : null}
                      {s.importedFrom ? null : (
                        <DropdownMenuItem onSelect={() => onHistory(s)}>
                          <RiHistoryLine aria-hidden />
                          History
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => void copyKey(s.key)}>
                        <RiFileCopyLine aria-hidden />
                        Copy key
                      </DropdownMenuItem>
                      {canWrite && !s.importedFrom ? (
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
            ))}
          </>
        )}
      </TableBody>
    </Table>
  );
}
