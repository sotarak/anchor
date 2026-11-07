import { env } from "cloudflare:workers";
import type { KeyRotationDto, ProjectKeyDto, SecretDto } from "@anchor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import { getRootKeyring, type RootKeyring } from "#src/crypto/keyring";
import {
  processRotationBatch,
  type ReencryptMessage,
  startOrResumeRotation,
} from "#src/keys/rotation";
import { ApiError } from "#src/lib/errors";
import { getProjectBySlug, listEnvironments, type ProjectRow } from "#src/projects/repo";
import { putSecret, type SecretContext } from "#src/secrets/service";
import {
  auditRows,
  createMember,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_ORIGIN,
} from "#test/support";

const app = createApp();
const db = env.DB;
let owner: string;
let keyring: RootKeyring;
let queue: { send: ReturnType<typeof vi.fn> };
const asQueue = (q: typeof queue) => q as unknown as Queue<ReencryptMessage>;
let spies: ReturnType<typeof vi.spyOn>[] = [];

/** Requests through the app with a fake queue bound. */
const call = (path: string, init: RequestInit = {}) =>
  app.request(TEST_ORIGIN + path, init, { ...env, REENCRYPT_QUEUE: queue });
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const secrets = (rest = "") => `/api/v1/projects/app/environments/dev/secrets${rest}`;
const put = (key: string, value: string) =>
  call(secrets(`/${key}`), jsonInit("PUT", { value }, { token: owner }));
const rotate = (t = owner) =>
  call("/api/v1/projects/app/keys/rotate", jsonInit("POST", {}, { token: t }));
const keyStatus = async () =>
  json<{ keys: ProjectKeyDto[]; rotations: KeyRotationDto[] }>(
    await call("/api/v1/projects/app/keys", bearer(owner)),
  );
const keyVersionsInUse = async () =>
  (
    await db
      .prepare(
        "SELECT key_version AS k, COUNT(*) AS n FROM secret_versions GROUP BY key_version ORDER BY k",
      )
      .all<{ k: number; n: number }>()
  ).results;
const lastMessage = (): ReencryptMessage => queue.send.mock.calls.at(-1)?.[0];

async function readAll(): Promise<Record<string, string>> {
  const res = await call(secrets("?reveal=true"), bearer(owner));
  expect(res.status).toBe(200);
  const { secrets: list } = await json<{ secrets: SecretDto[] }>(res);
  return Object.fromEntries(list.map((s) => [s.key, s.value ?? ""]));
}

/** Writes `n` secrets (one version each) straight through the API. */
async function seed(n: number): Promise<Record<string, string>> {
  const expected: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const key = `K${String(i).padStart(3, "0")}`;
    expected[key] = `value-${i}`;
    expect((await put(key, expected[key])).status).toBe(201);
  }
  return expected;
}

beforeEach(async () => {
  await resetDb();
  spies = ["log", "info", "warn", "error"].map((m) =>
    vi.spyOn(console, m as "log").mockImplementation(() => {}),
  );
  queue = { send: vi.fn(async () => {}) };
  keyring = await getRootKeyring(env);
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await call(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("KEK rotation", () => {
  it("rotate creates v2, marks v1 retiring, new writes use v2", async () => {
    await seed(2);
    const res = await rotate();
    expect(res.status).toBe(202);
    const { rotation } = await json<{ rotation: KeyRotationDto }>(res);
    expect(rotation).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      status: "running",
      total: 2,
      done: 0,
    });
    expect(queue.send).toHaveBeenCalledWith({
      type: "reencrypt",
      rotationId: rotation.id,
      projectId: expect.any(String),
      toVersion: 2,
    });
    const { keys } = await keyStatus();
    expect(keys.map((k) => [k.version, k.status, k.rootKeyId])).toEqual([
      [2, "active", "rk-test"],
      [1, "retiring", "rk-test"],
    ]);
    expect((await put("NEW", "after")).status).toBe(201);
    expect(await keyVersionsInUse()).toEqual([
      { k: 1, n: 2 },
      { k: 2, n: 1 },
    ]);
    const [started] = await auditRows("kek.rotation_started");
    expect(JSON.parse(started?.metadata ?? "null")).toEqual({
      fromVersion: 1,
      toVersion: 2,
      total: 2,
    });
  });

  it("250 versions: three batches -> done; v1 retired only after the last; readable after each", async () => {
    const expected = await seed(250);
    expect((await rotate()).status).toBe(202);
    const msg = lastMessage();
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(await processRotationBatch(db, keyring, msg, Date.now()));
      expect(await readAll()).toEqual(expected);
      const { keys, rotations } = await keyStatus();
      const v1 = keys.find((k) => k.version === 1);
      if (i < 2) {
        expect(v1?.status).toBe("retiring");
        expect(rotations[0]).toMatchObject({ status: "running", done: (i + 1) * 100, total: 250 });
      } else {
        expect(v1?.status).toBe("retired");
        expect(rotations[0]).toMatchObject({ status: "completed", done: 250, total: 250 });
        expect(rotations[0]?.finishedAt).toEqual(expect.any(Number));
      }
    }
    expect(results).toEqual(["more", "more", "done"]);
    expect(await keyVersionsInUse()).toEqual([{ k: 2, n: 250 }]);
    expect(await auditRows("kek.rotation_finished")).toHaveLength(1);
  }, 120_000);

  it("duplicate delivery of the same message is harmless", async () => {
    const expected = await seed(30);
    await rotate();
    const msg = lastMessage();
    const outcomes = await Promise.all([
      processRotationBatch(db, keyring, msg, Date.now()),
      processRotationBatch(db, keyring, msg, Date.now()),
    ]);
    expect(outcomes).toEqual(["done", "done"]);
    expect(await readAll()).toEqual(expected);
    const { rotations } = await keyStatus();
    expect(rotations[0]).toMatchObject({ status: "completed", done: 30, total: 30 });
    expect(await auditRows("kek.rotation_finished")).toHaveLength(1);
    // A late redelivery after completion does nothing.
    expect(await processRotationBatch(db, keyring, msg, Date.now())).toBe("done");
  });

  it("a failed finish audit leaves the rotation running, so the retry completes it and audits once", async () => {
    await seed(3);
    await rotate();
    const msg = lastMessage();
    await db
      .prepare(
        `CREATE TRIGGER fail_finish_audit BEFORE INSERT ON audit_events
         WHEN NEW.action = 'kek.rotation_finished' BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
      )
      .run();
    await expect(processRotationBatch(db, keyring, msg, Date.now())).rejects.toThrow();
    const { keys, rotations } = await keyStatus();
    expect(rotations[0]?.status).toBe("running");
    expect(keys.find((k) => k.version === 1)?.status).toBe("retiring");

    await db.prepare("DROP TRIGGER fail_finish_audit").run();
    expect(await processRotationBatch(db, keyring, msg, Date.now())).toBe("done");
    expect((await keyStatus()).rotations[0]?.status).toBe("completed");
    expect(await auditRows("kek.rotation_finished")).toHaveLength(1);
  });

  /** A write that loaded the project before the rotation began: it still encrypts under KEK v1. */
  async function staleWriter(stale: ProjectRow) {
    const [environment] = await listEnvironments(db, stale.id);
    if (!environment) throw new Error("no environment");
    const ctx: SecretContext = {
      db,
      keyring,
      project: stale,
      environment,
      actorId: null,
      now: Date.now(),
    };
    return (key: string, value: string) => putSecret(ctx, { path: "/", key, value, comment: "" });
  }

  it("a stale write landing just before the finish keeps v1 retiring and is re-encrypted next", async () => {
    const expected = await seed(3);
    const stale = await getProjectBySlug(db, "app");
    const write = await staleWriter(stale);
    await rotate();
    const msg = lastMessage();
    let batches = 0;
    // Between the batch's remaining-count and its finish, the stale writer lands a v1 version.
    const racingDb = new Proxy(db, {
      get(target, prop) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            batches += 1;
            if (batches === 2) await write("LATE", "late-value");
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await processRotationBatch(racingDb, keyring, msg, Date.now())).toBe("more");
    const mid = await keyStatus();
    expect(mid.rotations[0]?.status).toBe("running");
    expect(mid.keys.find((k) => k.version === 1)?.status).toBe("retiring");
    expect(await auditRows("kek.rotation_finished")).toHaveLength(0);

    expect(await processRotationBatch(db, keyring, msg, Date.now())).toBe("done");
    expect(await keyVersionsInUse()).toEqual([{ k: 2, n: 4 }]);
    expect((await keyStatus()).keys.find((k) => k.version === 1)?.status).toBe("retired");
    expect(await readAll()).toEqual({ ...expected, LATE: "late-value" });
  });

  it("a stale write after the rotation finished is refused (409), never stored under the retired KEK", async () => {
    await seed(2);
    const stale = await getProjectBySlug(db, "app");
    const write = await staleWriter(stale);
    await rotate();
    expect(await processRotationBatch(db, keyring, lastMessage(), Date.now())).toBe("done");
    for (const attempt of [() => write("NEW_KEY", "x"), () => write("K000", "changed")]) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
    }
    expect(await keyVersionsInUse()).toEqual([{ k: 2, n: 2 }]);
    // The refused create left no secret row behind.
    expect(
      await db.prepare("SELECT COUNT(*) AS n FROM secrets WHERE key = 'NEW_KEY'").first(),
    ).toEqual({ n: 0 });
  });

  it("write during rotation lands on v2 and is not re-processed", async () => {
    await seed(3);
    await rotate();
    expect((await put("K000", "rewritten")).status).toBe(200);
    const row = await db
      .prepare(
        "SELECT v.key_version, v.ciphertext FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.key = 'K000' AND v.version = 2",
      )
      .first<{ key_version: number; ciphertext: ArrayBuffer }>();
    expect(row?.key_version).toBe(2);
    const before = new Uint8Array(row?.ciphertext ?? new ArrayBuffer(0));
    expect(await processRotationBatch(db, keyring, lastMessage(), Date.now())).toBe("done");
    const after = await db
      .prepare(
        "SELECT v.ciphertext FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.key = 'K000' AND v.version = 2",
      )
      .first<{ ciphertext: ArrayBuffer }>();
    expect(new Uint8Array(after?.ciphertext ?? new ArrayBuffer(0))).toEqual(before);
    expect((await readAll()).K000).toBe("rewritten");
  });

  it("rollback during rotation reads a v1 row and writes v2", async () => {
    await put("K", "one");
    await put("K", "two");
    await rotate();
    const res = await call(
      secrets("/K/rollback"),
      jsonInit("POST", { version: 1 }, { token: owner }),
    );
    expect(res.status).toBe(200);
    const rows = await db
      .prepare("SELECT version, key_version FROM secret_versions ORDER BY version")
      .all<{ version: number; key_version: number }>();
    expect(rows.results).toEqual([
      { version: 1, key_version: 1 },
      { version: 2, key_version: 1 },
      { version: 3, key_version: 2 },
    ]);
    expect((await readAll()).K).toBe("one");
  });

  it("rotate while running -> 202 same rotation, resumed, message re-sent, no new KEK", async () => {
    await seed(2);
    const first = await json<{ rotation: KeyRotationDto }>(await rotate());
    const again = await rotate();
    expect(again.status).toBe(202);
    const second = await json<{ rotation: KeyRotationDto }>(again);
    expect(second.rotation.id).toBe(first.rotation.id);
    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send.mock.calls[1]?.[0]).toEqual(queue.send.mock.calls[0]?.[0]);
    expect((await keyStatus()).keys.map((k) => k.version)).toEqual([2, 1]);
    expect(await auditRows("kek.rotation_started")).toHaveLength(1);
  });

  it("a failed send leaves the rotation running for the next POST to resume", async () => {
    await seed(1);
    queue.send.mockRejectedValueOnce(new Error("queue down"));
    const res = await rotate();
    expect(res.status).toBe(202);
    expect((await json<{ rotation: KeyRotationDto }>(res)).rotation.status).toBe("running");
    const project = await getProjectBySlug(db, "app");
    const resumed = await startOrResumeRotation(db, keyring, asQueue(queue), project, Date.now());
    expect(resumed.resumed).toBe(true);
    expect(queue.send).toHaveBeenCalledTimes(2);
  });

  it("project with zero secrets completes immediately", async () => {
    const res = await rotate();
    expect(res.status).toBe(202);
    const { rotation } = await json<{ rotation: KeyRotationDto }>(res);
    expect(rotation).toMatchObject({ status: "completed", total: 0, done: 0 });
    expect(queue.send).not.toHaveBeenCalled();
    expect((await keyStatus()).keys.map((k) => [k.version, k.status])).toEqual([
      [2, "active"],
      [1, "retired"],
    ]);
  });

  it("a rotate that loses the race to one already completed returns that rotation, not a 500", async () => {
    const project = await getProjectBySlug(db, "app");
    let winner: KeyRotationDto | undefined;
    // The loser has read KEK v1 as current; before its batch lands, a concurrent rotate of this
    // empty project creates v2 and completes.
    const racingDb = new Proxy(db, {
      get(target, prop) {
        if (prop === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            winner ??= (
              await startOrResumeRotation(db, keyring, asQueue(queue), project, Date.now())
            ).rotation;
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const loser = await startOrResumeRotation(
      racingDb,
      keyring,
      asQueue(queue),
      project,
      Date.now(),
    );
    expect(winner).toMatchObject({ status: "completed", toVersion: 2 });
    expect(loser).toEqual({ rotation: winner, resumed: true });
    expect((await keyStatus()).keys.map((k) => k.version)).toEqual([2, 1]);
  });

  it("tampered row -> rotation failed, other rows untouched, status shows error", async () => {
    await seed(3);
    await rotate();
    await db
      .prepare(
        "UPDATE secret_versions SET ciphertext = randomblob(length(ciphertext)) WHERE secret_id = (SELECT id FROM secrets WHERE key = 'K001')",
      )
      .run();
    const before = JSON.stringify(
      (await db.prepare("SELECT * FROM secret_versions ORDER BY secret_id").all()).results,
    );
    expect(await processRotationBatch(db, keyring, lastMessage(), Date.now())).toBe("failed");
    const after = JSON.stringify(
      (await db.prepare("SELECT * FROM secret_versions ORDER BY secret_id").all()).results,
    );
    expect(after).toBe(before);
    const { rotations, keys } = await keyStatus();
    expect(rotations[0]).toMatchObject({ status: "failed", error: "decrypt_failed" });
    expect(keys.find((k) => k.version === 1)?.status).toBe("retiring");
    const logs = spies
      .flatMap((s) => s.mock.calls)
      .map((a) => a.join(" "))
      .join("\n");
    expect(logs).toContain("secret_decrypt_failed");
  });

  it("a retired KEK still decrypts, with a retired_kek_used log", async () => {
    await seed(1);
    await rotate();
    // Force the race: a version still under v1 after v1 was marked retired.
    await db.prepare("UPDATE project_keys SET status = 'retired' WHERE version = 1").run();
    expect((await readAll()).K000).toBe("value-0");
    const logs = spies
      .flatMap((s) => s.mock.calls)
      .map((a) => a.join(" "))
      .join("\n");
    expect(logs).toContain("retired_kek_used");
  });

  it("developer -> 403; GET keys shows versions, statuses and progress", async () => {
    const dev = await createMember("app", { role: "developer" });
    expect((await rotate(dev.token)).status).toBe(403);
    expect((await call("/api/v1/projects/app/keys", bearer(dev.token))).status).toBe(403);
    const admin = await createMember("app", { role: "admin" });
    expect((await rotate(admin.token)).status).toBe(202);
    const status = await keyStatus();
    expect(status.keys).toEqual([
      { version: 2, status: "active", rootKeyId: "rk-test", createdAt: expect.any(Number) },
      { version: 1, status: "retired", rootKeyId: "rk-test", createdAt: expect.any(Number) },
    ]);
    expect(status.rotations).toEqual([
      {
        id: expect.any(String),
        fromVersion: 1,
        toVersion: 2,
        status: "completed",
        total: 0,
        done: 0,
        error: null,
        startedAt: expect.any(Number),
        finishedAt: expect.any(Number),
      },
    ]);
  });
});
