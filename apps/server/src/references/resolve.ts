import { REFERENCE_LIMITS, tokenizeValue, utf8ByteLength } from "@anchor/shared";
import { ApiError } from "../lib/errors";

/** A secret by environment slug, folder path and key. */
export type SecretAddress = { environment: string; path: string; key: string };

export type ResolverDeps = {
  /** Throws ApiError 403 when the caller may not read `addr`. Called before `load`. */
  authorize(addr: SecretAddress): Promise<void>;
  /** The stored (raw, unexpanded) value, or null when the secret does not exist. */
  load(addr: SecretAddress): Promise<string | null>;
};

export type Resolver = {
  expand(
    origin: SecretAddress,
    raw: string,
  ): Promise<{ value: string; referenced: SecretAddress[] }>;
};

/** "dev:/A", "prod:/db/PASSWORD". */
export function formatAddress(a: SecretAddress): string {
  return `${a.environment}:${a.path === "/" ? "" : a.path}/${a.key}`;
}

type Expanded = {
  value: string;
  /** Hops in the longest reference chain below this value (0 = no references). */
  height: number;
  /** Every address loaded while expanding this value. */
  refs: Map<string, SecretAddress>;
};

const bad = (message: string) => new ApiError(400, "bad_request", message);

/**
 * Expands references depth-first (spec §9). One resolver serves one request: it memoizes each
 * expanded secret (a diamond loads its tip once) and caps the distinct secrets loaded and the
 * bytes references add across the whole request. Every hop is authorized before it is loaded,
 * so a forbidden target is a 403 whether or not it exists.
 */
export function createResolver(deps: ResolverDeps): Resolver {
  const { maxDepth, maxSecrets, maxExpandedBytes, maxReferencedBytesPerRequest } = REFERENCE_LIMITS;
  const memo = new Map<string, Expanded>();
  let loads = 0;
  let referencedBytes = 0;

  async function expandValue(addr: SecretAddress, raw: string, stack: string[]): Promise<Expanded> {
    const refs = new Map<string, SecretAddress>();
    let value = "";
    let bytes = 0;
    let height = 0;
    const append = (piece: string, fromReference = false) => {
      const size = utf8ByteLength(piece);
      bytes += size;
      if (bytes > maxExpandedBytes) throw bad(`Expanded value exceeds ${maxExpandedBytes} bytes`);
      if (fromReference) {
        referencedBytes += size;
        if (referencedBytes > maxReferencedBytesPerRequest) {
          throw bad(
            `References add more than ${maxReferencedBytesPerRequest} bytes to one request`,
          );
        }
      }
      value += piece;
    };

    for (const token of tokenizeValue(raw)) {
      if (token.type === "text") {
        append(token.text);
        continue;
      }
      const target: SecretAddress =
        token.target.environment === null
          ? { environment: addr.environment, path: addr.path, key: token.target.key }
          : {
              environment: token.target.environment,
              path: token.target.path ?? "/",
              key: token.target.key,
            };
      const id = formatAddress(target);
      if (stack.includes(id)) {
        throw bad(`Reference cycle: ${[...stack, id].join(" -> ")}`);
      }
      const hop = stack.length; // origin -> first target is hop 1

      let child = memo.get(id);
      if (!child) {
        if (hop > maxDepth) throw bad(`Reference depth exceeds ${maxDepth} at ${id}`);
        try {
          await deps.authorize(target);
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) {
            throw new ApiError(
              403,
              "forbidden",
              `You do not have permission to read the reference ${token.raw} in ${formatAddress(addr)}`,
            );
          }
          throw e;
        }
        loads += 1;
        if (loads > maxSecrets) throw bad(`References load more than ${maxSecrets} secrets`);
        const loaded = await deps.load(target);
        if (loaded === null) {
          throw bad(
            `Unresolved reference ${token.raw} in ${formatAddress(addr)}; escape a literal with $\${`,
          );
        }
        child = await expandValue(target, loaded, [...stack, id]);
        memo.set(id, child);
      }
      if (hop + child.height > maxDepth) {
        throw bad(`Reference depth exceeds ${maxDepth} at ${id}`);
      }
      height = Math.max(height, child.height + 1);
      refs.set(id, target);
      for (const [k, a] of child.refs) refs.set(k, a);
      append(child.value, true);
    }
    return { value, height, refs };
  }

  return {
    async expand(origin, raw) {
      const out = await expandValue(origin, raw, [formatAddress(origin)]);
      return { value: out.value, referenced: [...out.refs.values()] };
    },
  };
}
