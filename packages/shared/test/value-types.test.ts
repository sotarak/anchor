import { describe, expect, it } from "vitest";
import { checkTypedValue, decodeTypedValue, type SecretValueType } from "../src/value-types";

const ok = (t: SecretValueType, v: string) => expect(checkTypedValue(t, v)).toEqual({ ok: true });
const bad = (t: SecretValueType, v: string, reason: string) =>
  expect(checkTypedValue(t, v)).toEqual({ ok: false, reason });
const PEM =
  "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n";

describe("checkTypedValue", () => {
  it("string accepts anything", () => {
    ok("string", "");
    ok("string", "a\nb ${X}");
  });
  it("json", () => {
    ok("json", '{"a":1}');
    ok("json", " [1, 2] ");
    ok("json", '"x"');
    ok("json", "null");
    bad("json", "{a:1}", "not valid JSON");
    bad("json", "", "not valid JSON");
  });
  it("pem", () => {
    ok("pem", PEM);
    ok("pem", PEM.replace(/\n/g, "\r\n"));
    ok("pem", PEM + PEM);
    ok(
      "pem",
      "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n\nQUJD\n-----END RSA PRIVATE KEY-----",
    );
    bad("pem", "MFkwEwYH", "not a PEM block");
    bad("pem", "-----BEGIN PUBLIC KEY-----\nQUJD\n-----END PRIVATE KEY-----", "not a PEM block");
    bad(
      "pem",
      "-----BEGIN PUBLIC KEY-----\nnot base64!\n-----END PUBLIC KEY-----",
      "not a PEM block",
    );
  });
  it("number", () => {
    for (const v of ["0", "-1", "3.14", "1e3", "2E-2"]) ok("number", v);
    for (const v of ["", " 1", "01", "1.", ".5", "+1", "0x10", "NaN", "Infinity", "1e999", "1_000"])
      bad("number", v, "not a number");
  });
  it("boolean", () => {
    ok("boolean", "true");
    ok("boolean", "false");
    for (const v of ["True", "1", "yes", " true", ""]) bad("boolean", v, "must be true or false");
  });
  it("list", () => {
    ok("list", "[]");
    ok("list", '["a","b"]');
    for (const v of ['["a",1]', '{"a":"b"}', "a,b", '"a"'])
      bad("list", v, "must be a JSON array of strings");
  });
  it("no reason contains the value", () => {
    const r = checkTypedValue("number", "hunter2");
    expect(r.ok === false && r.reason.includes("hunter2")).toBe(false);
  });
});

describe("decodeTypedValue", () => {
  it("decodes", () => {
    expect(decodeTypedValue("json", '{"a":[1]}')).toEqual({ a: [1] });
    expect(decodeTypedValue("number", "1e3")).toBe(1000);
    expect(decodeTypedValue("boolean", "false")).toBe(false);
    expect(decodeTypedValue("list", '["a"]')).toEqual(["a"]);
    expect(decodeTypedValue("pem", PEM)).toBe(PEM);
    expect(decodeTypedValue("string", "x")).toBe("x");
  });
});
