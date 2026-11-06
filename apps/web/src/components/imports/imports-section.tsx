import type { FolderImportDto } from "@anchor/shared";
import { useState } from "react";
import { RiDeleteBinLine, RiMore2Fill } from "react-icons/ri";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { ConfirmDialog } from "@/components/overlays/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tag } from "@/components/ui/tag";
import { useDeleteImport, useImports } from "./use-imports";

const sourceLabel = (i: FolderImportDto) => `${i.source.environment}:${i.source.path}`;

/** The folders this path imports, in lookup order. Hidden when there are none. */
export function ImportsSection({
  project,
  env,
  path,
  canWrite,
}: {
  project: string;
  env: string;
  path: string;
  canWrite: boolean;
}) {
  const imports = useImports(project, env, path);
  const remove = useDeleteImport(project, env);
  const [removing, setRemoving] = useState<FolderImportDto | null>(null);
  if (!imports.data?.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-paragraph-sm text-text-soft">Imported from</h2>
      <ul className="flex flex-wrap items-center gap-2">
        {imports.data.map((i) => (
          <li
            key={i.id}
            className="flex items-center gap-1 rounded-lg border py-0.5 pr-0.5 pl-2 shadow-xs"
          >
            <span className="text-paragraph-xs text-text-soft">{`#${i.position}`}</span>
            <Tag tone="neutral">{sourceLabel(i)}</Tag>
            {canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Actions for import ${sourceLabel(i)}`}
                  >
                    <RiMore2Fill aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem destructive onSelect={() => setRemoving(i)}>
                    <RiDeleteBinLine aria-hidden />
                    Remove import
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove import ${removing ? sourceLabel(removing) : ""}`}
        description={
          <>
            Secrets from{" "}
            <span className="text-code-xs text-text-strong">
              {removing ? sourceLabel(removing) : ""}
            </span>{" "}
            stop appearing at {path}. Nothing is deleted in the source.
          </>
        }
        confirmLabel="Remove import"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await remove.mutateAsync(removing.id);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
          toast.success("Import removed");
        }}
      />
    </section>
  );
}
