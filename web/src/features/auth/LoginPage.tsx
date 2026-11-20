import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { ApiError, useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { copy } from "@/lib/copy";
import { NetworkError } from "@/sync/errors";
import { AuthShell } from "./AuthShell";

const schema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

type Form = z.infer<typeof schema>;

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
    mode: "onSubmit",
  });
  const { errors, isSubmitting } = form.formState;
  const from =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/today";

  const notice =
    typeof location.state === "object" &&
    location.state !== null &&
    "notice" in location.state &&
    typeof location.state.notice === "string"
      ? location.state.notice
      : null;

  if (auth.status === "authed") return <Navigate to={from} replace />;

  const submit = form.handleSubmit(async (v) => {
    setProblem(null);
    try {
      await auth.login(v.username, v.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setProblem(copy.login.rateLimited);
      else if (err instanceof ApiError && err.status === 401) setProblem(copy.login.wrong);
      else if (err instanceof NetworkError) setProblem(copy.login.offline);
      else setProblem(copy.login.failed);
    }
  });

  return (
    <AuthShell>
      <form
        className="grid gap-3.5 rounded-card border border-line bg-surface p-5"
        onSubmit={submit}
        noValidate
      >
        <h2 className="text-section font-semibold">{copy.login.title}</h2>
        {notice ? (
          <p className="text-label text-ink-2" role="status">
            {notice}
          </p>
        ) : null}
        <Field
          label={copy.login.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.username?.message}
          {...form.register("username")}
        />
        <Field
          label={copy.login.password}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        {problem ? (
          <p className="text-label text-red" role="alert">
            {problem}
          </p>
        ) : null}
        <Button type="submit" variant="primary" block busy={isSubmitting}>
          {copy.login.submit}
        </Button>
      </form>
      <nav className="mt-3 grid gap-3 text-center text-label" aria-label="Account">
        <Link className="inline-flex min-h-11 items-center justify-center text-accent" to="/signup">
          {copy.login.create}
        </Link>
        <Link className="inline-flex min-h-11 items-center justify-center text-ink-2" to="/reset">
          {copy.login.forgot}
        </Link>
      </nav>
    </AuthShell>
  );
}
