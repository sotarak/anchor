import { describe, expect, it } from "vitest";
import {
  booleanFrom,
  formatJson,
  jsonProblem,
  listItemsFrom,
  listTextFrom,
  pemLabel,
  TYPE_META,
} from "@/lib/typed-value";

describe("TYPE_META", () => {
  it("names every type with one line of help, as the spec's table", () => {
    expect(TYPE_META).toEqual({
      string: { name: "Text", help: "Any text, one or more lines" },
      number: { name: "Number", help: "An integer or decimal, such as 8080 or 0.25" },
      boolean: { name: "Boolean", help: "true or false" },
      json: { name: "JSON", help: "An object, array or any JSON value" },
      list: { name: "List", help: "Several text items, stored as a JSON array" },
      pem: { name: "PEM", help: "A certificate or key block (-----BEGIN …)" },
    });
  });
});

describe("listItemsFrom", () => {
  it("reads a JSON array of strings as its items", () => {
    expect(listItemsFrom('["a","b"]')).toEqual(["a", "b"]);
    expect(listItemsFrom('["a", "b"]')).toEqual(["a", "b"]);
  });

  it("splits other text on CRLF or LF and drops blank lines", () => {
    expect(listItemsFrom("a\r\n\r\n  \nb")).toEqual(["a", "b"]);
  });

  it("treats JSON that is not an array of strings as text", () => {
    expect(listItemsFrom('{"a":1}')).toEqual(['{"a":1}']);
    expect(listItemsFrom("[1,2]")).toEqual(["[1,2]"]);
  });

  it("an empty value has no items", () => {
    expect(listItemsFrom("")).toEqual([]);
  });
});

describe("listTextFrom", () => {
  it("stores the non-blank items as a JSON array, in order", () => {
    expect(listTextFrom(["a", "", "  ", "b c"])).toBe('["a","b c"]');
  });
});

describe("formatJson", () => {
  it("pretty-prints valid JSON with two spaces", () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it("returns null for invalid JSON", () => {
    expect(formatJson("{")).toBeNull();
  });
});

describe("jsonProblem", () => {
  it("is null for valid JSON", () => {
    expect(jsonProblem('{"a":1}')).toBeNull();
  });

  it("names the line and column when the engine reports a position", () => {
    expect(jsonProblem('{\n  "a": }')).toMatch(/^not valid JSON( at line 2, column \d+)?$/);
    expect(jsonProblem('{"a":1,\n"b"}')).toMatch(/^not valid JSON( at line 2, column \d+)?$/);
  });

  it("an empty value is not valid JSON", () => {
    expect(jsonProblem("")).toMatch(/^not valid JSON/);
  });
});

describe("pemLabel", () => {
  it("returns the label of the first BEGIN line", () => {
    expect(pemLabel("-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----")).toBe(
      "PRIVATE KEY",
    );
    expect(pemLabel("\r\n-----BEGIN CERTIFICATE-----\r\nAAA")).toBe("CERTIFICATE");
  });

  it("returns null without a BEGIN line", () => {
    expect(pemLabel("x")).toBeNull();
    expect(pemLabel("0\u0082\u0001")).toBeNull();
  });
});

describe("booleanFrom", () => {
  it("accepts exactly true or false", () => {
    expect(booleanFrom("true")).toBe("true");
    expect(booleanFrom("false")).toBe("false");
    expect(booleanFrom("True")).toBeNull();
    expect(booleanFrom(" true")).toBeNull();
  });
});
