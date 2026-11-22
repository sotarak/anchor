import { type CBORType, encodeCBOR } from "@levischuck/tiny-cbor";
import { toBase64Url, utf8Encode } from "#src/lib/encoding";

/**
 * A software WebAuthn authenticator for tests: ES256 (P-256) key, "none" attestation, UP+UV.
 * Produces the JSON a browser's @simplewebauthn/browser would post. Test-only.
 */
export type SoftAuthenticator = {
  credentialId: string;
  /** COSE public key bytes, so factories can insert the credential directly. */
  cosePublicKey: Uint8Array;
  register(options: { challenge: string }, o?: { origin?: string }): Promise<unknown>;
  authenticate(
    options: { challenge: string },
    o?: { counter?: number; origin?: string; tamper?: boolean },
  ): Promise<unknown>;
};

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

/** WebCrypto signs ECDSA as raw r||s; WebAuthn ES256 signatures are DER. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v: Uint8Array = bytes.slice(i);
    if ((v[0] ?? 0) & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export async function createSoftAuthenticator(o: {
  rpId: string;
  origin: string;
}): Promise<SoftAuthenticator> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const fromB64Url = (s: string) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const cosePublicKey = encodeCBOR(
    new Map<number, Uint8Array | number>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, fromB64Url(jwk.x ?? "")],
      [-3, fromB64Url(jwk.y ?? "")],
    ]),
  );
  const rawId = crypto.getRandomValues(new Uint8Array(16));
  const credentialId = toBase64Url(rawId);
  const rpIdHash = await sha256(utf8Encode(o.rpId));
  let counter = 0;

  const clientData = (type: string, challenge: string, origin: string) =>
    utf8Encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    credentialId,
    cosePublicKey,
    async register(options, r = {}) {
      const authData = concat(
        rpIdHash,
        new Uint8Array([FLAG_UP | FLAG_UV | FLAG_AT]),
        u32(counter),
        new Uint8Array(16),
        new Uint8Array([0, rawId.length]),
        rawId,
        cosePublicKey,
      );
      const attestationObject = encodeCBOR(
        new Map<string, CBORType>([
          ["fmt", "none"],
          ["attStmt", new Map<string, CBORType>()],
          ["authData", authData],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(
            clientData("webauthn.create", options.challenge, r.origin ?? o.origin),
          ),
          attestationObject: toBase64Url(attestationObject),
          transports: ["internal"],
        },
      };
    },
    async authenticate(options, a = {}) {
      counter = a.counter ?? counter + 1;
      const authData = concat(rpIdHash, new Uint8Array([FLAG_UP | FLAG_UV]), u32(counter));
      const cdj = clientData("webauthn.get", options.challenge, a.origin ?? o.origin);
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          keys.privateKey,
          concat(authData, await sha256(cdj)),
        ),
      );
      const signature = rawToDer(raw);
      if (a.tamper) signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 1;
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: toBase64Url(cdj),
          authenticatorData: toBase64Url(authData),
          signature: toBase64Url(signature),
        },
      };
    },
  };
}

/** A soft authenticator scoped to another relying party (for rpId mismatch tests). */
export function rpOf(origin: string): { rpId: string; origin: string } {
  return { rpId: new URL(origin).hostname, origin };
}
