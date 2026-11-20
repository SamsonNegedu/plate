import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router";
import { z } from "zod";
import { ApiError, useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { copy } from "@/lib/copy";
import { NetworkError } from "@/sync/errors";
import { AuthShell } from "./AuthShell";
import { RecoveryCodes } from "./RecoveryCodes";

const schema = z.object({
  username: z.string().trim().min(3, copy.signup.invalidUsername),
  password: z.string().min(12, copy.signup.passwordHint),
});

type Form = z.infer<typeof schema>;

function signupProblem(err: unknown): string {
  if (err instanceof NetworkError) return copy.signup.offline;
  if (!(err instanceof ApiError)) return copy.signup.failed;
  switch (err.code) {
    case "username_taken":
      return copy.signup.taken;
    case "invalid_username":
      return copy.signup.invalidUsername;
    case "weak_password":
      return err.detail || copy.signup.passwordHint;
    case "signup_disabled":
      return copy.signup.closed;
    case "rate_limited":
      return copy.signup.rateLimited;
    case "challenge_invalid":
    case "challenge_expired":
      return copy.signup.retryCheck;
    default:
      return copy.signup.failed;
  }
}

export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
    mode: "onSubmit",
  });
  const { errors, isSubmitting } = form.formState;

  // The session already exists once the codes are showing; keep them on screen until they are saved.
  if (auth.status === "authed" && !codes) return <Navigate to="/today" replace />;

  if (codes) {
    return (
      <AuthShell>
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            void auth.recheck().then(() => navigate("/today", { replace: true }));
          }}
        />
      </AuthShell>
    );
  }

  const submit = form.handleSubmit(async (v) => {
    setProblem(null);
    try {
      setCodes(await auth.signup(v.username, v.password));
    } catch (err) {
      setProblem(signupProblem(err));
    }
  });

  return (
    <AuthShell>
      <form
        className="grid gap-3.5 rounded-card border border-line bg-surface p-5"
        onSubmit={submit}
        noValidate
      >
        <h2 className="text-section font-semibold">{copy.signup.title}</h2>
        <Field
          label={copy.signup.username}
          hint={copy.signup.usernameHint}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.username?.message}
          {...form.register("username")}
        />
        <Field
          label={copy.signup.password}
          hint={copy.signup.passwordHint}
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        {problem ? (
          <p className="text-label text-red" role="alert">
            {problem}
          </p>
        ) : null}
        {isSubmitting ? (
          <p className="text-label text-ink-2" role="status">
            {copy.signup.checking}
          </p>
        ) : null}
        <Button type="submit" variant="primary" block busy={isSubmitting}>
          {isSubmitting ? copy.signup.working : copy.signup.submit}
        </Button>
      </form>
      <nav className="mt-4 text-center text-label" aria-label="Account">
        <Link className="inline-flex min-h-11 items-center justify-center text-ink-2" to="/login">
          {copy.signup.haveAccount}
        </Link>
      </nav>
    </AuthShell>
  );
}
