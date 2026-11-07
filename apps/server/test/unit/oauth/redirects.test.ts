import { describe, expect, it } from "vitest";
import { verifyPkceS256 } from "#src/oauth/pkce";
import { isAllowedRedirect, isValidRedirectUri } from "#src/oauth/redirects";
import { challengeFor } from "#test/support";

describe("isValidRedirectUri", () => {
  it.each([
    "https://app.example/cb",
    "http://localhost/cb",
    "http://localhost:3000/cb",
    "http://127.0.0.1:9/cb",
    "http://[::1]:8080/cb",
  ])("accepts %s", (uri) => expect(isValidRedirectUri(uri)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "http://evil.example/cb",
    "http://localhost.evil.example/cb",
    "https://app.example/cb#frag",
    "cursor://cb",
    "data:text/html,x",
    "not a url",
    "https://user:pass@app.example/cb",
  ])("refuses %s", (uri) => expect(isValidRedirectUri(uri)).toBe(false));
});

describe("isAllowedRedirect", () => {
  const registered = ["http://localhost:3000/callback", "https://app.example/cb"];

  it("matches exactly, and a loopback redirect on any port", () => {
    expect(isAllowedRedirect(registered, "https://app.example/cb")).toBe(true);
    expect(isAllowedRedirect(registered, "http://localhost:3000/callback")).toBe(true);
    expect(isAllowedRedirect(registered, "http://localhost:51234/callback")).toBe(true);
    expect(isAllowedRedirect(registered, "http://localhost/callback")).toBe(true);
  });

  it.each([
    "https://app.example/cb/",
    "https://app.example/other",
    "https://app.example:8443/cb",
    "http://app.example/cb",
    "http://127.0.0.1:3000/callback",
    "https://localhost:3000/callback",
    "http://localhost:3000/other",
    "http://localhost:3000/callback?x=1",
    "http://localhost:3000/callback#f",
  ])("refuses %s", (uri) => expect(isAllowedRedirect(registered, uri)).toBe(false));
});

describe("verifyPkceS256", () => {
  it("accepts the verifier whose S256 challenge matches, refuses others", async () => {
    const verifier = "a".repeat(43);
    const challenge = await challengeFor(verifier);
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
    expect(await verifyPkceS256("b".repeat(43), challenge)).toBe(false);
    expect(await verifyPkceS256(verifier, verifier)).toBe(false);
  });

  it("refuses verifiers outside 43-128 unreserved characters", async () => {
    for (const bad of ["a".repeat(42), "a".repeat(129), `${"a".repeat(42)}!`]) {
      expect(await verifyPkceS256(bad, await challengeFor(bad))).toBe(false);
    }
  });
});
