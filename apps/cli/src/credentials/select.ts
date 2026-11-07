import { join } from "node:path";
import { userConfigDir } from "../config/user-config";
import type { Spawner } from "../context";
import type { Io } from "../io";
import type { Output } from "../output";
import { createFileStore } from "./file";
import { createSecretServiceStore } from "./linux";
import { createMacosKeychainStore } from "./macos";
import type { CredentialStore } from "./types";

/** True when the binary can be started at all (any exit code); false on ENOENT. */
async function canSpawn(spawner: Spawner, cmd: string, args: string[]): Promise<boolean> {
  try {
    await spawner(cmd, args);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Wraps a keychain store so that a failed write falls back to the file store with a warning.
 * Reads check the keychain first, then the file (which may hold an earlier fallback write).
 */
function withFileFallback(
  keychain: CredentialStore,
  file: CredentialStore,
  out: Output,
): CredentialStore {
  let active: CredentialStore = keychain;
  return {
    get kind() {
      return active.kind;
    },
    async get(apiUrl) {
      return (await keychain.get(apiUrl)) ?? (await file.get(apiUrl));
    },
    async set(c) {
      try {
        await keychain.set(c);
        active = keychain;
      } catch (e) {
        out.warn(`${(e as Error).message}; falling back to the credentials file`);
        active = file;
        await file.set(c);
      }
    },
    async delete(apiUrl) {
      await keychain.delete(apiUrl);
      await file.delete(apiUrl);
    },
  };
}

export async function selectCredentialStore(
  io: Io,
  deps: { spawner: Spawner; out: Output },
): Promise<CredentialStore> {
  const path = join(userConfigDir(io), "credentials.json");
  if (io.env.ANCHOR_CREDENTIAL_STORE === "file") {
    return createFileStore(path, deps.out, { chosen: true });
  }
  const file = createFileStore(path, deps.out);
  if (io.platform === "darwin" && (await canSpawn(deps.spawner, "security", ["list-keychains"]))) {
    return withFileFallback(createMacosKeychainStore(deps.spawner), file, deps.out);
  }
  if (
    io.platform === "linux" &&
    io.env.DBUS_SESSION_BUS_ADDRESS &&
    (await canSpawn(deps.spawner, "secret-tool", ["--version"]))
  ) {
    return withFileFallback(createSecretServiceStore(deps.spawner), file, deps.out);
  }
  return file;
}
