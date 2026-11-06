import type { Spawner } from "../context";
import { CliError, EXIT } from "../errors";
import {
  type CredentialStore,
  decodeCredential,
  encodeCredential,
  helperMessage,
  SERVICE_NAME,
} from "./types";

/** Secret Service (GNOME Keyring, KWallet) via `secret-tool`; the secret goes on stdin. */
export function createSecretServiceStore(spawner: Spawner): CredentialStore {
  const attrs = (apiUrl: string) => ["service", SERVICE_NAME, "account", apiUrl];
  return {
    kind: "secret-service",
    async get(apiUrl) {
      const r = await spawner("secret-tool", ["lookup", ...attrs(apiUrl)]);
      if (r.code === 0) return decodeCredential(r.stdout.trim());
      if (r.code === 1 && r.stdout.trim() === "" && r.stderr.trim() === "") return null;
      throw new CliError(
        EXIT.ERROR,
        `Could not read the Secret Service keyring: ${helperMessage(r.stderr)}`,
      );
    },
    async set(c) {
      const encoded = encodeCredential(c);
      const r = await spawner(
        "secret-tool",
        ["store", "--label", `Anchor CLI (${c.apiUrl})`, ...attrs(c.apiUrl)],
        { input: encoded },
      );
      if (r.code !== 0) {
        throw new CliError(
          EXIT.ERROR,
          `Could not write to the Secret Service keyring: ${helperMessage(r.stderr, encoded)}`,
        );
      }
    },
    async delete(apiUrl) {
      const r = await spawner("secret-tool", ["clear", ...attrs(apiUrl)]);
      if (r.code !== 0 && r.code !== 1) {
        throw new CliError(
          EXIT.ERROR,
          `Could not update the Secret Service keyring: ${helperMessage(r.stderr)}`,
        );
      }
    },
  };
}
