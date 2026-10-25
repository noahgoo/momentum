import { useQuery } from "@tanstack/react-query";
import type { DistanceUnit, WeightUnit } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

export interface ClientUnits {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
}

/**
 * A client's preferred units (profiles.weight_unit / distance_unit), so a
 * day built for one client starts in the units they actually use. Disabled
 * without a client id: a library workout belongs to nobody, so it keeps the
 * app default. Only ever SEEDS a new row — a prescription carries its own
 * unit, and changing the preference later rewrites nothing (P6).
 */
export function useClientUnits(clientId: string | null | undefined) {
  return useQuery<ClientUnits>({
    queryKey: qk.clientUnits(clientId ?? ""),
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("weight_unit, distance_unit")
        .eq("id", clientId as string)
        .single();
      if (error) throw error;
      return { weightUnit: data.weight_unit, distanceUnit: data.distance_unit };
    },
  });
}
