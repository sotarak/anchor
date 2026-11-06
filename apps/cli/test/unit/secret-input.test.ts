import { describe, expect, it } from "vitest";
import { CliError, EXIT } from "#src/errors";
import { assertNoSecretInArgv } from "#src/secret-input";

function rejects(argv: string[]): CliError {
  try {
    assertNoSecretInArgv(argv);
  } catch (e) {
    expect(e).toBeInstanceOf(CliError);
    return e as CliError;
  }
  throw new Error(`expected ${argv.join(" ")} to be rejected`);
}

describe("assertNoSecretInArgv", () => {
  it("rejects --value, --value=x and 'secrets set KEY=hunter2' without echoing hunter2", () => {
    for (const argv of [
      ["secrets", "set", "KEY", "--value", "hunter2"],
      ["secrets", "set", "KEY", "--value=hunter2"],
      ["secrets", "set", "KEY=hunter2"],
      ["--env", "prod", "secrets", "set", "--path", "/api", "KEY=hunter2"],
      ["secrets", "set", "--comment", "rotated", "KEY=hunter2"],
    ]) {
      const e = rejects(argv);
      expect(e.exitCode).toBe(EXIT.USAGE);
      expect(e.message).toBe("Secret values are not accepted as command-line arguments");
      expect(e.hint).toBe("Pipe the value on stdin or use --from-file <path>");
      expect(`${e.message}${e.hint}`).not.toContain("hunter2");
    }
  });

  it("rejects near-miss forms of 'secrets set' without echoing the value", () => {
    for (const argv of [
      ["secrets", "set", "KEY", "hunter2"],
      ["secrets", "--env", "dev", "set", "KEY=hunter2"],
      ["--json", "secrets", "--path", "/api", "set", "KEY", "hunter2"],
      ["secrets", "set", "--", "KEY=hunter2"],
      ["secrets", "set", "KEY", "--", "hunter2"],
    ]) {
      const e = rejects(argv);
      expect(e.exitCode).toBe(EXIT.USAGE);
      expect(`${e.message}${e.hint}`).not.toContain("hunter2");
    }
  });

  it("allows normal invocations, '=' in option values, and anything after --", () => {
    for (const argv of [
      ["secrets", "set", "KEY"],
      ["secrets", "--env", "dev", "set", "KEY"],
      ["secrets", "set", "--", "KEY"],
      ["secrets", "set", "KEY", "--comment", "a=b"],
      ["secrets", "set", "--comment=a=b", "KEY"],
      ["secrets", "get", "KEY"],
      ["run", "--", "node", "app.js", "--value", "x", "A=B"],
      ["export", "--format", "dotenv"],
    ]) {
      expect(() => assertNoSecretInArgv(argv)).not.toThrow();
    }
  });
});
