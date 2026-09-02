import { useEffect, useState } from "react";
import type { SignedProgressPhoto } from "../../queries/useClientProgressPhotos";

interface Props {
  photos: SignedProgressPhoto[];
}

function photoDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Horizontal thumbnail strip + full-screen lightbox for progress photos.
 * Ported from the old app's inline photos section. `progress-photos` is a
 * private bucket, so every URL here is a time-limited signed URL from
 * `useClientProgressPhotos` (batch-signed via `createSignedUrls`) — there is
 * no separate "thumb" bucket path in this schema, so the strip and lightbox
 * both use the same signed URL at different display sizes.
 */
export function ProgressPhotosStrip({ photos }: Props) {
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);

  useEffect(() => {
    if (photoIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPhotoIdx(null);
      if (e.key === "ArrowLeft") setPhotoIdx((i) => (i === null || i <= 0 ? i : i - 1));
      if (e.key === "ArrowRight") setPhotoIdx((i) => (i === null || i >= photos.length - 1 ? i : i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photoIdx, photos.length]);

  if (photos.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--ink-08)] py-10 text-center text-sm text-[var(--ink-30)]">
        No photos yet — they&apos;ll appear here once uploaded
      </div>
    );
  }

  const active = photoIdx !== null ? photos[photoIdx] : null;

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setPhotoIdx(i)}
            className="flex-none text-left"
            style={{ scrollSnapAlign: "start" }}
          >
            {photo.signedUrl ? (
              <img
                src={photo.signedUrl}
                alt={`Progress photo from ${photoDate(photo.taken_at)}`}
                width={112}
                height={112}
                className="h-28 w-28 rounded-xl bg-[var(--cream)] object-cover"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-[var(--cream)] text-xs text-[var(--ink-30)]">
                Unavailable
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-[var(--ink-50)]">{photoDate(photo.taken_at)}</div>
          </button>
        ))}
      </div>

      {active && photoIdx !== null && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setPhotoIdx(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Progress photo"
          className="fixed inset-0 z-[90] flex flex-col p-4"
          style={{ background: "rgba(28,28,28,0.94)" }}
        >
          <div className="flex shrink-0 items-center justify-between">
            <div className="text-sm text-white/75">
              {photoDate(active.taken_at)}
              <span className="ml-2 text-white/40">
                {photoIdx + 1} / {photos.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPhotoIdx(null)}
              aria-label="Close"
              className="px-2 py-1 text-2xl leading-none text-white"
            >
              ×
            </button>
          </div>
          <div
            className="my-3 flex min-h-0 flex-1 items-center justify-center"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPhotoIdx(null);
            }}
          >
            {active.signedUrl ? (
              <img
                src={active.signedUrl}
                alt=""
                className="rounded-xl object-contain"
                style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }}
              />
            ) : (
              <p className="text-sm text-white/60">This photo could not be loaded.</p>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setPhotoIdx((i) => (i === null || i <= 0 ? i : i - 1))}
              disabled={photoIdx === 0}
              aria-label="Previous photo"
              className="h-10 w-10 rounded-full border border-white/30 text-white disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setPhotoIdx((i) => (i === null || i >= photos.length - 1 ? i : i + 1))}
              disabled={photoIdx === photos.length - 1}
              aria-label="Next photo"
              className="h-10 w-10 rounded-full border border-white/30 text-white disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
