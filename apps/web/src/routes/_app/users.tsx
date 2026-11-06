import { createFileRoute } from "@tanstack/react-router";
import { useSetHeader } from "@/components/app-shell/header";

// Placeholder: the page is built in a later task of the M4 plan.
export const Route = createFileRoute("/_app/users")({
  component: Page,
});

function Page() {
  useSetHeader({ title: "Users" });
  return null;
}
