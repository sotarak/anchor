import type { AnchorValue } from "@anchor-secrets/sdk";

/** Read access to the secrets loaded at startup. */
export class AnchorService {
  constructor(private readonly secrets: Readonly<Record<string, AnchorValue>>) {}

  /** The value of `key`, or `undefined` when the folder has no such secret. */
  get<T = AnchorValue>(key: string): T | undefined {
    return (this.has(key) ? this.secrets[key] : undefined) as T | undefined;
  }

  /** The value of `key`; throws when the folder has no such secret. */
  getOrThrow<T = AnchorValue>(key: string): T {
    if (!this.has(key)) throw new Error(`Anchor secret ${key} is not set`);
    return this.secrets[key] as T;
  }

  has(key: string): boolean {
    return Object.hasOwn(this.secrets, key);
  }

  keys(): string[] {
    return Object.keys(this.secrets);
  }
}
