import { afterEach, expect, it, vi } from "vitest";
import { log } from "#src/lib/log";

afterEach(() => vi.restoreAllMocks());

it("redacts sensitive keys at any depth and keeps others", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log("info", "test_event", {
    secretId: "s1",
    value: "v-marker",
    nested: { password: "p-marker", apiToken: "t-marker", name: "ok" },
  });
  const line = JSON.parse(spy.mock.calls[0]?.[0] as string);
  expect(line).toEqual({
    level: "info",
    event: "test_event",
    secretId: "[REDACTED]",
    value: "[REDACTED]",
    nested: { password: "[REDACTED]", apiToken: "[REDACTED]", name: "ok" },
  });
});

it("redacts inside arrays and routes errors to console.error", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  log("error", "e", { items: [{ cookie: "c-marker", id: 1 }] });
  const line = JSON.parse(spy.mock.calls[0]?.[0] as string);
  expect(line).toEqual({ level: "error", event: "e", items: [{ cookie: "[REDACTED]", id: 1 }] });
});
