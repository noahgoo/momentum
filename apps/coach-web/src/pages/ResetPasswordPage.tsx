import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <Navigate to="/" replace />;

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--cream)] text-[var(--ink-50)]">
        Loading…
      </div>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
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
            Set a new <em>password</em>
          </h1>
          <p className="mt-2 text-[13px] text-[var(--ink-50)]">
            {session ? "Choose a new password for your account." : "This reset link is invalid or has expired."}
          </p>
        </div>

        {session && (
          <form className="admin-card space-y-3 p-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm text-[var(--ink-70)]">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[14px] border border-[var(--ink-08)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-30)] focus:border-[var(--blue)]"
              />
            </div>

            <div>
              <label htmlFor="confirm" className="mb-1.5 block text-sm text-[var(--ink-70)]">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-[14px] border border-[var(--ink-08)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-30)] focus:border-[var(--blue)]"
              />
            </div>

            {error && <p className="text-[13px] text-[var(--bad)]">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 h-[50px] w-full rounded-[18px] bg-[var(--ink)] text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
