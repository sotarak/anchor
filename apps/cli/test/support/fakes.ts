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

import type { ApiClient } from "#src/api/client";
import { ApiRequestError } from "#src/api/http";
import type { ApiFactory } from "#src/context";
import type { CredentialStore, StoredCredential } from "#src/credentials/types";
import type { Prompts } from "#src/prompts";

export type ApiCall = { method: keyof ApiClient; args: unknown[]; baseUrl: string; token?: string };

/**
 * A scripted ApiClient. Unscripted methods throw so a test notices an unexpected request.
 * `factory` is injected as CliDeps.createApi and records the base URL and token of each client.
 */
export function fakeApi(impl: Partial<ApiClient> = {}) {
  const calls: ApiCall[] = [];
  const clients: { baseUrl: string; token?: string }[] = [];
  const factory: ApiFactory = (opts) => {
    clients.push({ baseUrl: opts.baseUrl, token: opts.token });
    return new Proxy({} as ApiClient, {
      get(_target, prop: keyof ApiClient) {
        return async (...args: unknown[]) => {
          calls.push({ method: prop, args, baseUrl: opts.baseUrl, token: opts.token });
          const fn = impl[prop] as ((...a: unknown[]) => Promise<unknown>) | undefined;
          if (!fn) throw new Error(`unexpected API call: ${String(prop)}`);
          return fn(...args);
        };
      },
    });
  };
  return {
    factory,
    calls,
    clients,
    called: (m: keyof ApiClient) => calls.filter((c) => c.method === m),
  };
}

export const apiError = (status: number, code: ApiRequestError["code"], message: string = code) =>
  new ApiRequestError(status, code, message);

type Answer<T> = T | (() => T);

/** Scripted prompts: each kind answers from its queue; an unscripted prompt throws. */
export function fakePrompts(
  answers: {
    input?: Answer<string>[];
    password?: Answer<string>[];
    confirm?: Answer<boolean>[];
    select?: Answer<string>[];
  } = {},
) {
  const calls: { kind: keyof Prompts; message: string; choices?: unknown }[] = [];
  const next = <T>(kind: keyof Prompts, queue: Answer<T>[] | undefined): T => {
    const a = queue?.shift();
    if (a === undefined) throw new Error(`unexpected ${kind} prompt`);
    return typeof a === "function" ? (a as () => T)() : a;
  };
  const prompts: Prompts = {
    input: async (o) => {
      calls.push({ kind: "input", message: o.message });
      return next("input", answers.input);
    },
    password: async (o) => {
      calls.push({ kind: "password", message: o.message });
      return next("password", answers.password);
    },
    confirm: async (o) => {
      calls.push({ kind: "confirm", message: o.message });
      return next("confirm", answers.confirm);
    },
    select: async <T extends string>(o: {
      message: string;
      choices: { name: string; value: T }[];
    }) => {
      calls.push({ kind: "select", message: o.message, choices: o.choices });
      return next("select", answers.select) as T;
    },
  };
  return { prompts, calls };
}

/** An in-memory credential store. */
export function memoryStore(initial: StoredCredential[] = []) {
  const items = new Map(initial.map((c) => [c.apiUrl, c]));
  const store: CredentialStore = {
    kind: "file",
    get: async (apiUrl) => items.get(apiUrl) ?? null,
    set: async (c) => {
      items.set(c.apiUrl, c);
    },
    delete: async (apiUrl) => {
      items.delete(apiUrl);
    },
  };
  return { store, items, selectStore: async () => store };
}
