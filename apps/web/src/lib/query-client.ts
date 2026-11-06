import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./api/client";

/** Retries only server/network failures, at most twice; 4xx answers are final. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (n, e) =>
          !(e instanceof ApiClientError && e.status >= 400 && e.status < 500) && n < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}
