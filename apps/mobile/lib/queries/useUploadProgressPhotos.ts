import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../supabase";
import { qk } from "./keys";

const FULL_MAX_EDGE = 1280;
const FULL_QUALITY = 0.8;
const THUMB_MAX_EDGE = 320;
const THUMB_QUALITY = 0.7;

const CACHE_CONTROL = "31536000"; // photos are immutable once uploaded (constraint #10)

export interface UploadPhotoInput {
  /** file:// URI from expo-image-picker */
  uri: string;
}

export interface UploadProgressPhotosInput {
  clientId: string;
  photos: UploadPhotoInput[];
}

export interface UploadProgressPhotosResult {
  succeeded: number;
  failed: number;
}

interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Resizes a picked image to a max long edge and returns it as a Blob ready for upload. */
async function compress(uri: string, maxEdge: number, quality: number): Promise<CompressedImage> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: maxEdge }); // resize() preserves aspect ratio when only one dimension is given
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const blob = await (await fetch(result.uri)).blob();
  return { blob, width: result.width, height: result.height };
}

/**
 * Uploads one photo per constraint #10's exact ordering:
 *   1. compress full (long edge <=1280, q0.8) + thumb (<=320, q0.7)
 *   2. upload BOTH storage objects
 *   3. insert the progress_photos metadata row LAST
 * A failure at any upload step throws before the metadata row is ever
 * written — a failed upload must never leave a dangling row.
 */
async function uploadOne(clientId: string, photo: UploadPhotoInput): Promise<void> {
  const [full, thumb] = await Promise.all([
    compress(photo.uri, FULL_MAX_EDGE, FULL_QUALITY),
    compress(photo.uri, THUMB_MAX_EDGE, THUMB_QUALITY),
  ]);

  const id = crypto.randomUUID();
  const storagePath = `${clientId}/${id}.jpg`;
  const thumbPath = `${clientId}/${id}_thumb.jpg`;

  const [fullUpload, thumbUpload] = await Promise.all([
    supabase.storage.from("progress-photos").upload(storagePath, full.blob, {
      contentType: "image/jpeg",
      cacheControl: CACHE_CONTROL,
      upsert: false,
    }),
    supabase.storage.from("progress-photos").upload(thumbPath, thumb.blob, {
      contentType: "image/jpeg",
      cacheControl: CACHE_CONTROL,
      upsert: false,
    }),
  ]);
  if (fullUpload.error) throw fullUpload.error;
  if (thumbUpload.error) throw thumbUpload.error;

  // Metadata row written LAST — a failed upload above throws before this
  // runs, so no row is ever created for a photo whose bytes didn't land.
  const { error: insertError } = await supabase.from("progress_photos").insert({
    client_id: clientId,
    storage_path: storagePath,
    width: full.width,
    height: full.height,
    size_bytes: full.blob.size + thumb.blob.size,
    taken_at: new Date().toISOString(),
  });
  if (insertError) throw insertError;
}

/**
 * Uploads a batch of picked photos (multi-select), one at a time. Each
 * photo's success/failure is independent — one failing does not roll back
 * or block the others, mirroring the old app's per-file try/catch loop
 * (mindful-miya's photos page). Callers surface `failed` count as a partial
 * error, `succeeded === 0` as a full failure.
 */
export function useUploadProgressPhotos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, photos }: UploadProgressPhotosInput): Promise<UploadProgressPhotosResult> => {
      let succeeded = 0;
      let failed = 0;
      for (const photo of photos) {
        try {
          await uploadOne(clientId, photo);
          succeeded++;
        } catch (err) {
          console.error("Progress photo upload failed:", err);
          failed++;
        }
      }
      return { succeeded, failed };
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.progressPhotos(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
