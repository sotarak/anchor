import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "#src/program";
import { createTestIo, fakeApi, fakePrompts, fakeSpawner } from "#test/support";

function allCommands(cmd: Command, prefix: string[] = []): { name: string; cmd: Command }[] {
  return cmd.commands.flatMap((sub) => {
    const path = [...prefix, sub.name()];
    return [{ name: path.join(" "), cmd: sub }, ...allCommands(sub, path)];
  });
}

/** The help text exactly as `--help` prints it, including addHelpText sections. */
function fullHelp(cmd: Command, io: ReturnType<typeof createTestIo>): string {
  const before = io.out().length;
  cmd.outputHelp();
  return io.out().slice(before);
}

describe("help text", () => {
  const io = createTestIo();
  const program = buildProgram({
    io,
    prompts: fakePrompts().prompts,
    fetch: (async () => new Response()) as typeof fetch,
    spawner: fakeSpawner().spawner,
    runChild: async () => ({ code: 0, signal: null }),
    createApi: fakeApi().factory,
  });
  const commands = [{ name: "anchor", cmd: program }, ...allCommands(program)];

  it.each(commands.map((c) => [c.name, c.cmd] as const))("help for %s", (name, cmd) => {
    const help = fullHelp(cmd, io);
    expect(help).toMatchSnapshot();
    expect(help).not.toMatch(/--token\b/);
    expect(help).not.toMatch(/--value\b/);
    if (cmd.commands.length === 0 && name !== "anchor") expect(help).toContain("Example");
  });

  it("covers every documented command", () => {
    expect(commands.map((c) => c.name).sort()).toEqual(
      [
        "anchor",
        "envs",
        "envs list",
        "export",
        "folders",
        "folders create",
        "folders delete",
        "folders list",
        "init",
        "login",
        "logout",
        "projects",
        "projects list",
        "run",
        "secrets",
        "secrets delete",
        "secrets get",
        "secrets history",
        "secrets list",
        "secrets rollback",
        "secrets set",
        "tokens",
        "tokens create",
        "tokens list",
        "tokens revoke",
        "whoami",
      ].sort(),
    );
  });
});
