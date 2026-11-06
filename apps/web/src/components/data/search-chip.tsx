import { useEffect, useRef, useState } from "react";
import { RiSearchLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function isTyping(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Dashed `⊕ Search` chip that becomes a compact input on click or on the `/` key. */
export function SearchChip({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = editing || value !== "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) {
        return;
      }
      e.preventDefault();
      setEditing(true);
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!open) {
    return (
      <Button variant="dashed" size="xs" onClick={() => setEditing(true)}>
        <RiSearchLine aria-hidden />
        {placeholder}
      </Button>
    );
  }
  return (
    <Input
      ref={inputRef}
      type="search"
      compact
      leadingIcon={RiSearchLine}
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onChange("");
          setEditing(false);
        }
      }}
      className="w-56"
    />
  );
}
