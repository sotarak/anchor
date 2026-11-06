import { createFileRoute } from "@tanstack/react-router";

// Placeholder: the login page is built in Task 8.
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: () => null,
});
