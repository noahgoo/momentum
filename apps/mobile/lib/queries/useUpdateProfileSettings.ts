import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Database, Profile } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/**
 * Fields the settings screen can autosave. Deliberately a subset of
 * `ProfileUpdate` — every card in settings.tsx patches one or two of these
 * fields at a time (display name on blur, notifications switch immediately,
 * body fields on blur/select). No `timezone` here: that's device-synced only
 * (lib/timezone.ts), read-only in this screen (plan decision).
 */
export type ProfileSettingsPatch = Pick<
  ProfileUpdate,
  "display_name" | "notifications_enabled" | "notification_time" | "height_in" | "sex"
>;

interface UpdateProfileSettingsInput {
  uid: string;
  patch: ProfileSettingsPatch;
}

/**
 * Single mutation shared by every autosave field in settings.tsx. Follows
 * the README optimistic-mutation shape: patch the cached `Profile` in
 * `qk.profile(uid)` immediately (mirrors useSetWorkoutDifficulty's
 * single-object patch pattern), roll back the exact snapshot on error,
 * always invalidate on settle so the cache reconciles with the server.
 *
 * One mutation for all fields (rather than one per field) because they all
 * write to the same row and share the identical optimistic/rollback shape —
 * only the patch payload differs per call site.
 */
export function useUpdateProfileSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ uid, patch }: UpdateProfileSettingsInput) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", uid);
      if (error) throw error;
    },

    onMutate: async ({ uid, patch }) => {
      const key = qk.profile(uid);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Profile | null>(key);

      queryClient.setQueryData<Profile | null>(key, (current) =>
        current ? { ...current, ...patch } : current
      );

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { uid }) => {
      void queryClient.invalidateQueries({ queryKey: qk.profile(uid) });
    },
  });
}
