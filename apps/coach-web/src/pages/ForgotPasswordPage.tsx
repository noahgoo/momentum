import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    // Always show the same success state, whether or not the email exists,
    // so this page can't be used to probe for registered coach accounts.
    if (resetError) {
      setError("Something went wrong. Try again in a moment.");
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--cream)] px-4 py-10">
      <div className="w-full max-w-sm">
        <img
          src="/momentum-logo.png"
          alt="Momentum"
          width={260}
          height={260}
          className="mx-auto block h-auto w-[260px]"
        />

        <div className="-mt-6 mb-6 text-center">
          <h1 className="text-[34px] leading-none tracking-tight text-[var(--ink)] [font-family:'Fraunces',serif]">
            Reset <em>password</em>
          </h1>
          <p className="mt-2 text-[13px] text-[var(--ink-50)]">
            Enter your email and we'll send you a reset link.
          </p>
        </div>

        {sent ? (
          <div className="admin-card space-y-2 p-5 text-center">
            <p className="text-[15px] text-[var(--ink)]">Check your email</p>
            <p className="text-[13px] text-[var(--ink-50)]">
              If an account exists for {email}, a reset link is on its way.
            </p>
          </div>
        ) : (
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

            {error && <p className="text-[13px] text-[var(--bad)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 h-[50px] w-full rounded-[18px] bg-[var(--ink)] text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-[var(--ink-30)]">
          <Link to="/login" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
