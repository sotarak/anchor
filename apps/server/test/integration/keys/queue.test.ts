import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { KeyRotationDto } from "@anchor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleScheduled } from "#src/audit/scheduled";
import { handleReencryptBatch, REENCRYPT_MAX_ATTEMPTS, sweepStaleRotations } from "#src/keys/queue";
import type { ReencryptMessage } from "#src/keys/rotation";
import { api, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

const db = env.DB;
let owner: string;
let fakeQueue: { send: ReturnType<typeof vi.fn> };
let spies: ReturnType<typeof vi.spyOn>[] = [];
const MIN = 60_000;

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const envWith = () =>
  ({ ...env, REENCRYPT_QUEUE: fakeQueue as unknown as Queue<ReencryptMessage> }) as typeof env;

async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await api(
      `/api/v1/projects/app/environments/dev/secrets/K${i}`,
      jsonInit("PUT", { value: `v${i}` }, { token: owner }),
    );
    expect(res.status).toBe(201);
  }
}

/** Inserts a running rotation row directly (the queue is not involved). */
async function runningRotation(id: string, updatedAt: number): Promise<ReencryptMessage> {
  const project = await db
    .prepare("SELECT id FROM projects WHERE slug = 'app'")
    .first<{ id: string }>();
  await db
    .prepare(
      `INSERT INTO key_rotations (id, project_id, from_version, to_version, status, total, done, started_at, updated_at)
       VALUES (?, ?, 1, 1, 'running', 0, 0, ?, ?)`,
    )
    .bind(id, project?.id, updatedAt, updatedAt)
    .run();
  return { type: "reencrypt", rotationId: id, projectId: project?.id ?? "", toVersion: 1 };
}

async function deliver(body: ReencryptMessage, attempts = 1) {
  const batch = createMessageBatch<ReencryptMessage>("anchor-reencrypt", [
    { id: "m1", timestamp: Date.now(), attempts, body },
  ]);
  // getQueueResult drops the retry options, so record them here.
  const message = batch.messages[0] as Message<ReencryptMessage>;
  const retry = vi.spyOn(message, "retry");
  const ctx = createExecutionContext();
  await handleReencryptBatch(batch, envWith());
  const result = await getQueueResult(batch, ctx);
  return { ...result, retryOptions: retry.mock.calls.map(([options]) => options) };
}

/** A rotation started through the API with the fake queue; returns its first message. */
async function startRotation(): Promise<ReencryptMessage> {
  const { createApp } = await import("#src/app");
  const res = await createApp().request(
    "http://anchor.test/api/v1/projects/app/keys/rotate",
    jsonInit("POST", {}, { token: owner }),
    envWith(),
  );
  expect(res.status).toBe(202);
  return fakeQueue.send.mock.calls.at(-1)?.[0];
}

beforeEach(async () => {
  await resetDb();
  spies = ["log", "info", "warn", "error"].map((m) =>
    vi.spyOn(console, m as "log").mockImplementation(() => {}),
  );
  fakeQueue = { send: vi.fn(async () => {}) };
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("re-encryption queue consumer", () => {
  it('"more" re-enqueues and acks', async () => {
    await seed(101);
    const msg = await startRotation();
    fakeQueue.send.mockClear();
    const result = await deliver(msg);
    expect(fakeQueue.send).toHaveBeenCalledWith(msg);
    expect(result.explicitAcks).toEqual(["m1"]);
    expect(result.retryMessages).toEqual([]);
  });

  it('"done" acks without re-enqueue', async () => {
    await seed(2);
    const msg = await startRotation();
    fakeQueue.send.mockClear();
    const result = await deliver(msg);
    expect(fakeQueue.send).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual(["m1"]);
  });

  it("thrown error -> retry, not ack", async () => {
    await seed(2);
    const msg = await startRotation();
    // The KEK row cannot be unwrapped: an integrity error the platform should retry.
    await db
      .prepare("UPDATE project_keys SET wrapped_key = randomblob(48) WHERE version = 1")
      .run();
    const result = await deliver(msg);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["m1"]);
  });

  it("retries back off exponentially so a short outage does not burn every attempt", async () => {
    await seed(2);
    const msg = await startRotation();
    await db
      .prepare("UPDATE project_keys SET wrapped_key = randomblob(48) WHERE version = 1")
      .run();
    const delays: (number | undefined)[] = [];
    for (let attempts = 1; attempts < REENCRYPT_MAX_ATTEMPTS; attempts++) {
      delays.push((await deliver(msg, attempts)).retryOptions[0]?.delaySeconds);
    }
    expect(delays).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });

  it("the last attempt of a failing batch marks the rotation failed instead of running forever", async () => {
    await seed(2);
    const msg = await startRotation();
    await db
      .prepare("UPDATE project_keys SET wrapped_key = randomblob(48) WHERE version = 1")
      .run();
    const early = await deliver(msg, REENCRYPT_MAX_ATTEMPTS - 1);
    expect(early.retryMessages.map((m) => m.msgId)).toEqual(["m1"]);
    expect(await db.prepare("SELECT status FROM key_rotations").first()).toEqual({
      status: "running",
    });
    const last = await deliver(msg, REENCRYPT_MAX_ATTEMPTS);
    expect(last.explicitAcks).toEqual(["m1"]);
    expect(last.retryMessages).toEqual([]);
    expect(await db.prepare("SELECT status, error FROM key_rotations").first()).toEqual({
      status: "failed",
      error: "retries_exhausted",
    });
    // The cron sweep no longer re-sends it.
    fakeQueue.send.mockClear();
    expect(await sweepStaleRotations(db, envWith().REENCRYPT_QUEUE, Date.now() + 60 * MIN)).toBe(0);
  });

  it("failed -> ack, rotation failed", async () => {
    await seed(2);
    const msg = await startRotation();
    await db
      .prepare("UPDATE secret_versions SET ciphertext = randomblob(length(ciphertext))")
      .run();
    const result = await deliver(msg);
    expect(result.explicitAcks).toEqual(["m1"]);
    const row = await db.prepare("SELECT status, error FROM key_rotations").first();
    expect(row).toEqual({ status: "failed", error: "decrypt_failed" });
  });

  it("an unexpected message body is acked and dropped", async () => {
    const result = await deliver({ type: "other" } as unknown as ReencryptMessage);
    expect(result.explicitAcks).toEqual(["m1"]);
  });
});

describe("stale rotation sweep", () => {
  it("cron sweep re-enqueues stale running rotations only", async () => {
    const now = Date.now();
    const stale = await runningRotation("stale", now - 16 * MIN);
    await runningRotation("fresh", now - 5 * MIN);
    const project = await db.prepare("SELECT id FROM projects").first<{ id: string }>();
    await db
      .prepare(
        `INSERT INTO key_rotations (id, project_id, from_version, to_version, status, total, done, started_at, updated_at)
         VALUES ('old-done', ?, 1, 1, 'completed', 0, 0, 0, 0)`,
      )
      .bind(project?.id)
      .run();
    expect(await sweepStaleRotations(db, envWith().REENCRYPT_QUEUE, now)).toBe(1);
    expect(fakeQueue.send.mock.calls).toEqual([[stale]]);
  });

  it("the daily scheduled handler runs the sweep", async () => {
    await runningRotation("stale", Date.now() - 60 * MIN);
    await handleScheduled(
      createScheduledController({ cron: "0 3 * * *" }),
      envWith(),
      createExecutionContext(),
    );
    expect(fakeQueue.send).toHaveBeenCalledTimes(1);
  });
});

describe("real queue binding (miniflare)", () => {
  it("rotate 150 versions, drain the queue, expect completed", async () => {
    await seed(150);
    const res = await api(
      "/api/v1/projects/app/keys/rotate",
      jsonInit("POST", {}, { token: owner }),
    );
    expect(res.status).toBe(202);
    let rotation: KeyRotationDto | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await json<{ rotations: KeyRotationDto[] }>(
        await api("/api/v1/projects/app/keys", bearer(owner)),
      );
      rotation = status.rotations[0];
      if (rotation?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(rotation).toMatchObject({ status: "completed", total: 150, done: 150 });
  }, 60_000);
});
