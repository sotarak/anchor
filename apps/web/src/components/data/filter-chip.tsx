import { useId } from "react";
import { RiAddCircleLine, RiCloseLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Dashed facet chip: `⊕ Status`, or `Status: Active +1` with a clear button when active. */
export function FilterChip<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  const id = useId();
  const selected = options.filter((o) => value.includes(o.value));
  const [first] = selected;
  const summary = first
    ? `${label}: ${first.label}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`
    : label;
  const toggle = (v: T, on: boolean) =>
    onChange(on ? [...value.filter((x) => x !== v), v] : value.filter((x) => x !== v));

  return (
    <div className="inline-flex items-center">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="dashed" size="xs" className={first ? "rounded-r-none" : undefined}>
            {!first && <RiAddCircleLine aria-hidden />}
            {summary}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-1">
          <ul className="flex flex-col">
            {options.map((o) => {
              const optionId = `${id}-${o.value}`;
              return (
                <li key={o.value}>
                  <label
                    htmlFor={optionId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-label-sm text-text-sub hover:bg-neutral-alpha-100"
                  >
                    <Checkbox
                      id={optionId}
                      checked={value.includes(o.value)}
                      onCheckedChange={(c) => toggle(o.value, c === true)}
                    />
                    {o.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
      {first && (
        <Button
          variant="dashed"
          size="xs"
          aria-label={`Clear ${label}`}
          onClick={() => onChange([])}
          className="-ml-px rounded-l-none px-2"
        >
          <RiCloseLine aria-hidden />
        </Button>
      )}
    </div>
  );
}
