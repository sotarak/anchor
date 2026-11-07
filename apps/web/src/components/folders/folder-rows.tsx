import type { FolderDto } from "@anchor/shared";
import { RiDeleteBinLine, RiFolder3Line, RiMore2Fill } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";

const NONE = <span className="text-text-soft">–</span>;

/** Folder rows for the secrets table (rendered before the secret rows). A click opens the folder. */
export function FolderRows({
  folders,
  canWrite,
  onOpen,
  onDelete,
}: {
  folders: FolderDto[];
  canWrite: boolean;
  onOpen: (folder: FolderDto) => void;
  onDelete: (folder: FolderDto) => void;
}) {
  return folders.map((f) => (
    <TableRow key={f.path} clickable onClick={() => onOpen(f)}>
      <TableCell primary>
        <div className="flex items-center gap-2">
          <RiFolder3Line aria-hidden className="size-4 shrink-0 text-text-soft" />
          {/* One line: the folder's path is already in the breadcrumb above the table. */}
          <button
            type="button"
            className="min-w-0 truncate text-left outline-none focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(f);
            }}
          >
            {f.name}
          </button>
        </div>
      </TableCell>
      <TableCell>{NONE}</TableCell>
      <TableCell>{NONE}</TableCell>
      <TableCell>{NONE}</TableCell>
      <TableCell>{NONE}</TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        {canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Actions for folder ${f.name}`}>
                <RiMore2Fill aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem destructive onSelect={() => onDelete(f)}>
                <RiDeleteBinLine aria-hidden />
                Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  ));
}
