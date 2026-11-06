import type { Spawner } from "../context";
import { CliError, EXIT } from "../errors";
import {
  type CredentialStore,
  decodeCredential,
  encodeCredential,
  helperMessage,
  SERVICE_NAME,
} from "./types";

/** `security` exits 44 (errSecItemNotFound) when no matching item exists. */
const NOT_FOUND = 44;

/** macOS login keychain via `security`. The secret is written through `security -i` stdin. */
export function createMacosKeychainStore(spawner: Spawner): CredentialStore {
  return {
    kind: "macos-keychain",
    async get(apiUrl) {
      const r = await spawner("security", [
        "find-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        apiUrl,
        "-w",
      ]);
      if (r.code === NOT_FOUND) return null;
      if (r.code !== 0) {
        throw new CliError(
          EXIT.ERROR,
          `Could not read the macOS keychain: ${helperMessage(r.stderr)}`,
        );
      }
      return decodeCredential(r.stdout.trim());
    },
    async set(c) {
      const encoded = encodeCredential(c);
      const r = await spawner("security", ["-i"], {
        input: `add-generic-password -U -s ${SERVICE_NAME} -a "${c.apiUrl}" -w "${encoded}"\n`,
      });
      if (r.code !== 0 || /error|returned/i.test(r.stderr)) {
        throw new CliError(
          EXIT.ERROR,
          `Could not write to the macOS keychain: ${helperMessage(r.stderr, encoded)}`,
        );
      }
    },
    async delete(apiUrl) {
      const r = await spawner("security", [
        "delete-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        apiUrl,
      ]);
      if (r.code !== 0 && r.code !== NOT_FOUND) {
        throw new CliError(
          EXIT.ERROR,
          `Could not update the macOS keychain: ${helperMessage(r.stderr)}`,
        );
      }
    },
  };
}
