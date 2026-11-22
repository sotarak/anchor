import { RiDownloadLine, RiFileCopyLine } from "react-icons/ri";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FILE_NAME = "anchor-recovery-codes.txt";

/**
 * Shows freshly generated recovery codes once. Only "Done" closes it (no Escape, outside click
 * or X); the caller drops the codes from its state in `onClose`.
 */
export function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const text = `${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed. Select the codes and copy them manually.");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open>
      <DialogContent
        showClose={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Save your recovery codes</DialogTitle>
          <DialogDescription>
            Each code works once. Store them somewhere safe: they are the only way in if you lose
            your other factors.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-bg-weak px-3 py-2 ring-1 ring-inset ring-stroke-soft">
          {codes.map((code) => (
            <li key={code} className="text-code-xs text-text-strong">
              {code}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button onClick={copy}>
            <RiFileCopyLine aria-hidden />
            Copy
          </Button>
          <Button onClick={download}>
            <RiDownloadLine aria-hidden />
            Download
          </Button>
        </div>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
