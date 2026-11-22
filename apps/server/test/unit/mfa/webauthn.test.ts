import { describe, expect, it } from "vitest";
import {
  authenticationOptions,
  credentialIdOf,
  registrationOptions,
  relyingPartyFor,
  verifyAuthentication,
  verifyRegistration,
} from "#src/mfa/webauthn";
import { createSoftAuthenticator } from "#test/support";

const RP = { id: "anchor.test", origin: "https://anchor.test" };
const USER = { id: "u-1", email: "dev@example.io", name: "Dev" };

async function registered() {
  const auth = await createSoftAuthenticator({ rpId: RP.id, origin: RP.origin });
  const { challenge } = await registrationOptions(RP, USER, []);
  const passkey = await verifyRegistration(RP, await auth.register({ challenge }), challenge);
  if (!passkey) throw new Error("registration failed");
  return { auth, passkey };
}

describe("webauthn wrapper", () => {
  it("register then authenticate round-trips and returns the next counter", async () => {
    const { auth, passkey } = await registered();
    expect(passkey.id).toBe(auth.credentialId);
    expect(passkey.counter).toBe(0);
    const { challenge, options } = await authenticationOptions(RP, [
      { id: passkey.id, transports: passkey.transports },
    ]);
    expect(JSON.stringify(options)).toContain(passkey.id);
    const result = await verifyAuthentication(
      RP,
      await auth.authenticate({ challenge }),
      challenge,
      passkey,
    );
    expect(result).toEqual({ newCounter: 1 });
  });

  it("registration options carry the relying party and the user", async () => {
    const { options, challenge } = await registrationOptions(RP, USER, [
      { id: "abc", transports: null },
    ]);
    const o = options as {
      rp: { id: string; name: string };
      user: { name: string; displayName: string };
      challenge: string;
      attestation: string;
      excludeCredentials: { id: string }[];
    };
    expect(o.rp).toEqual({ id: "anchor.test", name: "Anchor" });
    expect(o.user.name).toBe(USER.email);
    expect(o.user.displayName).toBe(USER.name);
    expect(o.challenge).toBe(challenge);
    expect(o.attestation).toBe("none");
    expect(o.excludeCredentials.map((c) => c.id)).toEqual(["abc"]);
  });

  it("registration with a different origin returns null", async () => {
    const auth = await createSoftAuthenticator({ rpId: RP.id, origin: RP.origin });
    const { challenge } = await registrationOptions(RP, USER, []);
    const response = await auth.register({ challenge }, { origin: "https://evil.test" });
    expect(await verifyRegistration(RP, response, challenge)).toBeNull();
  });

  it("registration answering a different challenge returns null", async () => {
    const auth = await createSoftAuthenticator({ rpId: RP.id, origin: RP.origin });
    const { challenge } = await registrationOptions(RP, USER, []);
    const other = await registrationOptions(RP, USER, []);
    const response = await auth.register({ challenge: other.challenge });
    expect(await verifyRegistration(RP, response, challenge)).toBeNull();
  });

  it("assertion from another rpId returns null", async () => {
    const { passkey } = await registered();
    const stranger = await createSoftAuthenticator({ rpId: "other.test", origin: RP.origin });
    const { challenge } = await authenticationOptions(RP, []);
    const response = (await stranger.authenticate({ challenge })) as { id: string };
    response.id = passkey.id;
    expect(await verifyAuthentication(RP, response, challenge, passkey)).toBeNull();
  });

  it("tampered signature returns null", async () => {
    const { auth, passkey } = await registered();
    const { challenge } = await authenticationOptions(RP, []);
    const response = await auth.authenticate({ challenge }, { tamper: true });
    expect(await verifyAuthentication(RP, response, challenge, passkey)).toBeNull();
  });

  it("counter lower than the stored one returns null", async () => {
    const { auth, passkey } = await registered();
    const { challenge } = await authenticationOptions(RP, []);
    const response = await auth.authenticate({ challenge }, { counter: 3 });
    expect(
      await verifyAuthentication(RP, response, challenge, { ...passkey, counter: 5 }),
    ).toBeNull();
  });

  it("garbage input returns null and does not throw", async () => {
    const { passkey } = await registered();
    for (const junk of [{}, "x", null, { id: 1, response: "nope" }]) {
      expect(await verifyRegistration(RP, junk, "c")).toBeNull();
      expect(await verifyAuthentication(RP, junk, "c", passkey)).toBeNull();
    }
  });

  it("credentialIdOf reads a bounded string id only", () => {
    expect(credentialIdOf({ id: "abc_-" })).toBe("abc_-");
    expect(credentialIdOf({ id: 5 })).toBeNull();
    expect(credentialIdOf({ id: "a".repeat(1025) })).toBeNull();
    expect(credentialIdOf({ id: "not base64url!" })).toBeNull();
    expect(credentialIdOf(null)).toBeNull();
  });

  it("relyingPartyFor takes the hostname and the origin of the request", () => {
    expect(relyingPartyFor("https://a.example:8443/api/v1/x")).toEqual({
      id: "a.example",
      origin: "https://a.example:8443",
    });
  });
});

describe("webauthn wrapper on the http test origin", () => {
  it("round-trips on http://anchor.test, the origin API tests use", async () => {
    const rp = { id: "anchor.test", origin: "http://anchor.test" };
    const auth = await createSoftAuthenticator({ rpId: rp.id, origin: rp.origin });
    const reg = await registrationOptions(rp, USER, []);
    const passkey = await verifyRegistration(rp, await auth.register(reg), reg.challenge);
    expect(passkey).not.toBeNull();
  });
});
