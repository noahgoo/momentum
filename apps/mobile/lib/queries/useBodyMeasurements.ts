import { useQuery } from "@tanstack/react-query";
import type { BodyMeasurement } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

/** Client's body_measurements, most recent first. Immutable entries (constraint #10) — no edit, delete+re-add only. */
export function useBodyMeasurements(uid: string | undefined) {
  return useQuery<BodyMeasurement[]>({
    queryKey: qk.bodyMeasurements(uid ?? ""),
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("body_measurements")
        .select("*")
        .eq("client_id", uid as string)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
