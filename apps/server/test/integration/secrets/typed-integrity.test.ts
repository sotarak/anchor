import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getRootKeyring, type RootKeyring } from "#src/crypto/keyring";
import { IntegrityError } from "#src/lib/errors";
import { createProject, listEnvironments, type ProjectRow } from "#src/projects/repo";
import { findSecretWithVersion } from "#src/secrets/repo";
import { getSecret, putSecret, type SecretContext } from "#src/secrets/service";
import { resealCurrentVersion, resetDb } from "#test/support";

const db = env.DB;
let keyring: RootKeyring;
let project: ProjectRow;
let dev: SecretContext;

const put = (key: string, value: string) => putSecret(dev, { path: "/", key, value, comment: "" });
const get = (key: string) => getSecret(dev, { path: "/", key });
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
const versionRow = (key: string) =>
  db
    .prepare(
      "SELECT v.value_type, v.sensitive, v.aad_format FROM secret_versions v JOIN secrets s ON s.id = v.secret_id AND v.version = s.current_version WHERE s.key = ?",
    )
    .bind(key)
    .first();

beforeEach(async () => {
  await resetDb();
  keyring = await getRootKeyring(env);
  project = await createProject(db, keyring, { name: "App", slug: "app" }, Date.now());
  const [devEnv] = await listEnvironments(db, project.id);
  if (!devEnv) throw new Error("default environments missing");
  dev = { db, keyring, project, environment: devEnv, actorId: null, now: Date.now() };
});

describe("typed version integrity", () => {
  it("new versions are written with aad_format 2", async () => {
    await put("K", "v");
    expect(await versionRow("K")).toEqual({ value_type: "string", sensitive: 1, aad_format: 2 });
    expect((await get("K")).value).toBe("v");
  });

  it("flipping sensitive on a v2 row fails the decrypt", async () => {
    await put("K", "v");
    await db.prepare("UPDATE secret_versions SET sensitive = 0").run();
    expect(await rejection(get("K"))).toBeInstanceOf(IntegrityError);
  });

  it("changing value_type on a v2 row fails the decrypt", async () => {
    await put("K", '{"a":1}');
    await resealCurrentVersion(db, keyring, project, "K", {
      format: 2,
      type: "json",
      sensitive: true,
    });
    expect((await get("K")).value).toBe('{"a":1}');
    await db.prepare("UPDATE secret_versions SET value_type = 'string'").run();
    expect(await rejection(get("K"))).toBeInstanceOf(IntegrityError);
  });

  it("a v1 row reads as string + sensitive whatever its columns say", async () => {
    await put("K", "legacy");
    await resealCurrentVersion(db, keyring, project, "K", {
      format: 1,
      type: "string",
      sensitive: true,
    });
    await db.prepare("UPDATE secret_versions SET value_type = 'json', sensitive = 0").run();
    expect((await get("K")).value).toBe("legacy");
    const found = await findSecretWithVersion(db, dev.environment.id, "/", "K");
    expect(found?.current).toMatchObject({ value_type: "string", sensitive: true, aad_format: 1 });
  });

  it("moving a v2 ciphertext to another secret fails", async () => {
    await put("A", "alpha");
    await put("B", "beta");
    await db
      .prepare(
        `UPDATE secret_versions SET
           iv = (SELECT v.iv FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.key = 'A'),
           ciphertext = (SELECT v.ciphertext FROM secret_versions v JOIN secrets s ON s.id = v.secret_id WHERE s.key = 'A')
         WHERE secret_id = (SELECT id FROM secrets WHERE key = 'B')`,
      )
      .run();
    expect(await rejection(get("B"))).toBeInstanceOf(IntegrityError);
  });
});
