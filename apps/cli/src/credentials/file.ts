import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { CliError, EXIT } from "../errors";
import type { Output } from "../output";
import { type CredentialStore, parseCredential, type StoredCredential } from "./types";

type FileShape = { version: 1; credentials: Record<string, unknown> };

/**
 * Fallback store: one JSON file, mode 0600, in a 0700 directory. It warns on first write unless the
 * user chose it (`ANCHOR_CREDENTIAL_STORE=file`): the warning exists for a fallback they did not pick.
 */
export function createFileStore(
  path: string,
  out: Output,
  opts: { chosen?: boolean } = {},
): CredentialStore {
  let warned = opts.chosen === true;

  async function load(): Promise<FileShape> {
    let mode: number;
    try {
      mode = (await stat(path)).mode;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, credentials: {} };
      throw e;
    }
    if (process.platform !== "win32" && (mode & 0o077) !== 0) {
      throw new CliError(
        EXIT.ERROR,
        `${path} is accessible by other users`,
        `Run 'chmod 600 ${path}'`,
      );
    }
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as Partial<FileShape>;
      const credentials =
        data.credentials && typeof data.credentials === "object" ? data.credentials : {};
      return { version: 1, credentials };
    } catch {
      throw new CliError(EXIT.ERROR, `${path} is invalid`, `Delete ${path} and log in again`);
    }
  }

  async function save(data: FileShape): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, path);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  return {
    kind: "file",
    async get(apiUrl) {
      return parseCredential((await load()).credentials[apiUrl]);
    },
    async set(c: StoredCredential) {
      const data = await load();
      data.credentials[c.apiUrl] = c;
      await save(data);
      if (!warned) {
        warned = true;
        out.warn(`No OS keychain available; credentials stored in ${path} (mode 0600)`);
      }
    },
    async delete(apiUrl) {
      const data = await load();
      if (!(apiUrl in data.credentials)) return;
      delete data.credentials[apiUrl];
      await save(data);
    },
  };
}
