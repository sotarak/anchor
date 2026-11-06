import type { InstanceRole, InviteDto, ProjectRole, ServiceTokenDto } from "@anchor/shared";
import type { Status } from "@/components/ui/status-badge";

const WEEK = 7 * 86_400_000;

export type TokenStatusLabel = "Active" | "Expiring" | "Expired" | "Revoked";

/** Revoked wins over expired; expiring = less than 7 days left. */
export function tokenStatus(
  t: Pick<ServiceTokenDto, "revokedAt" | "expiresAt">,
  now = Date.now(),
): { status: Status; label: TokenStatusLabel } {
  if (t.revokedAt !== null) return { status: "neutral", label: "Revoked" };
  if (t.expiresAt <= now) return { status: "neutral", label: "Expired" };
  if (t.expiresAt - now < WEEK) return { status: "warning", label: "Expiring" };
  return { status: "success", label: "Active" };
}

export type InviteStatusLabel = "Pending" | "Accepted" | "Expired" | "Revoked";

export function inviteStatus(
  i: Pick<InviteDto, "acceptedAt" | "revokedAt" | "expiresAt">,
  now = Date.now(),
): { status: Status; label: InviteStatusLabel } {
  if (i.acceptedAt !== null) return { status: "success", label: "Accepted" };
  if (i.revokedAt !== null) return { status: "neutral", label: "Revoked" };
  if (i.expiresAt <= now) return { status: "neutral", label: "Expired" };
  return { status: "info", label: "Pending" };
}

export type Tone = "information" | "warning" | "error" | "feature";

/** Environment color: the only place that maps env slugs to tones. */
export function environmentTone(slug: string): Tone {
  if (slug === "dev") return "information";
  if (slug === "staging") return "warning";
  if (slug === "prod") return "error";
  return "feature";
}

/** Icon-tile classes per tone (tokens only). */
export const TONE_TILE: Record<Tone, string> = {
  information: "bg-information-lighter text-information-base",
  warning: "bg-warning-lighter text-warning-base",
  error: "bg-error-lighter text-error-base",
  feature: "bg-feature-lighter text-feature-base",
};

const ROLE_LABELS: Record<InstanceRole | ProjectRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  developer: "Developer",
  viewer: "Viewer",
};

export function roleLabel(role: InstanceRole | ProjectRole): string {
  return ROLE_LABELS[role];
}
