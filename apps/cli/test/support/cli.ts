import { join } from "node:path";
import type { ApiClient } from "#src/api/client";
import type { CliDeps } from "#src/context";
import { fakeApi, fakePrompts, memoryStore } from "./fakes";
import { tmpDir } from "./fs";
import { createTestIo, runCli, type TestIo } from "./io";

export const TEST_API = "https://anchor.example";
export const TEST_TOKEN = "anc_s_TESTTOKEN";

/**
 * A logged-in CLI in a fresh temp working directory: ANCHOR_API_URL points at TEST_API and the
 * credential store holds a valid session. `run` executes one command with a scripted API.
 */
export async function loggedIn(
  opts: {
    env?: Record<string, string>;
    tty?: boolean;
    stdoutTTY?: boolean;
    stdin?: string;
    prompts?: Parameters<typeof fakePrompts>[0];
  } = {},
) {
  const dir = await tmpDir();
  const io = createTestIo({
    cwd: dir,
    env: {
      XDG_CONFIG_HOME: join(dir, ".xdg"),
      ANCHOR_API_URL: TEST_API,
      NO_COLOR: "1",
      ...opts.env,
    },
    stdinIsTTY: opts.tty ?? false,
    stdoutIsTTY: opts.stdoutTTY ?? opts.tty ?? false,
    stdin: opts.stdin,
  });
  const mem = memoryStore([
    { apiUrl: TEST_API, token: TEST_TOKEN, email: "dev@example.com", expiresAt: Date.now() + 1e9 },
  ]);
  const prompts = fakePrompts(opts.prompts);
  return {
    dir,
    io,
    prompts,
    async run(args: string[], api: Partial<ApiClient> = {}, extra: Partial<CliDeps> = {}) {
      const fake = fakeApi(api);
      const code = await runCli(args, {
        io,
        createApi: fake.factory,
        selectStore: mem.selectStore,
        prompts: prompts.prompts,
        ...extra,
      });
      return { code, fake, out: io.out(), err: io.err() };
    },
  };
}

export type LoggedIn = Awaited<ReturnType<typeof loggedIn>>;
export type { TestIo };
