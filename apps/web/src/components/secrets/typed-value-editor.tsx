import type { SecretValueType } from "@anchor/shared";
import {
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { RiAddLine, RiBracesLine, RiCloseLine, RiUploadLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldHint } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { booleanFrom, formatJson, listItemsFrom, listTextFrom, pemLabel } from "@/lib/typed-value";

export type TypedValueEditorProps = {
  /** Carried by the first focusable control, so a `<label htmlFor>` points at it. */
  id: string;
  type: SecretValueType;
  /** The raw text the API stores. */
  value: string;
  onChange: (value: string) => void;
  /** Called once focus leaves the whole editor. */
  onBlur?: () => void;
  invalid?: boolean;
  /** Accessible name for editors made of several controls (boolean, list). */
  label?: string;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const lineCount = (text: string) => text.split("\n").length;

/** Calls `onBlur` only when focus moves outside `event.currentTarget`. */
function leaving(onBlur?: () => void) {
  return (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
  };
}

const MONO_TEXT = { mono: true, spellCheck: false, autoComplete: "off" } as const;

/**
 * One editor per value type, each editing the same string the API stores. Mount it with
 * `key={type}`: every editor reads the current text when it mounts (the type switching rules).
 */
export function TypedValueEditor(props: TypedValueEditorProps) {
  switch (props.type) {
    case "number":
      return <NumberEditor {...props} />;
    case "boolean":
      return <BooleanEditor {...props} />;
    case "json":
      return <JsonEditor {...props} />;
    case "list":
      return <ListEditor {...props} />;
    case "pem":
      return <PemEditor {...props} />;
    default:
      return <TextEditor {...props} />;
  }
}

function TextEditor({ id, value, onChange, onBlur, invalid }: TypedValueEditorProps) {
  return (
    <Textarea
      id={id}
      {...MONO_TEXT}
      className="min-h-0"
      rows={clamp(lineCount(value), 1, 8)}
      invalid={invalid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

function NumberEditor({ id, value, onChange, onBlur, invalid }: TypedValueEditorProps) {
  return (
    <Input
      id={id}
      className="font-mono"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      invalid={invalid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

function BooleanEditor({ id, value, onChange, onBlur, label = "Value" }: TypedValueEditorProps) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      aria-label={label}
      className="self-start"
      value={booleanFrom(value) ?? ""}
      // Radix reports "" when the pressed item is clicked again; a boolean keeps its choice.
      onValueChange={(v) => {
        if (v) onChange(v);
      }}
      onBlur={leaving(onBlur)}
    >
      <ToggleGroupItem value="true" className="font-mono">
        true
      </ToggleGroupItem>
      <ToggleGroupItem value="false" className="font-mono">
        false
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function JsonEditor({ id, value, onChange, onBlur, invalid }: TypedValueEditorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        {...MONO_TEXT}
        rows={clamp(lineCount(value), 6, 16)}
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <Button
        variant="ghost"
        size="2xs"
        className="self-end"
        onClick={() => {
          const formatted = formatJson(value);
          if (formatted !== null) onChange(formatted);
        }}
      >
        <RiBracesLine aria-hidden />
        Format
      </Button>
    </div>
  );
}

/**
 * One input per item. The stored text is rewritten only when the person changes an item, so a
 * revealed value saved untouched keeps its exact spelling.
 */
function ListEditor({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  label = "Value",
}: TypedValueEditorProps) {
  const [items, setItems] = useState<string[]>(() => {
    const read = listItemsFrom(value);
    return read.length > 0 ? read : [""];
  });
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    inputs.current[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex]);

  const update = (next: string[], focus?: number) => {
    const kept = next.length > 0 ? next : [""];
    setItems(kept);
    onChange(listTextFrom(kept));
    if (focus !== undefined) setFocusIndex(Math.min(focus, kept.length - 1));
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // Never submit the form from a list row.
    update([...items.slice(0, i + 1), "", ...items.slice(i + 1)], i + 1);
  };

  const onPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/\r?\n/.test(text)) return;
    e.preventDefault();
    const pieces = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    const current = items[i] ?? "";
    const next =
      current === ""
        ? [...items.slice(0, i), ...pieces, ...items.slice(i + 1)]
        : [...items.slice(0, i + 1), ...pieces, ...items.slice(i + 1)];
    update(next, current === "" ? i + pieces.length - 1 : i + pieces.length);
  };

  return (
    <fieldset
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="flex flex-col gap-1.5"
      onBlur={leaving(onBlur)}
    >
      {items.map((item, i) => (
        // Rows have no identity beyond their position; the index is the key.
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <div key={i} className="flex items-center gap-1.5">
          <Input
            id={i === 0 ? id : undefined}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            aria-label={`Item ${i + 1}`}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            invalid={invalid}
            value={item}
            onChange={(e) => update(items.map((old, j) => (j === i ? e.target.value : old)))}
            onKeyDown={onKeyDown(i)}
            onPaste={onPaste(i)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove item ${i + 1}`}
            onClick={() =>
              update(
                items.filter((_, j) => j !== i),
                i,
              )
            }
          >
            <RiCloseLine aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="2xs"
        className="self-start"
        onClick={() => update([...items, ""], items.length)}
      >
        <RiAddLine aria-hidden />
        Add item
      </Button>
    </fieldset>
  );
}

/** PEM text, typed or loaded from a file in the browser (never uploaded until Save). */
function PemEditor({ id, value, onChange, onBlur, invalid }: TypedValueEditorProps) {
  const file = useRef<HTMLInputElement>(null);
  const detected = pemLabel(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        {...MONO_TEXT}
        rows={clamp(lineCount(value), 6, 16)}
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div className="flex items-center justify-between gap-2">
        <FieldHint>{detected ? `Detected: ${detected}` : null}</FieldHint>
        <Button variant="ghost" size="2xs" onClick={() => file.current?.click()}>
          <RiUploadLine aria-hidden />
          Load from file
        </Button>
        <input
          ref={file}
          type="file"
          aria-label="PEM file"
          tabIndex={-1}
          className="sr-only"
          accept=".pem,.crt,.cer,.key,.txt"
          onChange={async (e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) onChange(await picked.text());
          }}
        />
      </div>
    </div>
  );
}
