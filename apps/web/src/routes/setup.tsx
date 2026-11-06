import { setupBodySchema } from "@anchor/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
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

type Key = "setupToken" | "name" | "email" | "password" | "confirm";
const MESSAGES: Record<Key, string> = {
  setupToken: "Enter the setup token",
  name: "Enter your name",
  email: "Enter a valid email address",
  password: "Use at least 12 characters",
  confirm: PASSWORD_MISMATCH,
};

function SetupError({ error }: { error: unknown }) {
  if (error instanceof ApiClientError && error.code === "setup_disabled") {
    return (
      <Callout tone="warning">
        Setup is disabled. Set the ANCHOR_SETUP_TOKEN secret on the Worker and reload.
      </Callout>
    );
  }
  const message =
    error instanceof ApiClientError && error.code === "forbidden"
      ? "Invalid setup token"
      : errorMessage(error);
  return <Callout tone="error">{message}</Callout>;
}

function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<Key, string>>({
    setupToken: "",
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const setup = useMutation({
    mutationFn: api.setup.submit,
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
    if (Object.keys(next).length === 0) setup.mutate(body);
  }

  return (
    <AuthLayout
      title="Set up Anchor"
      description="Create the owner account. You need the setup token configured on the Worker."
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {setup.isError ? <SetupError error={setup.error} /> : null}
        <Field htmlFor="setupToken" label="Setup token" error={errors.setupToken}>
          <Input type="password" autoComplete="off" autoFocus {...field("setupToken")} />
        </Field>
        <Field htmlFor="name" label="Name" error={errors.name}>
          <Input autoComplete="name" {...field("name")} />
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
