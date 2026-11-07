import { setupBodySchema } from "@anchor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
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
import { ApiClientError } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/query-keys";
import { setupStatusQueryOptions } from "@/lib/auth";

export const Route = createFileRoute("/setup")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(setupStatusQueryOptions);
    if (!status.needsSetup) throw redirect({ to: "/login", replace: true });
  },
  component: SetupPage,
});

type Key = "name" | "email" | "password" | "confirm";
const MESSAGES: Record<Key, string> = {
  name: "Enter your name",
  email: "Enter a valid email address",
  password: "Use at least 12 characters",
  confirm: PASSWORD_MISMATCH,
};

function SetupError({ error }: { error: unknown }) {
  // 409: another submission created the owner first (setup has no token since 0.3.0).
  if (error instanceof ApiClientError && error.code === "conflict") {
    return (
      <Callout tone="warning">
        This instance already has an owner.{" "}
        <Link to="/login" className="underline">
          Sign in
        </Link>{" "}
        with that account. If you did not create it, see Troubleshooting in the docs before you
        store any secrets.
      </Callout>
    );
  }
  return <Callout tone="error">{errorMessage(error)}</Callout>;
}

function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<Key, string>>({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const setup = useMutation({
    // No variables: the body is read from the form state so the password never sits in the
    // MutationCache (state.variables outlives the page by gcTime).
    mutationFn: () => {
      const { confirm: _confirm, ...body } = values;
      return api.setup.submit(body);
    },
    onSuccess: async ({ user }) => {
      queryClient.setQueryData(qk.me, user);
      queryClient.setQueryData(qk.setupStatus, { needsSetup: false });
      await navigate({ to: "/projects" });
    },
  });

  const field = (key: Key) => ({
    id: key,
    value: values[key],
    invalid: !!errors[key],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { confirm, ...body } = values;
    const next = validate(setupBodySchema, body, MESSAGES);
    if (confirm !== body.password) next.confirm = PASSWORD_MISMATCH;
    setErrors(next);
    if (Object.keys(next).length === 0) setup.mutate();
  }

  return (
    <AuthLayout
      title="Set up Anchor"
      description="Create the owner account. The first account created here owns this instance."
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {setup.isError ? <SetupError error={setup.error} /> : null}
        <Field htmlFor="name" label="Name" error={errors.name}>
          <Input autoComplete="name" autoFocus {...field("name")} />
        </Field>
        <Field htmlFor="email" label="Email" error={errors.email}>
          <Input type="email" autoComplete="username" {...field("email")} />
        </Field>
        <Field htmlFor="password" label="Password" hint={PASSWORD_HINT} error={errors.password}>
          <Input type="password" autoComplete="new-password" {...field("password")} />
        </Field>
        <Field htmlFor="confirm" label="Confirm password" error={errors.confirm}>
          <Input type="password" autoComplete="new-password" {...field("confirm")} />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={setup.isPending}>
          Create owner account
        </Button>
      </form>
    </AuthLayout>
  );
}
