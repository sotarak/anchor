import { describe, expect, it } from "vitest";
import { fixtures } from "#test/support";
import { formatDate, formatRelative } from "@/lib/format";
import { environmentTone, inviteStatus, roleLabel, tokenStatus } from "@/lib/status";

const { DAY, serviceToken, invite } = fixtures;
const HOUR = 3_600_000;
const now = fixtures.T0 + 10 * DAY;

describe("tokenStatus", () => {
  it("revoked wins over expired", () => {
    expect(
      tokenStatus({ ...serviceToken, revokedAt: now - DAY, expiresAt: now - HOUR }, now),
    ).toEqual({
      status: "neutral",
      label: "Revoked",
    });
  });
  it("expired, expiring (< 7 days) and active boundaries", () => {
    expect(tokenStatus({ ...serviceToken, expiresAt: now }, now).label).toBe("Expired");
    expect(tokenStatus({ ...serviceToken, expiresAt: now + 7 * DAY - HOUR }, now)).toEqual({
      status: "warning",
      label: "Expiring",
    });
    expect(tokenStatus({ ...serviceToken, expiresAt: now + 7 * DAY }, now)).toEqual({
      status: "success",
      label: "Active",
    });
  });
});

describe("inviteStatus", () => {
  it("maps pending, accepted, expired and revoked", () => {
    expect(inviteStatus(invite, invite.createdAt)).toEqual({ status: "info", label: "Pending" });
    expect(inviteStatus({ ...invite, acceptedAt: now }, now).label).toBe("Accepted");
    expect(inviteStatus(invite, invite.expiresAt).label).toBe("Expired");
    expect(inviteStatus({ ...invite, revokedAt: invite.createdAt }, invite.createdAt).label).toBe(
      "Revoked",
    );
  });
});

describe("tones and labels", () => {
  it("environmentTone maps dev/staging/prod and falls back to feature", () => {
    expect(environmentTone("prod")).toBe("error");
    expect(environmentTone("staging")).toBe("warning");
    expect(environmentTone("dev")).toBe("information");
    expect(environmentTone("qa")).toBe("feature");
  });
  it("roleLabel", () => {
    expect(roleLabel("developer")).toBe("Developer");
    expect(roleLabel("owner")).toBe("Owner");
  });
});

describe("format", () => {
  it("formatDate is en-US short", () => {
    expect(formatDate(Date.UTC(2026, 3, 2, 12))).toBe("Apr 2, 2026");
  });
  it("formatRelative", () => {
    expect(formatRelative(now - 3 * 60_000, now)).toBe("3 minutes ago");
    expect(formatRelative(now + 2 * DAY, now)).toBe("in 2 days");
  });
});
