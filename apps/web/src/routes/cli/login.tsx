import { normalizeUserCode } from "@anchor/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { RiCheckboxCircleFill, RiForbidFill } from "react-icons/ri";
import { AuthLayout } from "@/components/auth-layout";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { KeyValueList } from "@/components/ui/key-value-list";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { requireUser } from "@/lib/auth";
import { formatRelative } from "@/lib/format";

// A `?code=` in the link (old CLIs still send one) is ignored on purpose: the person types the
// code their terminal shows, so a phishing link cannot carry an attacker's code to approve.
export const Route = createFileRoute("/cli/login")({
  beforeLoad: requireUser,
  component: CliLoginPage,
});

const DONE = "You can close this tab and return to your terminal.";
const GONE = "This login request expired or was already used.";
const HELPER = "Type the code from your terminal yourself. Never enter a code someone sent you.";

function CliLoginPage() {
  const [code, setCode] = useState<string | null>(null);
  return code ? <Request code={code} /> : <EnterCode onSubmit={setCode} />;
}

function EnterCode({ onSubmit }: { onSubmit: (code: string) => void }) {
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
    onSubmit(code);
  }

  return (
    <AuthLayout
      title="Log in to the Anchor CLI"
      description="Enter the code shown in your terminal after running anchor login."
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Field htmlFor="code" label="Code" hint={HELPER} error={error}>
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
  return now - createdAt < 60_000 ? "less than a minute ago" : formatRelative(createdAt, now);
}

function Request({ code }: { code: string }) {
  // requireUser loaded the account before this route rendered, so the email is always known.
  const { me } = Route.useRouteContext();
  const request = useQuery({
    queryKey: qk.cliLogin(code),
    queryFn: () => api.cliLogin.get(code),
    retry: false,
  });
  // No variables: the code is a prop, so nothing extra sits in the MutationCache.
  const approve = useMutation({ mutationFn: () => api.cliLogin.approve(code) });
  const deny = useMutation({ mutationFn: () => api.cliLogin.deny(code) });
  const decisionError = approve.error ?? deny.error;

  if (approve.isSuccess || deny.isSuccess) {
    return approve.isSuccess ? (
      <AuthLayout
        title="CLI login approved"
        titleIcon={<RiCheckboxCircleFill aria-hidden className="size-4 text-success-base" />}
        description={DONE}
      >
        {null}
      </AuthLayout>
    ) : (
      <AuthLayout
        title="CLI login denied"
        titleIcon={<RiForbidFill aria-hidden className="size-4 text-faded-base" />}
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
      <AuthLayout title="Approve CLI login">
        <Callout tone="error">{GONE}</Callout>
      </AuthLayout>
    );
  }

  const busy = approve.isPending || deny.isPending;
  return (
    <AuthLayout
      title="Approve CLI login"
      description={`A terminal wants to sign in as ${me.email}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-1 rounded-lg border bg-bg-weak p-4 text-center">
          <p className="font-mono text-label-lg tracking-widest text-text-strong">{code}</p>
          <p className="text-paragraph-xs text-text-soft">Check that it matches your terminal</p>
        </div>
        {request.isError ? <Callout tone="error">{errorMessage(request.error)}</Callout> : null}
        {decisionError ? <Callout tone="error">{errorMessage(decisionError)}</Callout> : null}
        {request.data ? (
          <KeyValueList
            items={[
              { label: "Device", value: request.data.clientName ?? "–" },
              { label: "IP address", value: request.data.ip ?? "–", mono: true },
              { label: "Requested", value: requestedLabel(request.data.createdAt) },
            ]}
          />
        ) : null}
        <Callout tone="warning" size="sm">
          Only approve if you just ran anchor login. Approving signs this terminal in as you.
        </Callout>
        {request.data ? (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => deny.mutate()}>
              Deny
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() => approve.mutate()}
            >
              Approve
            </Button>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  );
}
