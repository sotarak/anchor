import type { KeyRotationDto, ProjectKeyDto } from "@anchor/shared";
import { systemAuditStatement } from "../audit/record";
import { AEAD_ALG, open, seal } from "../crypto/aead";
import { createWrappedKek, type RootKeyring, secretAad } from "../crypto/keyring";
import { isUniqueViolation, toBytes } from "../lib/d1";
import { log } from "../lib/log";
import { newId } from "../lib/random";
import { getProjectKek, type ProjectRow } from "../projects/repo";

/** One unit of re-encryption work on the anchor-reencrypt queue. */
export type ReencryptMessage = {
  type: "reencrypt";
  rotationId: string;
  projectId: string;
  toVersion: number;
};

/** Versions re-encrypted per message (spec: ≤ 100, well inside the consumer's CPU budget). */
export const REENCRYPT_BATCH = 100;

type RotationRow = {
  id: string;
  project_id: string;
  from_version: number;
  to_version: number;
  status: KeyRotationDto["status"];
  total: number;
  done: number;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

const ROTATION_COLUMNS =
  "id, project_id, from_version, to_version, status, total, done, error, started_at, finished_at";

function toRotationDto(r: RotationRow): KeyRotationDto {
  return {
    id: r.id,
    fromVersion: r.from_version,
    toVersion: r.to_version,
    status: r.status,
    total: r.total,
    done: r.done,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

const messageFor = (r: RotationRow): ReencryptMessage => ({
  type: "reencrypt",
  rotationId: r.id,
  projectId: r.project_id,
  toVersion: r.to_version,
});

async function getRotation(db: D1Database, id: string): Promise<RotationRow | null> {
  return db
    .prepare(`SELECT ${ROTATION_COLUMNS} FROM key_rotations WHERE id = ?`)
    .bind(id)
    .first<RotationRow>();
}

async function runningRotation(db: D1Database, projectId: string): Promise<RotationRow | null> {
  return db
    .prepare(
      `SELECT ${ROTATION_COLUMNS} FROM key_rotations
       WHERE project_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(projectId)
    .first<RotationRow>();
}

async function rotationTo(
  db: D1Database,
  projectId: string,
  toVersion: number,
): Promise<RotationRow | null> {
  return db
    .prepare(
      `SELECT ${ROTATION_COLUMNS} FROM key_rotations
       WHERE project_id = ? AND to_version = ? ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(projectId, toVersion)
    .first<RotationRow>();
}

/** Sends the work message; a failure is logged and left for the cron sweep or the next POST. */
async function enqueue(queue: Queue<ReencryptMessage>, r: RotationRow): Promise<void> {
  try {
    await queue.send(messageFor(r));
  } catch {
    log("error", "reencrypt_enqueue_failed", { rotationId: r.id, projectId: r.project_id });
  }
}

/** No version of the project is left under a KEK other than `?2` (project id `?1`). */
const NOTHING_PENDING = `NOT EXISTS (
  SELECT 1 FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
  WHERE s.project_id = ?1 AND v.key_version != ?2)`;

/**
 * Marks every KEK older than `toVersion` retired and the rotation completed, once, and only if no
 * version still uses an older KEK: a write that loaded the project before the rotation began can
 * land one between the last count and this batch. Then nothing changes, and the caller carries on
 * re-encrypting. The audit event is in the same batch under the same guard, so the finish and its
 * event commit together; a duplicate delivery changes nothing. Returns whether it finished.
 */
async function finishRotation(db: D1Database, r: RotationRow, now: number): Promise<boolean> {
  const [, , finished] = await db.batch([
    systemAuditStatement(
      db,
      {
        action: "kek.rotation_finished",
        projectId: r.project_id,
        metadata: {
          rotationId: r.id,
          fromVersion: r.from_version,
          toVersion: r.to_version,
          total: r.total,
        },
      },
      // Plain placeholders: they follow the insert's own 13 parameters.
      {
        sql: `EXISTS (SELECT 1 FROM key_rotations WHERE id = ? AND status = 'running')
          AND NOT EXISTS (SELECT 1 FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
            WHERE s.project_id = ? AND v.key_version != ?)`,
        params: [r.id, r.project_id, r.to_version],
      },
    ),
    db
      .prepare(
        `UPDATE project_keys SET status = 'retired' WHERE project_id = ?1 AND version < ?2
         AND ${NOTHING_PENDING}`,
      )
      .bind(r.project_id, r.to_version),
    db
      .prepare(
        `UPDATE key_rotations SET status = 'completed', done = total, finished_at = ?4, updated_at = ?4
         WHERE id = ?3 AND status = 'running' AND ${NOTHING_PENDING}`,
      )
      .bind(r.project_id, r.to_version, r.id, now),
  ]);
  if (finished?.meta.changes === 1) return true;
  // Not finished here: a duplicate delivery already did, or a late version is pending.
  const current = await getRotation(db, r.id);
  return current?.status !== "running";
}

/**
 * Starts a KEK rotation, or resumes the running one (re-sends its message). Starting creates KEK
 * n+1 for new writes, marks the older active KEK retiring, and counts the versions to re-encrypt,
 * all in one batch. A rotation with nothing to re-encrypt completes at once.
 */
export async function startOrResumeRotation(
  db: D1Database,
  keyring: RootKeyring,
  queue: Queue<ReencryptMessage>,
  project: ProjectRow,
  now: number,
): Promise<{ rotation: KeyRotationDto; resumed: boolean }> {
  const running = await runningRotation(db, project.id);
  if (running) {
    await enqueue(queue, running);
    return { rotation: toRotationDto(running), resumed: true };
  }

  const current = await db
    .prepare("SELECT current_key_version AS v FROM projects WHERE id = ?")
    .bind(project.id)
    .first<{ v: number }>();
  const from = current?.v ?? project.current_key_version;
  const to = from + 1;
  const kek = await createWrappedKek(keyring, project.id, to);
  const id = newId();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO project_keys (project_id, version, root_key_id, iv, wrapped_key, created_at, status)
           VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        )
        .bind(project.id, to, kek.rootKeyId, kek.iv, kek.wrappedKey, now),
      db
        .prepare(
          "UPDATE project_keys SET status = 'retiring' WHERE project_id = ? AND version < ? AND status = 'active'",
        )
        .bind(project.id, to),
      db
        .prepare("UPDATE projects SET current_key_version = ?, updated_at = ? WHERE id = ?")
        .bind(to, now, project.id),
      // Counted inside the batch, after the switch: later writes already use KEK `to`.
      db
        .prepare(
          `INSERT INTO key_rotations (${ROTATION_COLUMNS}, updated_at)
           SELECT ?, ?, ?, ?, 'running', COUNT(*), 0, NULL, ?, NULL, ?
           FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
           WHERE s.project_id = ? AND v.key_version != ?`,
        )
        .bind(id, project.id, from, to, now, now, project.id, to),
    ]);
  } catch (err) {
    // A concurrent POST created KEK `to` first: report its rotation instead, whether it is still
    // running or (with little to re-encrypt) already finished.
    if (isUniqueViolation(err)) {
      const other = await rotationTo(db, project.id, to);
      if (other) return { rotation: toRotationDto(other), resumed: true };
    }
    throw err;
  }

  const created = await getRotation(db, id);
  if (!created) throw new Error("rotation row missing after insert");
  if (created.total === 0 && (await finishRotation(db, created, now))) {
    const done = await getRotation(db, id);
    return { rotation: toRotationDto(done ?? created), resumed: false };
  }
  await enqueue(queue, created);
  return { rotation: toRotationDto(created), resumed: false };
}

type PendingVersion = {
  secret_id: string;
  version: number;
  alg: string;
  key_version: number;
  iv: unknown;
  ciphertext: unknown;
  environment_id: string;
};

/**
 * Re-encrypts up to REENCRYPT_BATCH versions not yet under KEK `toVersion`, keeping each row's
 * AAD (same secret and version). Every row of the batch is decrypted before any is written, and
 * each write is conditional on the old key_version, so duplicate or concurrent deliveries write
 * nothing twice. A row that does not decrypt fails the rotation and writes nothing.
 */
export async function processRotationBatch(
  db: D1Database,
  keyring: RootKeyring,
  msg: ReencryptMessage,
  now: number,
): Promise<"more" | "done" | "failed"> {
  const rotation = await getRotation(db, msg.rotationId);
  if (!rotation || rotation.status === "completed") return "done";
  if (rotation.status === "failed") return "failed";
  const project = await db
    .prepare("SELECT id, slug, name, current_key_version, created_at FROM projects WHERE id = ?")
    .bind(rotation.project_id)
    .first<ProjectRow>();
  if (!project) return "done"; // project deleted; its rotation rows cascade away

  const { results } = await db
    .prepare(
      `SELECT v.secret_id, v.version, v.alg, v.key_version, v.iv, v.ciphertext, s.environment_id
       FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
       WHERE s.project_id = ? AND v.key_version != ? LIMIT ?`,
    )
    .bind(project.id, rotation.to_version, REENCRYPT_BATCH)
    .all<PendingVersion>();

  const keks = new Map<number, CryptoKey>();
  const kek = async (version: number) => {
    let key = keks.get(version);
    if (!key) {
      key = await getProjectKek(db, keyring, project, version);
      keks.set(version, key);
    }
    return key;
  };

  const updates: D1PreparedStatement[] = [];
  for (const row of results) {
    const aad = secretAad({
      projectId: project.id,
      environmentId: row.environment_id,
      secretId: row.secret_id,
      version: row.version,
    });
    // A KEK that does not unwrap throws (IntegrityError -> the queue retries, then the DLQ); a
    // version row that does not open is that row's integrity failure and fails the rotation.
    const oldKek = await kek(row.key_version);
    let plain: Uint8Array;
    try {
      if (row.alg !== AEAD_ALG) throw new Error("unknown alg");
      plain = await open(oldKek, { iv: toBytes(row.iv), ciphertext: toBytes(row.ciphertext) }, aad);
    } catch {
      log("error", "secret_decrypt_failed", {
        projectId: project.id,
        sid: row.secret_id,
        version: row.version,
        rotationId: rotation.id,
      });
      await db
        .prepare(
          "UPDATE key_rotations SET status = 'failed', error = 'decrypt_failed', updated_at = ? WHERE id = ? AND status = 'running'",
        )
        .bind(now, rotation.id)
        .run();
      return "failed";
    }
    const sealed = await seal(await kek(rotation.to_version), plain, aad);
    plain.fill(0);
    updates.push(
      db
        .prepare(
          `UPDATE secret_versions SET key_version = ?, iv = ?, ciphertext = ?
           WHERE secret_id = ? AND version = ? AND key_version = ?`,
        )
        .bind(
          rotation.to_version,
          sealed.iv,
          sealed.ciphertext,
          row.secret_id,
          row.version,
          row.key_version,
        ),
    );
  }
  if (updates.length > 0) await db.batch(updates);

  const remaining = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM secret_versions v JOIN secrets s ON s.id = v.secret_id
       WHERE s.project_id = ? AND v.key_version != ?`,
    )
    .bind(project.id, rotation.to_version)
    .first<{ n: number }>();
  const left = remaining?.n ?? 0;
  if (left === 0 && (await finishRotation(db, rotation, now))) return "done";
  await db
    .prepare(
      "UPDATE key_rotations SET done = MAX(0, total - ?), updated_at = ? WHERE id = ? AND status = 'running'",
    )
    .bind(left, now, rotation.id)
    .run();
  return "more";
}

/** KEK versions (newest first) and the last 10 rotations of a project. */
export async function getKeyStatus(
  db: D1Database,
  projectId: string,
): Promise<{ keys: ProjectKeyDto[]; rotations: KeyRotationDto[] }> {
  const [keys, rotations] = await db.batch([
    db
      .prepare(
        "SELECT version, status, root_key_id, created_at FROM project_keys WHERE project_id = ? ORDER BY version DESC",
      )
      .bind(projectId),
    db
      .prepare(
        `SELECT ${ROTATION_COLUMNS} FROM key_rotations WHERE project_id = ?
         ORDER BY started_at DESC, id DESC LIMIT 10`,
      )
      .bind(projectId),
  ]);
  type KeyRow = {
    version: number;
    status: ProjectKeyDto["status"];
    root_key_id: string;
    created_at: number;
  };
  return {
    keys: ((keys?.results ?? []) as KeyRow[]).map((k) => ({
      version: k.version,
      status: k.status,
      rootKeyId: k.root_key_id,
      createdAt: k.created_at,
    })),
    rotations: ((rotations?.results ?? []) as RotationRow[]).map(toRotationDto),
  };
}
