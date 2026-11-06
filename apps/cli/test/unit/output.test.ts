import { describe, expect, it } from "vitest";
import { CliError, EXIT } from "#src/errors";
import { Output, shouldUseColor } from "#src/output";
import { createTestIo } from "#test/support";

const opts = { json: false, quiet: false, noColor: true, debug: false };

describe("Output", () => {
  it("json mode writes exactly one JSON document to stdout and nothing else", () => {
    const io = createTestIo();
    const out = new Output(io, { ...opts, json: true });
    out.info("progress");
    out.data({ a: 1, b: ["x"] }, () => "human text");
    expect(JSON.parse(io.out())).toEqual({ a: 1, b: ["x"] });
    expect(io.out()).toBe(`${JSON.stringify({ a: 1, b: ["x"] }, null, 2)}\n`);
    expect(io.out()).not.toContain("human text");
    expect(io.err()).toBe("");
  });

  it("human mode writes human text with a trailing newline", () => {
    const io = createTestIo();
    new Output(io, opts).data({ a: 1 }, () => "hello");
    expect(io.out()).toBe("hello\n");
  });

  it("info is suppressed by --quiet and by --json, warn is not", () => {
    for (const mode of [{ quiet: true }, { json: true }]) {
      const io = createTestIo();
      const out = new Output(io, { ...opts, ...mode });
      out.info("hidden");
      out.warn("careful");
      expect(io.err()).toBe("warning: careful\n");
      expect(io.out()).toBe("");
    }
    const io = createTestIo();
    new Output(io, opts).info("shown");
    expect(io.err()).toBe("shown\n");
  });

  it("debug lines appear only with --debug", () => {
    const quiet = createTestIo();
    new Output(quiet, opts).debug("GET /x");
    expect(quiet.err()).toBe("");
    const loud = createTestIo();
    new Output(loud, { ...opts, debug: true }).debug("GET /x");
    expect(loud.err()).toBe("debug: GET /x\n");
  });

  it("error prints message and hint on stderr only", () => {
    const io = createTestIo();
    new Output(io, opts).error(new CliError(EXIT.AUTH, "Not logged in", "Run 'anchor login'"));
    expect(io.err()).toBe("error: Not logged in\nhint: Run 'anchor login'\n");
    expect(io.out()).toBe("");
  });

  it("table pads columns with spaces and no borders", () => {
    const out = new Output(createTestIo(), opts);
    expect(
      out.table(
        ["SLUG", "NAME"],
        [
          ["app", "Application"],
          ["website", "Web"],
        ],
      ),
    ).toBe("SLUG     NAME\napp      Application\nwebsite  Web");
  });
});

describe("shouldUseColor", () => {
  const tty = { stdoutIsTTY: true, stderrIsTTY: true };
  it("is true for a TTY with no opt-outs", () => {
    expect(shouldUseColor("stdout", createTestIo(tty), false)).toBe(true);
  });

  it("is false when NO_COLOR is set, TERM=dumb, stream not a TTY, or --no-color", () => {
    expect(shouldUseColor("stdout", createTestIo({ ...tty, env: { NO_COLOR: "1" } }), false)).toBe(
      false,
    );
    expect(shouldUseColor("stdout", createTestIo({ ...tty, env: { TERM: "dumb" } }), false)).toBe(
      false,
    );
    expect(shouldUseColor("stdout", createTestIo({ stderrIsTTY: true }), false)).toBe(false);
    expect(shouldUseColor("stderr", createTestIo({ stdoutIsTTY: true }), false)).toBe(false);
    expect(shouldUseColor("stdout", createTestIo(tty), true)).toBe(false);
  });
});
