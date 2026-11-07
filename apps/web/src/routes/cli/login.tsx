import { normalizeUserCode } from "@anchor/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { requireUser } from "@/lib/auth";
import { formatRelative } from "@/lib/format";

export const Route = createFileRoute("/cli/login")({
  validateSearch: (search: Record<string, unknown>): { code?: string } => {
    const code = typeof search.code === "string" ? normalizeUserCode(search.code) : null;
    return code ? { code } : {};
  },
  beforeLoad: requireUser,
  component: CliLoginPage,
});

const DONE = "You can close this tab and return to your terminal.";
const GONE = "This login request expired or was already used.";

function CliLoginPage() {
  const { code } = Route.useSearch();
  return code ? <Request code={code} /> : <EnterCode />;
}

function EnterCode() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = normalizeUserCode(raw);
    if (!code) {
      setError("Enter the 8-letter code shown in your terminal");
      return;
    }
    setError(undefined);
    void navigate({ to: "/cli/login", search: { code } });
  }

  return (
    <AuthLayout
      title="Log in to the Anchor CLI"
      description="Enter the code shown in your terminal after running anchor login."
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Field htmlFor="code" label="Code" error={error}>
          <Input
            id="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder="XXXX-XXXX"
            value={raw}
            invalid={!!error}
            onChange={(e) => setRaw(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="sm">
          Continue
        </Button>
      </form>
    </AuthLayout>
  );
}

function requestedLabel(createdAt: number, now = Date.now()): string {
  return now - createdAt < 60_000
    ? "Requested less than a minute ago"
    : `Requested ${formatRelative(createdAt, now)}`;
}

function Request({ code }: { code: string }) {
  const request = useQuery({
    queryKey: qk.cliLogin(code),
    queryFn: () => api.cliLogin.get(code),
    retry: false,
  });
  // No variables: the code comes from the URL, so nothing extra sits in the MutationCache.
  const approve = useMutation({ mutationFn: () => api.cliLogin.approve(code) });
  const deny = useMutation({ mutationFn: () => api.cliLogin.deny(code) });
  const decisionError = approve.error ?? deny.error;

  if (approve.isSuccess || deny.isSuccess) {
    return (
      <AuthLayout
        title={approve.isSuccess ? "CLI login approved" : "CLI login denied"}
        description={DONE}
      >
        {null}
      </AuthLayout>
    );
  }

  const gone =
    (request.error instanceof ApiClientError && request.error.status === 404) ||
    (decisionError instanceof ApiClientError && decisionError.status === 404);
  if (gone) {
    return (
      <AuthLayout title="Log in to the Anchor CLI">
        <Callout tone="error">{GONE}</Callout>
      </AuthLayout>
    );
  }

  const busy = approve.isPending || deny.isPending;
  return (
    <AuthLayout
      title="Log in to the Anchor CLI"
      description="A terminal is asking to sign in to Anchor as you."
    >
      <div className="flex flex-col gap-4">
        <p className="text-center font-mono text-label-lg tracking-widest text-text-strong">
          {code}
        </p>
        {request.isError ? <Callout tone="error">{errorMessage(request.error)}</Callout> : null}
        {decisionError ? <Callout tone="error">{errorMessage(decisionError)}</Callout> : null}
        {request.data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-paragraph-sm">
            <dt className="text-text-soft">Device</dt>
            <dd className="text-text-strong">{request.data.clientName ?? "–"}</dd>
            <dt className="text-text-soft">IP address</dt>
            <dd className="text-code-xs text-text-strong">{request.data.ip ?? "–"}</dd>
            <dd className="col-span-2 text-paragraph-xs text-text-soft">
              {requestedLabel(request.data.createdAt)}
            </dd>
          </dl>
        ) : null}
        <Callout tone="warning">
          Only approve if you just ran anchor login and this code matches your terminal
        </Callout>
        {request.data ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={busy} onClick={() => deny.mutate()}>
              Deny
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => approve.mutate()}>
              Approve
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
