import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../src/audit";

// Copied from spec §13.6 (M2 list).
const SPEC_M2_ACTIONS = [
  "auth.setup",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.password_changed",
  "auth.password_reset",
  "session.revoked",
  "user.updated",
  "user.deleted",
  "invite.created",
  "invite.revoked",
  "invite.accepted",
  "password_reset.created",
  "project.created",
  "project.updated",
  "project.deleted",
  "environment.created",
  "environment.updated",
  "environment.deleted",
  "member.added",
  "member.updated",
  "member.removed",
  "service_token.created",
  "service_token.revoked",
  "secret.read",
  "secret.created",
  "secret.updated",
  "secret.deleted",
];

// Copied from spec §13.6 (M5 additions).
const SPEC_M5_ACTIONS = [
  "secret.rolled_back",
  "secret.version_read",
  "folder.created",
  "folder.deleted",
  "import.created",
  "import.deleted",
  "kek.rotation_started",
  "kek.rotation_finished",
  "root_key.rewrapped",
];

describe("AUDIT_ACTIONS", () => {
  it("AUDIT_ACTIONS contains every M2 and M5 action in spec §13.6", () => {
    expect([...AUDIT_ACTIONS]).toEqual([...SPEC_M2_ACTIONS, ...SPEC_M5_ACTIONS]);
  });
});
