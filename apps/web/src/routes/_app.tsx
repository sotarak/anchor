import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell/app-shell";
import { requireUser } from "@/lib/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: requireUser,
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
