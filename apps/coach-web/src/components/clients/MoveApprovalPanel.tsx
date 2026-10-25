import type { Profile } from "@momentum/shared";
import { useSetMoveApproval } from "../../queries/useClientDetail";

const OPTIONS = [
  {
    value: "coach",
    label: "Ask me first",
    hint: "Their requests wait in your inbox until you approve them.",
  },
  {
    value: "auto",
    label: "Move automatically",
    hint: "Their moves apply right away and you are only told. They can still only move onto rest days.",
  },
] as const;

/** Per-client choice of who approves a client's requests to move or reschedule workouts. */
export function MoveApprovalPanel({ profile }: { profile: Profile }) {
  const setApproval = useSetMoveApproval(profile.id);
  const current = profile.move_approval === "auto" ? "auto" : "coach";

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--ink-50)]">
        When this client asks to move a workout, including one they missed.
      </p>
      <div role="radiogroup" aria-label="Workout move approval" className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={setApproval.isPending}
              onClick={() => {
                if (!active) setApproval.mutate(option.value);
              }}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                active
                  ? "border-[var(--ink)] bg-[var(--ink-08)]"
                  : "border-[var(--ink-08)] hover:border-[var(--ink-30)]"
              }`}
            >
              <span className="block text-sm font-medium text-[var(--ink)]">{option.label}</span>
              <span className="mt-1 block text-xs text-[var(--ink-50)]">{option.hint}</span>
            </button>
          );
        })}
      </div>
      {setApproval.isError && (
        <p className="mt-2 text-xs text-[var(--bad)]">Could not save this setting. Try again.</p>
      )}
    </div>
  );
}
