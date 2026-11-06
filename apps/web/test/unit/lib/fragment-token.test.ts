import { afterEach, describe, expect, it, vi } from "vitest";
import { takeFragmentToken } from "@/lib/fragment-token";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("takeFragmentToken", () => {
  it("takeFragmentToken returns the token and strips the hash", () => {
    window.history.replaceState(null, "", "/accept-invite?x=1#token=anc_inv_abc123");
    expect(takeFragmentToken("anc_inv_")).toBe("anc_inv_abc123");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/accept-invite?x=1");
  });

  it("strips the hash even for a wrong prefix and returns null", () => {
    window.history.replaceState(null, "", "/reset-password#token=anc_inv_abc123");
    expect(takeFragmentToken("anc_rst_")).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("returns null without touching history when no hash", () => {
    window.history.replaceState(null, "", "/accept-invite");
    const spy = vi.spyOn(window.history, "replaceState");
    expect(takeFragmentToken("anc_inv_")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
