import { useState } from "react";
import { RiEyeLine } from "react-icons/ri";
import { toast } from "sonner";
import { errorMessage } from "@/components/data/table-states";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Mono value editor. In `edit` mode it starts empty ("leave untouched to keep the current value")
 * and can load the current value on request; the loaded value stays in the form's state only.
 */
export function SecretValueField({
  id,
  value,
  onChange,
  mode,
  touched,
  invalid,
  onLoadCurrent,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  mode: "new" | "edit";
  touched: boolean;
  invalid?: boolean;
  onLoadCurrent?: () => Promise<string>;
}) {
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!onLoadCurrent) return;
    setLoading(true);
    try {
      onChange(await onLoadCurrent());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        mono
        rows={4}
        spellCheck={false}
        autoComplete="off"
        invalid={invalid}
        value={value}
        placeholder={mode === "edit" ? "Unchanged" : "Value"}
        onChange={(e) => onChange(e.target.value)}
      />
      {mode === "edit" && (
        <div className="flex items-center justify-between gap-2">
          <FieldHint>
            {touched
              ? "The new value replaces the current one."
              : "Leave untouched to keep the current value"}
          </FieldHint>
          {onLoadCurrent && !touched && (
            <Button variant="ghost" size="2xs" disabled={loading} onClick={load}>
              <RiEyeLine aria-hidden />
              Reveal current value
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
