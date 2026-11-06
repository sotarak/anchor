import { acceptInviteBodySchema } from "@anchor/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import {
  type FieldErrors,
  PASSWORD_HINT,
  PASSWORD_MISMATCH,
  validate,
} from "@/components/forms/validate";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { holdFragmentToken, releaseFragmentToken } from "@/lib/fragment-token";
import { roleLabel } from "@/lib/status";

export const Route = createFileRoute("/accept-invite")({
  // The token is read (and the fragment stripped) before anything renders or fetches.
  beforeLoad: () => ({ inviteToken: holdFragmentToken("anc_inv_") }),
  component: AcceptInvitePage,
});

function InvalidInvite() {
  return (
    <AuthLayout
      title="This invite link is invalid or has expired"
      description="Invite links work once and expire. Ask an admin of this Anchor instance for a new invite."
    >
      <Button asChild size="sm">
        <Link to="/login">Go to sign in</Link>
      </Button>
    </AuthLayout>
  );
}

type Key = "name" | "password" | "confirm";
const MESSAGES: Record<Key, string> = {
  name: "Enter your name",
  password: "Use at least 12 characters",
  confirm: PASSWORD_MISMATCH,
};

function AcceptInvitePage() {
  // Kept in state: a later router reload re-runs beforeLoad on a URL that no longer has the token.
  const [token] = useState(Route.useRouteContext().inviteToken);
  useEffect(() => () => releaseFragmentToken("anc_inv_"), []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = useQuery({
    // The key never holds the token.
    queryKey: ["invite-inspect"],
    queryFn: () => api.invites.inspect(token as string),
    enabled: token !== null,
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const [values, setValues] = useState<Record<Key, string>>({
    name: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const accept = useMutation({
    // No variables: the body is read from the form state so the token and password never sit in the
    // MutationCache (state.variables outlives the page by gcTime).
    mutationFn: () =>
      api.invites.accept({ token: token as string, name: values.name, password: values.password }),
    onSuccess: async ({ user }) => {
      queryClient.setQueryData(qk.me, user);
      await navigate({ to: "/projects" });
    },
  });

  if (token === null || invite.isError) return <InvalidInvite />;

  const field = (key: Key) => ({
    id: key,
    value: values[key],
    invalid: !!errors[key],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { token: token as string, name: values.name, password: values.password };
    const next = validate(acceptInviteBodySchema, body, MESSAGES);
    if (values.confirm !== values.password) next.confirm = PASSWORD_MISMATCH;
    setErrors(next);
    if (Object.keys(next).length === 0) accept.mutate();
  }

  return (
    <AuthLayout title="Join Anchor" description="Set your name and password to accept the invite.">
      {invite.data ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {accept.isError ? <Callout tone="error">{errorMessage(accept.error)}</Callout> : null}
          <Field htmlFor="email" label="Email">
            <Input id="email" type="email" value={invite.data.email} readOnly disabled />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-label-sm text-text-strong">Role</span>
            <Tag tone="neutral">{roleLabel(invite.data.role)}</Tag>
          </div>
          <Field htmlFor="name" label="Name" error={errors.name}>
            <Input autoComplete="name" autoFocus {...field("name")} />
          </Field>
          <Field htmlFor="password" label="Password" hint={PASSWORD_HINT} error={errors.password}>
            <Input type="password" autoComplete="new-password" {...field("password")} />
          </Field>
          <Field htmlFor="confirm" label="Confirm password" error={errors.confirm}>
            <Input type="password" autoComplete="new-password" {...field("confirm")} />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={accept.isPending}>
            Accept invite
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton width="24ch" />
          <Skeleton width="14ch" />
        </div>
      )}
    </AuthLayout>
  );
}
