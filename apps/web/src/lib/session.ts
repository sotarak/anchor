import type { QueryClient } from "@tanstack/react-query";
import type { AppRouter } from "../router";
import { setUnauthenticatedHandler } from "./api/client";

/**
 * Session expiry: a 401 from any non-auth request sends the user to
 * /login?redirect=<current location>, once: the router moves to /login synchronously, so later
 * 401s from the same page see it and stop. The cache is cleared after the shell unmounts so no
 * mounted query refetches into it.
 */
export function wireSessionExpiry(router: AppRouter, queryClient: QueryClient): void {
  setUnauthenticatedHandler(() => {
    const here = router.state.location;
    if (here.pathname === "/login") return;
    void router
      .navigate({ to: "/login", search: { redirect: here.href }, replace: true })
      .finally(() => queryClient.clear());
  });
}
