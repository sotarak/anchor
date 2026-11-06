import { createFileRoute } from "@tanstack/react-router";
import { useSetHeader } from "@/components/app-shell/header";
import { EncryptionSection } from "@/components/settings/encryption-section";

export const Route = createFileRoute("/_app/projects/$project/settings/encryption")({
  component: EncryptionPage,
});

function EncryptionPage() {
  const { project } = Route.useParams();
  useSetHeader({ title: "Encryption" });
  return <EncryptionSection project={project} />;
}
