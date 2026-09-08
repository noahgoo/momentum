import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { session, profile, rejectedReason, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session && profile?.role === "coach") {
    const from = (location.state as { from?: Location } | null)?.from;
    return <Navigate to={from?.pathname ?? "/"} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result.error) setError(result.error);
  }

  const message = error ?? rejectedReason;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--cream)] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* The logo is the wordmark; its own background matches --cream, so it
            sits on the page rather than in the card. */}
        <img
          src="/momentum-logo.png"
          alt="Momentum"
          width={260}
          height={260}
          className="mx-auto block h-auto w-[260px]"
        />

        <div className="-mt-6 mb-6 text-center">
          {/* .font-display forces italic, so the serif face is set directly
              here — only "back" is italic, as on the brand's own page. */}
          <h1 className="text-[34px] leading-none tracking-tight text-[var(--ink)] [font-family:'Fraunces',serif]">
            Welcome <em>back</em>
          </h1>
          <p className="mt-2 text-[13px] text-[var(--ink-50)]">
            Sign in to the coach portal.
          </p>
        </div>

        <form className="admin-card space-y-3 p-5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm text-[var(--ink-70)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[14px] border border-[var(--ink-08)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-30)] focus:border-[var(--blue)]"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm text-[var(--ink-70)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[14px] border border-[var(--ink-08)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-30)] focus:border-[var(--blue)]"
            />
          </div>

          {message && <p className="text-[13px] text-[var(--bad)]">{message}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-[50px] w-full rounded-[18px] bg-[var(--ink)] text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-[var(--ink-30)]">
          <Link to="/forgot-password" className="underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </div>
  );
}
