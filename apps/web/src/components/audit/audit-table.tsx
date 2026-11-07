import type { AuditEventDto } from "@anchor/shared";
import type { ReactNode } from "react";
import { TableSkeletonRows } from "@/components/data/table-states";
import { Avatar } from "@/components/ui/avatar";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative } from "@/lib/format";

const DASH = <span className="text-text-soft">–</span>;

export function actorLabel(e: AuditEventDto): string {
  return e.actor.label ?? (e.actor.type === "anonymous" ? "Anonymous" : (e.actor.id ?? "Unknown"));
}

/** What the Target column shows: a name or email from the metadata beats a raw ID. */
export function auditTargetLabel(e: {
  target: string | null;
  metadata: Record<string, unknown> | null;
}): string | null {
  const name = e.metadata?.name;
  if (typeof name === "string" && name) return name;
  const email = e.metadata?.email;
  if (typeof email === "string" && email) return email;
  return e.target;
}

function Actor({ event }: { event: AuditEventDto }) {
  const label = actorLabel(event);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={label} />
      <span className="truncate text-paragraph-sm text-text-sub">{label}</span>
      {event.actor.type === "service_token" ? <Tag>Service token</Tag> : null}
    </div>
  );
}

const code = "text-code-xs text-text-sub";

export function AuditTable({
  events,
  projectSlugs,
  loading,
  onOpen,
}: {
  events: AuditEventDto[];
  projectSlugs: Map<string, string>;
  loading: boolean;
  onOpen: (e: AuditEventDto) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableSkeletonRows columns={["14ch", "14ch", "14ch", "14ch", "8ch", "14ch"]} />
        ) : (
          events.map((e) => (
            <TableRow key={e.id} clickable onClick={() => onOpen(e)}>
              <TableCell className="whitespace-nowrap text-paragraph-sm">
                <Tooltip content={formatRelative(e.at)}>
                  <span>{formatDateTime(e.at)}</span>
                </Tooltip>
              </TableCell>
              <TableCell>
                <Actor event={e} />
              </TableCell>
              <TableCell>
                {/* The action is the keyboard target that opens the detail. */}
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpen(e);
                  }}
                  className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-base"
                >
                  <Tag tone="neutral">{e.action}</Tag>
                </button>
              </TableCell>
              <TableCell className={code}>{auditTargetLabel(e) ?? DASH}</TableCell>
              <TableCell className={code}>
                {e.projectId ? (projectSlugs.get(e.projectId) ?? e.projectId) : DASH}
              </TableCell>
              <TableCell className={code}>{e.ip ?? DASH}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label-xs text-text-soft">{label}</dt>
      <dd className="break-all text-paragraph-sm text-text-strong">{children ?? DASH}</dd>
    </div>
  );
}

/** Read-only detail of one event. Audit metadata never carries secret values. */
export function AuditDetailSheet({
  event,
  projectSlugs,
  onClose,
}: {
  event: AuditEventDto | null;
  projectSlugs: Map<string, string>;
  onClose: () => void;
}) {
  return (
    <Sheet open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {event ? (
          <>
            <SheetHeader>
              <SheetTitle>{event.action}</SheetTitle>
              <SheetDescription>{formatDateTime(event.at)}</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <dl className="grid grid-cols-2 gap-4">
                <Detail label="Actor">
                  {`${actorLabel(event)} (${event.actor.type.replace("_", " ")})`}
                </Detail>
                <Detail label="Target">
                  {event.target ? <span className="text-code-xs">{event.target}</span> : null}
                </Detail>
                <Detail label="Project">
                  {event.projectId ? (projectSlugs.get(event.projectId) ?? event.projectId) : null}
                </Detail>
                <Detail label="Environment">{event.environmentId}</Detail>
                <Detail label="IP">
                  {event.ip ? <span className="text-code-xs">{event.ip}</span> : null}
                </Detail>
                <Detail label="Request ID">
                  {event.requestId ? <span className="text-code-xs">{event.requestId}</span> : null}
                </Detail>
                <div className="col-span-2">
                  <Detail label="User agent">{event.userAgent}</Detail>
                </div>
              </dl>
              <div className="flex flex-col gap-1">
                <span className="text-label-xs text-text-soft">Metadata</span>
                <pre className="overflow-x-auto rounded-lg bg-bg-weak p-3 text-code-xs text-text-strong">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
