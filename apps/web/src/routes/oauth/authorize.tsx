import type { OAuthAuthorizeCheckDto, OAuthAuthorizeRequest, OAuthScope } from "@anchor/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { errorMessage } from "@/components/data/table-states";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { requireUser } from "@/lib/auth";
import { leavePage } from "@/lib/leave-page";

const PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

type Param = (typeof PARAMS)[number];
/** As the router parsed them: a number, boolean or null only when JSON gives back the exact text. */
type Search = Partial<Record<Param, string | number | boolean | null>>;

/** The exact text of a parameter (src/lib/search-json parses only lossless values). */
const text = (value: Search[Param]): string | undefined =>
  value === undefined || typeof value === "string" ? value : JSON.stringify(value);

export const Route = createFileRoute("/oauth/authorize")({
  // Values keep the type the router gave them, so the canonical URL the router writes back is
  // stable; the page turns them back into text.
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {};
    for (const key of PARAMS) {
      const value = search[key];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      }
    }
    return out;
  },
  beforeLoad: requireUser,
  component: AuthorizePage,
});

const TITLE = "Connect an app to Anchor";
const WARNING = "Only approve if you just connected an AI agent or app to Anchor.";
const SCOPE_WORDS: Partial<Record<OAuthScope, string>> = {
  "secrets:read": "See your projects, secrets and non-sensitive values",
  "secrets:write": "Create, change and delete secrets",
};

const isRedirect = (
  r: OAuthAuthorizeCheckDto | { redirectTo: string },
): r is { redirectTo: string } => "redirectTo" in r;

function AuthorizePage() {
  const raw = Route.useSearch();
  const search = Object.fromEntries(PARAMS.map((k) => [k, text(raw[k])])) as Partial<
    Record<Param, string>
  >;
  const req: OAuthAuthorizeRequest = {
    ...search,
    client_id: search.client_id ?? "",
    redirect_uri: search.redirect_uri ?? "",
  };
  const check = useQuery({
    queryKey: qk.oauthCheck(JSON.stringify(req)),
    queryFn: () => api.oauth.check(req),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [allowReveal, setAllowReveal] = useState(false);
  // No variables: the request comes from the URL, the choice from the checkbox.
  const approve = useMutation({
    mutationFn: () => api.oauth.decide(req, { approve: true, allowReveal }),
    onSuccess: (r) => leavePage(r.redirectTo),
  });
  const deny = useMutation({
    mutationFn: () => api.oauth.decide(req, { approve: false, allowReveal: false }),
    onSuccess: (r) => leavePage(r.redirectTo),
  });

  const redirectTo = check.data && isRedirect(check.data) ? check.data.redirectTo : null;
  useEffect(() => {
    if (redirectTo) leavePage(redirectTo);
  }, [redirectTo]);

  if (check.isError) {
    return (
      <AuthLayout title={TITLE}>
        <Callout tone="error">{errorMessage(check.error)}</Callout>
      </AuthLayout>
    );
  }
  const details = check.data && !isRedirect(check.data) ? check.data : null;
  if (!details) {
    return (
      <AuthLayout title={TITLE}>
        <p className="text-paragraph-sm text-text-sub">
          {redirectTo ? "Returning to the app…" : "Checking the request…"}
        </p>
      </AuthLayout>
    );
  }

  const decisionError = approve.error ?? deny.error;
  const busy = approve.isPending || deny.isPending || approve.isSuccess || deny.isSuccess;
  const abilities = details.scopes.flatMap((s) => SCOPE_WORDS[s] ?? []);
  return (
    <AuthLayout title={TITLE} description="An app is asking to use Anchor as you.">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-paragraph-sm">
          <dt className="text-text-soft">App</dt>
          <dd className="text-label-sm text-text-strong">{details.client.name}</dd>
          <dt className="text-text-soft">Returns to</dt>
          <dd className="text-code-xs text-text-strong">{details.client.redirectHost}</dd>
        </dl>
        <div className="flex flex-col gap-2">
          <p className="text-paragraph-sm text-text-sub">It will be able to:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-paragraph-sm text-text-strong">
            {abilities.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        {details.revealRequested ? (
          <div className="flex items-start gap-2">
            <Checkbox
              id="allow-reveal"
              checked={allowReveal}
              disabled={busy}
              onCheckedChange={(v) => setAllowReveal(v === true)}
              aria-describedby="allow-reveal-hint"
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor="allow-reveal" className="text-label-sm text-text-strong">
                Also allow reading sensitive values
              </label>
              <p id="allow-reveal-hint" className="text-paragraph-xs text-text-soft">
                Values the app reads enter the AI model's context. Each read is audited.
              </p>
            </div>
          </div>
        ) : null}
        <Callout tone="warning">{WARNING}</Callout>
        {decisionError ? <Callout tone="error">{errorMessage(decisionError)}</Callout> : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={busy} onClick={() => deny.mutate()}>
            Deny
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => approve.mutate()}>
            Approve
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
