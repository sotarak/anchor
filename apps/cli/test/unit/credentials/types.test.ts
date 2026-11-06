import { describe, expect, it } from "vitest";
import { decodeCredential, encodeCredential } from "#src/credentials/types";

const cred = { apiUrl: "https://a.example", token: "anc_s_x", email: "a@b.c", expiresAt: 5 };

describe("credential encoding", () => {
  it("round-trips and uses only base64url characters", () => {
    const encoded = encodeCredential(cred);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCredential(encoded)).toEqual(cred);
  });

  it("decodeCredential returns null for garbage and for a JSON missing token", () => {
    expect(decodeCredential("%%%not base64%%%")).toBeNull();
    expect(decodeCredential("")).toBeNull();
    const { token: _token, ...rest } = cred;
    expect(decodeCredential(Buffer.from(JSON.stringify(rest)).toString("base64url"))).toBeNull();
  });
});
