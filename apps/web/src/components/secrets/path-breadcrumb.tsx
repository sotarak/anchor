import { Fragment } from "react";
import { RiFolderLine } from "react-icons/ri";
import { Tag } from "@/components/ui/tag";

/** The current secret folder as clickable segments: `/` › `api` › `v1`. */
export function PathBreadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path === "/" ? [] : path.slice(1).split("/");
  const crumb = (label: string, target: string, current: boolean) => (
    <button
      type="button"
      aria-current={current ? "location" : undefined}
      onClick={() => onNavigate(target)}
      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-base"
    >
      <Tag tone="neutral" className={current ? "text-text-strong" : "hover:text-text-strong"}>
        {label}
      </Tag>
    </button>
  );
  return (
    <nav aria-label="Path" className="flex items-center gap-1">
      <RiFolderLine aria-hidden className="size-3.5 text-text-soft" />
      {crumb("/", "/", segments.length === 0)}
      {segments.map((segment, i) => (
        // The prefix up to a segment is unique, so it is the key.
        <Fragment key={segments.slice(0, i + 1).join("/")}>
          <span aria-hidden className="text-paragraph-xs text-text-soft">
            /
          </span>
          {crumb(segment, `/${segments.slice(0, i + 1).join("/")}`, i === segments.length - 1)}
        </Fragment>
      ))}
    </nav>
  );
}
