import { createFileRoute } from "@tanstack/react-router";
import { useSetHeader } from "@/components/app-shell/header";
import { pathSearch } from "@/lib/search";
// Placeholder: the page is built in a later task of the M4 plan.
export const Route = createFileRoute("/_app/projects/$project/")({
  validateSearch: pathSearch,
  component: Page,
});

function Page() {
  useSetHeader({ title: "Overview" });
  return null;
}
