import { type ReactNode, useEffect, useRef, useState } from "react";
import { RiCheckLine, RiEyeLine, RiEyeOffLine, RiFileCopyLine } from "react-icons/ri";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Button } from "@/components/ui/button";

export const MASK = "••••••••";

/**
 * A secret value, masked until the user reveals it. The revealed text lives only in this
 * component's state (never a query cache, storage or the URL) and is gone on unmount.
 */
export function MaskedValue({
  reveal,
  onCopied,
  render = (v) => v,
  actions,
  onHide,
}: {
  reveal: () => Promise<string>;
  onCopied?: () => void;
  /** How a revealed value is shown (default: plain text). */
  render?: (value: string) => ReactNode;
  /** Extra buttons while revealed. */
  actions?: (value: string) => ReactNode;
  /** Called when the value is hidden again, so callers drop derived state. */
  onHide?: () => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const load = async (): Promise<string | null> => {
    setBusy(true);
    try {
      return await reveal();
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const toggle = async () => {
    if (value !== null) {
      setValue(null);
      onHide?.();
      return;
    }
    const v = await load();
    if (v !== null && mounted.current) setValue(v);
  };

  const copy = async () => {
    const v = value ?? (await load());
    if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
    } catch {
      toast.error("Copy failed");
      return;
    }
    if (!mounted.current) return;
    setCopied(true);
    toast.success("Copied");
    onCopied?.();
  };

  const revealed = value !== null;
  return (
    <div className="group/value flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate text-code-xs text-text-sub">
        {revealed ? render(value) : MASK}
      </span>
      <div className="flex shrink-0 items-center opacity-0 transition group-hover/value:opacity-100 group-focus-within/value:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={revealed ? "Hide value" : "Reveal value"}
          disabled={busy}
          onClick={toggle}
        >
          {revealed ? <RiEyeOffLine aria-hidden /> : <RiEyeLine aria-hidden />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy value"
          disabled={busy}
          onClick={copy}
        >
          {copied ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
        </Button>
        {revealed ? actions?.(value) : null}
      </div>
    </div>
  );
}
