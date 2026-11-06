import { describe, expect, it } from "vitest";
import { normalizeApiUrl } from "#src/config/api-url";
import { CliError, EXIT } from "#src/errors";

function usageError(input: string): CliError {
  try {
    normalizeApiUrl(input);
  } catch (e) {
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).exitCode).toBe(EXIT.USAGE);
    return e as CliError;
  }
  throw new Error(`expected ${input} to be rejected`);
}

describe("normalizeApiUrl", () => {
  it("strips path and trailing slash; rejects http://example.com; allows http://localhost:8787", () => {
    expect(normalizeApiUrl("https://anchor.example.com/")).toBe("https://anchor.example.com");
    expect(normalizeApiUrl("https://Anchor.Example.com/api/v1?x=1")).toBe(
      "https://anchor.example.com",
    );
    expect(normalizeApiUrl("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(normalizeApiUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeApiUrl("http://[::1]:8787")).toBe("http://[::1]:8787");

    const insecure = usageError("http://example.com/x");
    expect(insecure.message).toBe("Refusing to use insecure http:// API URL http://example.com");
    expect(insecure.hint).toBe("Use https://");
    expect(usageError("not a url").message).toBe("Invalid API URL: not a url");
    expect(usageError("ftp://example.com").message).toBe("Invalid API URL: ftp://example.com");
  });
});
