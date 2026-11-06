import { resetPasswordBodySchema } from "@anchor/shared";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { holdFragmentToken, releaseFragmentToken } from "@/lib/fragment-token";

export const Route = createFileRoute("/reset-password")({
  // The token is read (and the fragment stripped) before anything renders or fetches.
  beforeLoad: () => ({ resetToken: holdFragmentToken("anc_rst_") }),
  component: ResetPasswordPage,
});

const INVALID = "This reset link is invalid or has expired";

type Key = "password" | "confirm";
const MESSAGES: Record<Key, string> = {
  password: "Use at least 12 characters",
  confirm: PASSWORD_MISMATCH,
};

function ResetPasswordPage() {
  const [token] = useState(Route.useRouteContext().resetToken);
  useEffect(() => () => releaseFragmentToken("anc_rst_"), []);
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<Key, string>>({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const reset = useMutation({
    // No variables: the body is read from the form state so the token and password never sit in the
    // MutationCache (state.variables outlives the page by gcTime).
    mutationFn: () => api.auth.resetPassword({ token: token as string, password: values.password }),
    onSuccess: async () => {
      toast.success("Password updated, sign in again");
      await navigate({ to: "/login" });
    },
  });

  if (token === null) {
    return (
      <AuthLayout
        title={INVALID}
        description="Reset links work once and expire. Ask an admin for a new link."
      >
        <Button asChild size="sm">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthLayout>
    );
  }

  const field = (key: Key) => ({
    id: key,
    value: values[key],
    invalid: !!errors[key],
    onChange: (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { token: token as string, password: values.password };
    const next = validate(resetPasswordBodySchema, body, MESSAGES);
    if (values.confirm !== values.password) next.confirm = PASSWORD_MISMATCH;
    setErrors(next);
    if (Object.keys(next).length === 0) reset.mutate();
  }

  const failure =
    reset.error instanceof ApiClientError && reset.error.status === 404
      ? INVALID
      : reset.isError
        ? errorMessage(reset.error)
        : null;

  return (
    <AuthLayout title="Choose a new password">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {failure ? <Callout tone="error">{failure}</Callout> : null}
        <Field htmlFor="password" label="New password" hint={PASSWORD_HINT} error={errors.password}>
          <Input type="password" autoComplete="new-password" autoFocus {...field("password")} />
        </Field>
        <Field htmlFor="confirm" label="Confirm password" error={errors.confirm}>
          <Input type="password" autoComplete="new-password" {...field("confirm")} />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={reset.isPending}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}
