import { useQuery } from "@tanstack/react-query";
import type { ProgressPhoto } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/** Derives the thumb's storage path from the full photo's storage_path.
 * There's no separate thumb_path column (see 0003 migration) — the
 * `..._thumb.jpg` suffix convention (constraint #10) makes it derivable. */
export function thumbPathFor(storagePath: string): string {
  return storagePath.replace(/\.jpg$/, "_thumb.jpg");
}

export interface ProgressPhotoWithUrls extends ProgressPhoto {
  /** Signed URL for the full-resolution image (lightbox only). */
  signedUrl: string | null;
  /** Signed URL for the thumbnail (grid). */
  signedThumbUrl: string | null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — plenty for one screen session

/**
 * Client's progress photos, most recent first, with freshly-signed URLs for
 * both the full image and its thumbnail. The `progress-photos` bucket is
 * private (constraint #10 / plan 2.3), so `url`/`thumb_url` columns are not
 * used for display — signed URLs are minted per-fetch via
 * `createSignedUrls`, batched into one storage call rather than per-photo.
 */
export function useProgressPhotos(uid: string | undefined) {
  return useQuery<ProgressPhotoWithUrls[]>({
    queryKey: qk.progressPhotos(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const clientId = uid as string;

      const { data: photos, error } = await supabase
        .from("progress_photos")
        .select("*")
        .eq("client_id", clientId)
        .order("taken_at", { ascending: false });
      if (error) throw error;
      if (!photos || photos.length === 0) return [];

      const paths = photos.flatMap((p) => [p.storage_path, thumbPathFor(p.storage_path)]);
      const { data: signed, error: signError } = await supabase.storage
        .from("progress-photos")
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (signError) throw signError;

      const urlByPath = new Map<string, string>();
      for (const entry of signed ?? []) {
        if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
      }

      return photos.map((photo) => ({
        ...photo,
        signedUrl: urlByPath.get(photo.storage_path) ?? null,
        signedThumbUrl: urlByPath.get(thumbPathFor(photo.storage_path)) ?? null,
      }));
    },
  });
}
