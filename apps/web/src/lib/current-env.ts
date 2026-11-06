import type { EnvironmentDto } from "@anchor/shared";
import { useParams } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";

const KEY = "anchor.currentEnv";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remembers the chosen environment slug (best effort: storage may be unavailable). */
export function rememberEnvironment(slug: string): void {
  try {
    window.localStorage.setItem(KEY, slug);
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
  for (const l of listeners) l();
}

/**
 * The current environment of a project: the route's env on an env page, else the last chosen slug
 * if the project (as the caller sees it) has it, else the first environment.
 */
export function useCurrentEnvironment(
  environments: EnvironmentDto[] | undefined,
): [string | undefined, (slug: string) => void] {
  const { env } = useParams({ strict: false }) as { env?: string };
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((slug: string) => rememberEnvironment(slug), []);
  if (env) return [env, set];
  const slugs = environments?.map((e) => e.slug) ?? [];
  return [stored && slugs.includes(stored) ? stored : slugs[0], set];
}

/** The environments the caller may open: all, or the member's allow-list. */
export function accessibleEnvironments(
  environments: EnvironmentDto[] | undefined,
  allowed: string[] | null | undefined,
): EnvironmentDto[] | undefined {
  if (!environments || !allowed) return environments;
  return environments.filter((e) => allowed.includes(e.slug));
}
