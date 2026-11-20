import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { ApiError, useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { copy } from "@/lib/copy";
import { NetworkError } from "@/sync/errors";
import { AuthShell } from "./AuthShell";

const schema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  code: z.string().trim().min(1, "Enter a recovery code."),
  password: z.string().min(12, copy.signup.passwordHint),
});

type Form = z.infer<typeof schema>;

export function ResetPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", code: "", password: "" },
    mode: "onSubmit",
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setProblem(null);
    try {
      await auth.resetPassword(v.username, v.code, v.password);
      navigate("/login", { replace: true, state: { notice: copy.reset.done } });
    } catch (err) {
      if (err instanceof NetworkError) setProblem(copy.reset.offline);
      else if (err instanceof ApiError && err.status === 401) setProblem(copy.reset.wrong);
      else if (err instanceof ApiError && err.status === 429) setProblem(copy.reset.rateLimited);
      else if (err instanceof ApiError && err.code === "weak_password")
        setProblem(err.detail || copy.signup.passwordHint);
      else setProblem(copy.reset.failed);
    }
  });

  return (
    <AuthShell>
      <form
        className="grid gap-3.5 rounded-card border border-line bg-surface p-5"
        onSubmit={submit}
        noValidate
      >
        <h2 className="text-section font-semibold">{copy.reset.title}</h2>
        <p className="text-body text-ink-2">{copy.reset.body}</p>
        <Field
          label={copy.reset.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          error={errors.username?.message}
          {...form.register("username")}
        />
        <Field
          label={copy.reset.code}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          error={errors.code?.message}
          {...form.register("code")}
        />
        <Field
          label={copy.reset.password}
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
        <Button type="submit" variant="primary" block busy={isSubmitting}>
          {copy.reset.submit}
        </Button>
      </form>
      <nav className="mt-4 text-center text-label" aria-label="Account">
        <Link className="inline-flex min-h-11 items-center justify-center text-ink-2" to="/login">
          {copy.reset.back}
        </Link>
      </nav>
    </AuthShell>
  );
}
