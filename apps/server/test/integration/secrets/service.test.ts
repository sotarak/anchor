import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getRootKeyring } from "#src/crypto/keyring";
import { toBase64, utf8Encode } from "#src/lib/encoding";
import { ApiError, IntegrityError } from "#src/lib/errors";
import { randomBytes } from "#src/lib/random";
import { createProject, listEnvironments } from "#src/projects/repo";
import {
  deleteSecret,
  getSecret,
  listSecrets,
  putSecret,
  type SecretContext,
} from "#src/secrets/service";
import { resetDb } from "#test/support";

const db = env.DB;
let dev: SecretContext;
let staging: SecretContext;

const put = (
  ctx: SecretContext,
  key: string,
  value: string,
  extra: { path?: string; comment?: string } = {},
) => putSecret(ctx, { path: extra.path ?? "/", key, value, comment: extra.comment ?? "" });

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

beforeEach(async () => {
  await resetDb();
  const keyring = await getRootKeyring(env);
  const project = await createProject(db, keyring, { name: "App", slug: "app" }, Date.now());
  const envs = await listEnvironments(db, project.id);
  const base = { db, keyring, project, actorId: null, now: Date.now() };
  const [devEnv, stagingEnv] = envs;
  if (!devEnv || !stagingEnv) throw new Error("default environments missing");
  dev = { ...base, environment: devEnv };
  staging = { ...base, environment: stagingEnv };
});

describe("secrets service", () => {
  it("round-trips values byte-exact", async () => {
    const pem =
      "-----BEGIN KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END KEY-----\n";
    const values = { EMPTY: "", PEM: pem, UNI: "🔑 ünïcødé", BIG: "a".repeat(65536), BOM: "﻿x" };
    for (const [key, value] of Object.entries(values)) await put(dev, key, value);
    for (const [key, value] of Object.entries(values)) {
      expect((await getSecret(dev, { path: "/", key })).value, key).toBe(value);
    }
  });

  it("stored ciphertext does not contain the plaintext", async () => {
    await put(dev, "K", "plaintext-marker-xyz");
    const rows = await db
      .prepare("SELECT ciphertext, iv FROM secret_versions")
      .all<{ ciphertext: number[] }>();
    const [row] = rows.results;
    if (!row) throw new Error("no version row");
    const stored = Uint8Array.from(row.ciphertext);
    const marker = utf8Encode("plaintext-marker-xyz");
    const haystack = toBase64(stored);
    expect(stored.length).toBe(marker.length + 16);
    expect(haystack).not.toContain(toBase64(marker));
    expect(new TextDecoder().decode(stored)).not.toContain("plaintext-marker-xyz");
  });

  it("update creates version 2 and keeps version 1", async () => {
    const first = await put(dev, "K", "v1");
    expect(first).toMatchObject({ created: true, changed: true, secret: { version: 1 } });
    const second = await put(dev, "K", "v2");
    expect(second).toMatchObject({ created: false, changed: true, secret: { version: 2 } });
    const n = await db.prepare("SELECT count(*) AS n FROM secret_versions").first<{ n: number }>();
    expect(n?.n).toBe(2);
    expect((await getSecret(dev, { path: "/", key: "K" })).value).toBe("v2");
  });

  it("identical put is a no-op", async () => {
    await put(dev, "K", "same", { comment: "c" });
    const again = await put(dev, "K", "same", { comment: "c" });
    expect(again).toMatchObject({ created: false, changed: false, secret: { version: 1 } });
    const n = await db.prepare("SELECT count(*) AS n FROM secret_versions").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("comment-only change creates a new version", async () => {
    await put(dev, "K", "same", { comment: "a" });
    const res = await put(dev, "K", "same", { comment: "b" });
    expect(res).toMatchObject({ changed: true, secret: { version: 2, comment: "b" } });
  });

  it("same key in different paths and environments are independent", async () => {
    await put(dev, "K", "root");
    await put(dev, "K", "api", { path: "/api" });
    await put(staging, "K", "staging");
    expect((await getSecret(dev, { path: "/", key: "K" })).value).toBe("root");
    expect((await getSecret(dev, { path: "/api", key: "K" })).value).toBe("api");
    expect((await getSecret(staging, { path: "/", key: "K" })).value).toBe("staging");
  });

  it("keys are case-sensitive", async () => {
    await put(dev, "DB_URL", "upper");
    await put(dev, "db_url", "lower");
    expect((await getSecret(dev, { path: "/", key: "DB_URL" })).value).toBe("upper");
    expect((await getSecret(dev, { path: "/", key: "db_url" })).value).toBe("lower");
  });

  it("list hides values unless reveal", async () => {
    await put(dev, "B", "2");
    await put(dev, "A", "1", { comment: "first" });
    await put(dev, "C", "nested", { path: "/api" });
    const hidden = await listSecrets(dev, { path: "/", reveal: false });
    expect(hidden.map((s) => s.key)).toEqual(["A", "B"]);
    for (const s of hidden) expect(s).not.toHaveProperty("value");
    expect(hidden[0]).toMatchObject({ key: "A", path: "/", version: 1, comment: "first" });
    const shown = await listSecrets(dev, { path: "/", reveal: true });
    expect(shown.map((s) => s.value)).toEqual(["1", "2"]);
  });

  it("concurrent write loses with 409 and leaves no partial state", async () => {
    await put(dev, "K", "v1");
    const secret = await db
      .prepare("SELECT id FROM secrets WHERE key = 'K'")
      .first<{ id: string }>();
    await db
      .prepare(
        "INSERT INTO secret_versions (secret_id, version, alg, key_version, iv, ciphertext, created_at) VALUES (?, 2, 'A256GCM', 1, x'00', x'00', 0)",
      )
      .bind(secret?.id)
      .run();
    const err = await rejection(put(dev, "K", "v2-from-loser"));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("Secret was modified concurrently, retry");
    const row = await db
      .prepare("SELECT current_version FROM secrets WHERE key = 'K'")
      .first<{ current_version: number }>();
    expect(row?.current_version).toBe(1);
    const n = await db.prepare("SELECT count(*) AS n FROM secret_versions").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it("secret row whose current version is missing fails closed", async () => {
    await db
      .prepare(
        "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES ('orphan', ?, ?, '/', 'K', 1, 0, 0)",
      )
      .bind(dev.project.id, dev.environment.id)
      .run();
    expect(await rejection(getSecret(dev, { path: "/", key: "K" }))).toBeInstanceOf(IntegrityError);
    expect(await rejection(put(dev, "K", "v"))).toBeInstanceOf(IntegrityError);
  });

  it("ciphertext moved to another environment fails closed", async () => {
    await put(dev, "K", "dev-value");
    await put(staging, "K", "staging-value");
    await db
      .prepare(
        `UPDATE secret_versions SET
           iv = (SELECT v.iv FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.environment_id = ?1),
           ciphertext = (SELECT v.ciphertext FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.environment_id = ?1)
         WHERE secret_id = (SELECT id FROM secrets WHERE environment_id = ?2)`,
      )
      .bind(dev.environment.id, staging.environment.id)
      .run();
    expect(await rejection(getSecret(staging, { path: "/", key: "K" }))).toBeInstanceOf(
      IntegrityError,
    );
  });

  it("ciphertext moved to another version number fails closed", async () => {
    await put(dev, "K", "one");
    await put(dev, "K", "two");
    await db
      .prepare(
        `UPDATE secret_versions SET
           iv = (SELECT iv FROM secret_versions WHERE version = 1),
           ciphertext = (SELECT ciphertext FROM secret_versions WHERE version = 1)
         WHERE version = 2`,
      )
      .run();
    const err = await rejection(getSecret(dev, { path: "/", key: "K" }));
    expect(err).toBeInstanceOf(IntegrityError);
    expect((err as IntegrityError).fields).toMatchObject({ version: 2 });
  });

  it("wrong root key fails closed", async () => {
    await put(dev, "K", "v");
    const wrongRoot = await getRootKeyring({
      ANCHOR_ROOT_KEY: toBase64(randomBytes(32)),
      ANCHOR_ROOT_KEY_ID: env.ANCHOR_ROOT_KEY_ID,
    });
    const ctx = { ...dev, keyring: wrongRoot };
    expect(await rejection(getSecret(ctx, { path: "/", key: "K" }))).toBeInstanceOf(IntegrityError);
    expect(await rejection(listSecrets(ctx, { path: "/", reveal: true }))).toBeInstanceOf(
      IntegrityError,
    );
    expect(await rejection(put(ctx, "K", "new"))).toBeInstanceOf(IntegrityError);
  });

  it("delete removes the secret and its versions", async () => {
    await put(dev, "K", "v1");
    await put(dev, "K", "v2");
    await deleteSecret(dev, { path: "/", key: "K" });
    for (const t of ["secrets", "secret_versions"]) {
      const n = await db.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>();
      expect(n?.n, t).toBe(0);
    }
  });

  it("get/delete unknown -> 404", async () => {
    const attempts: Promise<unknown>[] = [
      getSecret(dev, { path: "/", key: "NOPE" }),
      deleteSecret(dev, { path: "/", key: "NOPE" }),
    ];
    for (const p of attempts) {
      const err = await rejection(p);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe("Secret not found");
    }
  });
});

describe("secrets service under concurrent delete", () => {
  it("get racing a delete returns 404 or the value, never an integrity error", async () => {
    await put(dev, "K", "v");
    const [, got] = await Promise.all([
      deleteSecret(dev, { path: "/", key: "K" }),
      rejection(getSecret(dev, { path: "/", key: "K" })),
    ]);
    expect(got).not.toBeInstanceOf(IntegrityError);
    if (got instanceof ApiError) expect(got.status).toBe(404);
  });
});
