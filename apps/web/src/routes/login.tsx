import { loginBodySchema } from "@anchor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { errorMessage } from "@/components/data/table-states";
import { Field } from "@/components/forms/field";
import { type FieldErrors, validate } from "@/components/forms/validate";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { meQueryOptions, safeRedirect } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: async ({ context, search }) => {
    // Always ask the server: a cached user is exactly what an expired session leaves behind,
    // and trusting it would bounce the user back into the app in a loop.
    const me = await context.queryClient
      .fetchQuery({ ...meQueryOptions, staleTime: 0 })
      .catch(() => null);
    if (me) throw redirect({ href: safeRedirect(search.redirect), replace: true });
  },
  component: LoginPage,
});

type Key = "email" | "password";
const MESSAGES: Record<Key, string> = {
  email: "Enter a valid email address",
  password: "Enter your password",
};

function loginError(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.code === "invalid_credentials") return "Invalid email or password";
    if (e.code === "rate_limited") return "Too many failed attempts. Try again in 15 minutes.";
  }
  return errorMessage(e);
}

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const login = useMutation({
    // No variables: the body is read from the form state so the password never sits in the
    // MutationCache (state.variables outlives the page by gcTime).
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: async ({ user }) => {
      queryClient.setQueryData(qk.me, user);
      await navigate({ href: safeRedirect(search.redirect) });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate(loginBodySchema, { email, password }, MESSAGES);
    setErrors(next);
    if (Object.keys(next).length === 0) login.mutate();
  }

  return (
    <AuthLayout title="Sign in to Anchor">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {login.isError ? <Callout tone="error">{loginError(login.error)}</Callout> : null}
        <Field htmlFor="email" label="Email" error={errors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            invalid={!!errors.email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field htmlFor="password" label="Password" error={errors.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            invalid={!!errors.password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={login.isPending}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
