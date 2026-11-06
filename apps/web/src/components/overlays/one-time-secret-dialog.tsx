import { useEffect, useState } from "react";
import { RiCheckLine, RiErrorWarningLine, RiFileCopyLine } from "react-icons/ri";
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

/**
 * Shows a value that cannot be retrieved again (service token, invite or reset link). It cannot be
 * dismissed by Escape, an outside click or an X: only the explicit "I've copied it" button closes
 * it. The caller holds `value` in component state and clears it in `onDone`.
 */
export function OneTimeSecretDialog({
  open,
  title,
  label,
  value,
  notice,
  onDone,
}: {
  open: boolean;
  title: string;
  label: string;
  value: string;
  notice: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed. Select the value and copy it manually.");
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showClose={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <span className="text-paragraph-sm text-text-sub">{label}</span>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-lg bg-bg-weak px-3 py-2 ring-1 ring-inset ring-stroke-soft">
          <code className="min-w-0 flex-1 break-all text-code-xs text-text-strong">{value}</code>
          <Button variant="ghost" size="icon-xs" aria-label="Copy" onClick={copy}>
            {copied ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
          </Button>
        </div>
        <DialogDescription asChild>
          <div className="flex gap-2 rounded-lg bg-warning-lighter p-3 text-paragraph-xs text-warning-base">
            <RiErrorWarningLine aria-hidden className="size-4 shrink-0" />
            <span>{notice}</span>
          </div>
        </DialogDescription>
        <DialogFooter>
          <Button variant="primary" onClick={onDone}>
            I've copied it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
