import { normalizeSecretPath } from "@anchor/shared";
import { type FormEvent, useState } from "react";
import { RiAddCircleLine } from "react-icons/ri";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Dashed `⊕ Go to path` chip: type a folder path (validated like the API) and jump there. */
export function GoToPathChip({ onGo }: { onGo: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      onGo(normalizeSecretPath(input.trim()));
      setOpen(false);
      setInput("");
      setError(undefined);
    } catch {
      setError("Use folders of letters, digits, - and _, like /api/v1");
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="dashed" size="xs">
          <RiAddCircleLine aria-hidden />
          Go to path
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <Field htmlFor="go-to-path" label="Path" error={error}>
            <Input
              id="go-to-path"
              compact
              autoFocus
              className="font-mono"
              placeholder="/api"
              value={input}
              invalid={!!error}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <Button type="submit" size="xs">
            Go
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
