import type { FolderDto } from "@anchor/shared";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiClientError } from "@/lib/api/client";
import { useDeleteFolder } from "./use-folders";

/**
 * Deletes an empty folder. When the server answers 409 (not empty), the dialog turns into a
 * force confirmation that names the folder and what goes with it.
 */
export function DeleteFolderDialog({
  folder,
  onClose,
  project,
  env,
  envName,
}: {
  folder: FolderDto | null;
  onClose: () => void;
  project: string;
  env: string;
  envName: string;
}) {
  const [force, setForce] = useState(false);
  const remove = useDeleteFolder(project, env);
  const close = () => {
    setForce(false);
    onClose();
  };

  function confirm() {
    if (!folder) return;
    remove.mutate(
      { path: folder.path, force },
      {
        onSuccess: () => {
          toast.success("Folder deleted");
          close();
        },
        onError: (e) => {
          if (!force && e instanceof ApiClientError && e.status === 409) setForce(true);
          else toast.error(errorMessage(e));
        },
      },
    );
  }

  const path = <span className="text-code-xs text-text-strong">{folder?.path}</span>;
  return (
    <Dialog open={folder !== null} onOpenChange={(o) => !o && !remove.isPending && close()}>
      <DialogContent showClose={false}>
        <DialogHeader>
          <DialogTitle>
            {force
              ? `Delete ${folder?.path} and everything in it`
              : `Delete folder ${folder?.name}`}
          </DialogTitle>
          <DialogDescription>
            {force ? (
              <>
                {path} is not empty. This deletes every secret and subfolder inside it in {envName},
                with their history.
              </>
            ) : (
              <>
                This deletes the empty folder {path} from {envName}.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={remove.isPending} onClick={close}>
            Cancel
          </Button>
          <Button variant="error" disabled={remove.isPending} onClick={confirm}>
            {force ? "Delete everything" : "Delete folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
