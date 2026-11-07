import type { EnvironmentDto } from "@anchor/shared";
import { useState } from "react";
import { RiArrowRightSLine, RiCheckLine, RiStackLine } from "react-icons/ri";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { environmentTone, TONE_TILE } from "@/lib/status";

const card =
  "flex w-full items-center gap-2.5 rounded-lg bg-bg-white px-2.5 py-2 shadow-xs ring-1 ring-inset ring-stroke-soft outline-none focus-visible:ring-primary-base";

function EnvTile({ slug, small }: { slug: string; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        small ? "size-5 [&_svg]:size-3" : "size-7 [&_svg]:size-4",
        TONE_TILE[environmentTone(slug)],
      )}
    >
      <RiStackLine />
    </span>
  );
}

/** Novu-style environment card: the current environment and a list of the ones the caller can open. */
export function EnvironmentSwitcher({
  environments,
  current,
  onSelect,
}: {
  environments: EnvironmentDto[];
  current: string | undefined;
  onSelect: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const env = environments.find((e) => e.slug === current);
  const choose = (slug: string) => {
    setOpen(false);
    onSelect(slug);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={card}
        aria-label={env ? `Environment: ${env.name}` : "Environment: none"}
      >
        <EnvTile slug={env?.slug ?? ""} />
        <span className="flex-1 truncate text-left text-label-md text-text-strong">
          {env?.name ?? "No environment"}
        </span>
        <RiArrowRightSLine className="size-4 text-text-soft" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-60 p-1">
        <div role="listbox" aria-label="Environments" className="flex flex-col">
          {environments.map((e) => (
            <div
              key={e.slug}
              role="option"
              aria-selected={e.slug === current}
              tabIndex={0}
              onClick={() => choose(e.slug)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  choose(e.slug);
                }
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-label-sm text-text-sub outline-none hover:bg-neutral-alpha-100 focus:bg-neutral-alpha-100 focus:text-text-strong"
            >
              <EnvTile slug={e.slug} small />
              <span className="flex-1 truncate">{e.name}</span>
              {e.slug === current ? <RiCheckLine className="size-4 text-text-soft" /> : null}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
