import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { qk } from "./keys";
import { thumbPathFor } from "./useProgressPhotos";

export interface DeleteProgressPhotoInput {
  clientId: string;
  photoId: string;
  storagePath: string;
}

/**
 * Deletes a progress photo per constraint #10's exact reverse ordering:
 * storage objects first (best-effort — a partial/already-gone object is not
 * a blocking error), metadata row last. This way a retry after a failed
 * delete can still find the storage paths via the row; the row is only
 * removed once nothing else needs it.
 */
export function useDeleteProgressPhoto() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, photoId, storagePath }: DeleteProgressPhotoInput) => {
      await supabase.storage
        .from("progress-photos")
        .remove([storagePath, thumbPathFor(storagePath)])
        .catch(() => undefined);

      const { error } = await supabase
        .from("progress_photos")
        .delete()
        .eq("id", photoId)
        .eq("client_id", clientId);
      if (error) throw error;
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.progressPhotos(clientId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(clientId) });
    },
  });
}
