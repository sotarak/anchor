import type { Spawner } from "#src/context";

export type SpawnCall = { cmd: string; args: string[]; input: string | undefined };
export type SpawnResult = { code: number; stdout?: string; stderr?: string };

/**
 * A Spawner that records every call and answers from `respond`. Returning "ENOENT" simulates
 * a missing binary (the promise rejects with code ENOENT, like child_process does).
 */
export function fakeSpawner(
  respond: (call: SpawnCall) => SpawnResult | "ENOENT" = () => ({ code: 0 }),
) {
  const calls: SpawnCall[] = [];
  const spawner: Spawner = async (cmd, args, opts) => {
    const call = { cmd, args, input: opts?.input };
    calls.push(call);
    const result = respond(call);
    if (result === "ENOENT") {
      throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    }
    return { code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { spawner, calls };
}
