import { describe, expect, it } from "vitest";
import { toBase64Url } from "#src/lib/encoding";
import { etagFor, etagMatches } from "#src/secrets/etag";

const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));
const sha256Tag = async (body: string) => {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${toBase64Url(d.slice(0, 16))}"`;
};

describe("etagFor", () => {
  it("is a quoted 22-char base64url tag, stable for one body and key", async () => {
    const t = await etagFor({ ANCHOR_ROOT_KEY: KEY_A }, '{"secrets":[]}');
    expect(t).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(await etagFor({ ANCHOR_ROOT_KEY: KEY_A }, '{"secrets":[]}')).toBe(t);
  });

  it("changes with the body and with the key, and is not an unkeyed hash", async () => {
    const body = '{"secrets":[{"key":"A","value":"hunter2"}]}';
    const a = await etagFor({ ANCHOR_ROOT_KEY: KEY_A }, body);
    expect(await etagFor({ ANCHOR_ROOT_KEY: KEY_B }, body)).not.toBe(a);
    expect(await etagFor({ ANCHOR_ROOT_KEY: KEY_A }, `${body} `)).not.toBe(a);
    expect(a).not.toBe(await sha256Tag(body));
  });
});

describe("etagMatches", () => {
  const t = '"abc"';
  it.each([
    [undefined, false],
    ["", false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ["*", true],
    ['"abd"', false],
    ["abc", false],
  ])("%j → %s", (header, ok) => expect(etagMatches(header, t)).toBe(ok));
});
