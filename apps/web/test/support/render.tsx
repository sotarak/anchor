import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { Toaster } from "@/components/ui/sonner";
import { wireSessionExpiry } from "@/lib/session";
import { createAppRouter } from "@/router";

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

/** Renders the real route tree at `url` with an in-memory history and waits for the first load. */
export async function renderApp(url: string, opts: { queryClient?: QueryClient } = {}) {
  const queryClient = opts.queryClient ?? testQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  wireSessionExpiry(router, queryClient);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  await act(() => router.load());
  return { router, queryClient, user };
}
