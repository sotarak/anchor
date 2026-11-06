import { describe, expect, it } from "vitest";
import { type Action, authorize } from "../src/authz/policy";
import type { Principal } from "../src/env";
import { ApiError } from "../src/lib/errors";

const ACTIONS: Action[] = [
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "environment:manage",
  "secret:read",
  "secret:write",
];

const principal = (role: Principal["role"]): Principal => ({
  type: "user",
  userId: "u",
  email: "u@x.io",
  name: "U",
  role,
  sessionId: "s",
});

describe("authorize (M1 rules)", () => {
  it("allows owner and admin for every action and denies member for every action", () => {
    for (const action of ACTIONS) {
      expect(() => authorize(principal("owner"), action, { projectId: "p" })).not.toThrow();
      expect(() => authorize(principal("admin"), action)).not.toThrow();
      let err: unknown;
      try {
        authorize(principal("member"), action, { projectId: "p" });
      } catch (e) {
        err = e;
      }
      expect(err, action).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).code).toBe("forbidden");
      expect((err as ApiError).message).toBe("You do not have permission to perform this action");
    }
  });
});
