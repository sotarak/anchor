import type { AnchorFolder, AnchorValue } from "@anchor-secrets/sdk";

/**
 * Read access to one Anchor folder. Reads are synchronous; values older than the cache ttl are
 * refreshed in the background (see `AnchorFolder`).
 */
export class AnchorService implements AnchorFolder {
  constructor(private readonly folder: AnchorFolder) {}

  /** The value of `key`, or `undefined` when the folder has no such secret. */
  get<T = AnchorValue>(key: string): T | undefined {
    return this.folder.get<T>(key);
  }

  /** The value of `key`; throws `Anchor secret <KEY> is not set` when it is missing. */
  getOrThrow<T = AnchorValue>(key: string): T {
    return this.folder.getOrThrow<T>(key);
  }

  has(key: string): boolean {
    return this.folder.has(key);
  }

  keys(): string[] {
    return this.folder.keys();
  }

  /** Every value, frozen; the same object until new values arrive. */
  toObject(): Readonly<Record<string, AnchorValue>> {
    return this.folder.toObject();
  }

  /** Fetches now; rejects when that fails, keeping the current values. */
  refresh(): Promise<void> {
    return this.folder.refresh();
  }
}
