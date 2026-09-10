import { useState } from "react";
import { Link } from "react-router";
import type { ClientSummary } from "@momentum/shared";
import { avatarInitial } from "../components/dashboard/format";
import { useClientSummaries } from "../queries/useClientSummaries";
import { useToggleClientDisabled } from "../queries/useClientDetail";

/** Disabled stub per the slice's NON-GOALS: email invite sending needs an Edge Function, post-MVP. */
function InviteClientStub() {
  return (
    <div className="group relative">
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-lg bg-[var(--ink-08)] px-4 py-2.5 text-sm font-medium text-[var(--ink-30)]"
      >
        Invite client
      </button>
      <div className="pointer-events-none absolute top-full right-0 z-10 mt-1.5 w-56 rounded-lg bg-[var(--ink)] px-3 py-2 text-xs text-white opacity-0 shadow-lg transition group-hover:opacity-100">
        Invites need an Edge Function — post-MVP.
      </div>
    </div>
  );
}

function RosterRowToggle({ client }: { client: ClientSummary }) {
  const toggleDisabled = useToggleClientDisabled(client.client_id);

  return (
    <button
      type="button"
      disabled={toggleDisabled.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const verb = client.disabled ? "Enable" : "Disable";
        if (
          window.confirm(
            `${verb} ${client.display_name || "this client"}? ${
              client.disabled
                ? "They will regain access to the client app."
                : "They will be signed out and unable to log in until re-enabled."
            }`
          )
        ) {
          toggleDisabled.mutate(!client.disabled);
        }
      }}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
        client.disabled
          ? "border-[var(--ok)] text-[var(--ok)] hover:bg-[var(--ok)]/10"
          : "border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)]/10"
      }`}
    >
      {toggleDisabled.isPending ? "…" : client.disabled ? "Enable" : "Disable"}
    </button>
  );
}

function RosterRow({ client }: { client: ClientSummary }) {
  return (
    <Link
      to={`/clients/${client.client_id}`}
      className={`admin-card flex items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-[var(--blue)] ${
        client.disabled ? "opacity-60" : ""
      }`}
    >
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--blue)] text-sm font-semibold text-white">
        {avatarInitial(client.display_name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{client.display_name || "—"}</p>
          {client.disabled && (
            <span className="flex-none rounded-full bg-[var(--ink-08)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink-50)]">
              Disabled
            </span>
          )}
        </div>
        <p className="truncate text-xs text-[var(--ink-30)]">{client.email}</p>
        {/* Streak and today's workout ride under the name on a phone. As
            separate flex columns they leave the name about 90px to live in,
            which truncates almost every real client to two words. */}
        <p className="mt-1 flex items-center gap-2 text-xs text-[var(--ink-50)] sm:hidden">
          <span className="flex-none font-semibold text-[var(--ink-70)]">🔥 {client.streak}</span>
          <span className="truncate">
            {client.has_program ? (client.today_workout_name ?? "Rest day") : "No program"}
          </span>
        </p>
      </div>
      <div className="hidden flex-none text-xs font-semibold whitespace-nowrap text-[var(--ink-70)] sm:block">
        🔥 {client.streak}
      </div>
      <div className="hidden w-36 flex-none text-right text-xs text-[var(--ink-50)] sm:block">
        {client.has_program ? (client.today_workout_name ?? "Rest day") : "No program"}
      </div>
      <div className="flex-none">
        <RosterRowToggle client={client} />
      </div>
    </Link>
  );
}

/** Coach roster: name/email/streak/program-status list from `client_summaries`, plus enable/disable + invite stub. */
export function ClientsPage() {
  const { data: summaries, isLoading } = useClientSummaries();
  const [query, setQuery] = useState("");

  const rows = summaries ?? [];
  const filtered = query.trim()
    ? rows.filter((c) => {
        const q = query.trim().toLowerCase();
        return (c.display_name ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
      })
    : rows;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-[var(--ink)] sm:text-3xl">Clients</h1>
          <p className="mt-1 text-sm text-[var(--ink-50)]">
            {isLoading ? "Loading…" : `${rows.length} client${rows.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <InviteClientStub />
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        className="mb-4 w-full max-w-sm rounded-lg border border-[var(--ink-08)] px-3 py-2 text-sm outline-none focus:border-[var(--blue-deep)]"
      />

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="admin-card h-[72px] animate-pulse p-4" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="admin-card border border-dashed border-[var(--ink-08)] py-16 text-center">
          <p className="text-sm text-[var(--ink-50)]">
            {rows.length === 0 ? "No clients yet." : "No clients match your search."}
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((client) => (
            <RosterRow key={client.client_id} client={client} />
          ))}
        </div>
      )}
    </div>
  );
}
