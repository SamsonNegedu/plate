import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { ApiError, useAuth } from "@/app/auth";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { copy } from "@/lib/copy";
import { NetworkError } from "@/sync/errors";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email.").email("Enter a valid email."),
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
    defaultValues: { email: "", password: "" },
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

  if (auth.status === "authed") return <Navigate to={from} replace />;

  const submit = form.handleSubmit(async (v) => {
    setProblem(null);
    try {
      await auth.login(v.email, v.password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setProblem(copy.login.rateLimited);
      else if (err instanceof ApiError && err.status === 401) setProblem(copy.login.wrong);
      else if (err instanceof NetworkError) setProblem(copy.login.offline);
      else setProblem(copy.login.failed);
    }
  });

  return (
    <main className="mx-auto max-w-[420px] px-4 pt-[max(48px,env(safe-area-inset-top,0px))] pb-12">
      <h1 className="font-display text-display leading-display font-semibold">{copy.app.name}</h1>
      <p className="mt-3 mb-8 text-body text-ink-2">{copy.app.tagline}</p>
      <form
        className="grid gap-3.5 rounded-card border border-line bg-surface p-5"
        onSubmit={submit}
        noValidate
      >
        <h2 className="text-section font-semibold">{copy.login.title}</h2>
        <Field
          label={copy.login.email}
          type="email"
          autoComplete="username"
          inputMode="email"
          error={errors.email?.message}
          {...form.register("email")}
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
    </main>
  );
}
