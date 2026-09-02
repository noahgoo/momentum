import { useEffect, useState } from "react";
import { useMotivationEntries, useUpsertMotivationEntry } from "../queries/useMotivationEntries";

function getWeekStart(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(today.setDate(diffToMonday));
  return monday.toISOString().split("T")[0]!;
}

export function MotivationPage() {
  const { data, isLoading, isError } = useMotivationEntries();
  const upsertMutation = useUpsertMotivationEntry();

  const [quote, setQuote] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const currentEntry = data?.current;

  // Initialize form with current entry if it exists
  useEffect(() => {
    if (currentEntry && !initialized) {
      setQuote(currentEntry.quote ?? "");
      setImageUrl(currentEntry.image_url ?? "");
      setInitialized(true);
    } else if (!currentEntry && !initialized && data) {
      setInitialized(true);
    }
  }, [currentEntry, initialized, data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote.trim()) return;

    try {
      await upsertMutation.mutateAsync({
        quote: quote.trim(),
        imageUrl: imageUrl.trim() || null,
        weekStart: getWeekStart(),
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save motivation entry:", err);
    }
  };

  if (isError) {
    return (
      <div className="admin-card p-6">
        <p className="text-sm text-[var(--bad)]">Failed to load motivation entries.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Current Week Card */}
      <div className="admin-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">This Week's Motivation</h2>

        {isLoading ? (
          <div className="space-y-3">
            <div className="h-20 animate-pulse rounded bg-[var(--ink-08)]" />
            <div className="h-4 animate-pulse rounded bg-[var(--ink-08)]" />
          </div>
        ) : currentEntry ? (
          <div className="space-y-4">
            {currentEntry.image_url && (
              <img
                src={currentEntry.image_url}
                alt="Motivation"
                className="h-48 w-full rounded-lg object-cover"
              />
            )}
            <blockquote className="border-l-4 border-[var(--blue)] pl-4 text-lg italic text-[var(--ink)]">
              "{currentEntry.quote}"
            </blockquote>
          </div>
        ) : (
          <p className="text-sm text-[var(--ink-50)]">No motivation set for this week yet.</p>
        )}
      </div>

      {/* Edit Form */}
      <div className="admin-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">Set This Week's Motivation</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Quote
            </label>
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              placeholder="Enter a motivational quote..."
              className="mt-2 w-full rounded-lg border border-[var(--ink-08)] bg-white px-4 py-3 text-sm text-[var(--ink)] placeholder-[var(--ink-30)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-50)]">
              Image URL (optional)
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="mt-2 w-full rounded-lg border border-[var(--ink-08)] bg-white px-4 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-30)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
            />
            {imageUrl && (
              <div className="mt-3">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="max-h-48 rounded-lg object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!quote.trim() || upsertMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-[var(--blue)] px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 hover:enabled:bg-[var(--blue-deep)]"
            >
              {upsertMutation.isPending ? "Saving…" : "Save Motivation"}
            </button>
            {isSaved && <span className="text-sm text-[var(--ok)]">Saved ✓</span>}
          </div>
        </form>
      </div>

      {/* History */}
      <div className="admin-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">
          History {data?.history.length ? `(${data.history.length})` : ""}
        </h2>

        {!isLoading && (!data?.history || data.history.length === 0) ? (
          <p className="text-sm text-[var(--ink-50)]">No past entries yet.</p>
        ) : (
          <div className="space-y-4">
            {data?.history.map((entry) => (
              <div key={entry.id} className="border-l-4 border-[var(--line)] pl-4">
                <p className="text-xs text-[var(--ink-30)]">
                  Week of {entry.week_start ? new Date(entry.week_start).toLocaleDateString() : "Unknown"}
                </p>
                <blockquote className="mt-1 italic text-[var(--ink)]">"{entry.quote}"</blockquote>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
