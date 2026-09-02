import { useQuery } from "@tanstack/react-query";
import type { ProgressPhoto } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough for a coach's viewing session

export interface SignedProgressPhoto extends ProgressPhoto {
  /** Signed URL for the full-size image, or null if signing failed for this row. */
  signedUrl: string | null;
}

/**
 * Progress photos for one client, with batch-signed URLs. `progress-photos`
 * is a private storage bucket (client photo-sharing consent lives at the
 * bucket-policy level) — there is no public URL to read directly, so every
 * row's `storage_path` is signed in one batched
 * `createSignedUrls` call rather than N individual `createSignedUrl` round
 * trips.
 */
export function useClientProgressPhotos(clientId: string | undefined) {
  return useQuery<SignedProgressPhoto[]>({
    queryKey: qk.clientProgressPhotos(clientId ?? ""),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const id = clientId as string;
      const { data: rows, error } = await supabase
        .from("progress_photos")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const { data: signed, error: signError } = await supabase.storage
        .from("progress-photos")
        .createSignedUrls(
          rows.map((r) => r.storage_path),
          SIGNED_URL_TTL_SECONDS
        );
      if (signError) throw signError;

      const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl ?? null]));
      return rows.map((row) => ({ ...row, signedUrl: urlByPath.get(row.storage_path) ?? null }));
    },
  });
}
