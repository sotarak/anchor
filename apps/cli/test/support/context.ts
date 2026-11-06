import { type CliDeps, type CommandContext, createContext, type GlobalFlags } from "#src/context";
import { fakeSpawner } from "./fakes";
import type { TestIo } from "./io";

export const defaultFlags: GlobalFlags = {
  json: false,
  quiet: false,
  color: false,
  debug: false,
  yes: false,
};

/** A CommandContext built the same way the CLI builds it, from injected deps. */
export function testContext(
  io: TestIo,
  flags: Partial<GlobalFlags> = {},
  deps: Partial<CliDeps> = {},
): Promise<CommandContext> {
  const unused = async () => {
    throw new Error("not used in this test");
  };
  return createContext(
    {
      io,
      prompts: { input: unused, password: unused, confirm: unused, select: unused },
      fetch: unused as unknown as typeof fetch,
      spawner: fakeSpawner().spawner,
      runChild: unused,
      ...deps,
    },
    { ...defaultFlags, ...flags },
  );
}
