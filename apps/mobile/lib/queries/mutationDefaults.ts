import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "../supabase";
import type { SaveWorkoutLogInput } from "./useSaveWorkoutLog";
import { buildSaveWorkoutLogArgs } from "./useSaveWorkoutLog";
import {
  insertBodyMeasurement,
  type CreateBodyMeasurementInput,
} from "./useCreateBodyMeasurement";

/**
 * Registers mutationFns by key so paused mutations can be replayed after an
 * app restart.
 *
 * A queued mutation is persisted as `{ mutationKey, variables }` — the
 * function itself cannot be serialized. Without a default registered for its
 * key, a restored mutation has nothing to call and is silently dropped: the
 * client's logged workout would sit in storage forever. See
 * docs/rules/offline-perf.md S3.
 *
 * Only writes that are safe to replay belong here. Every one of these is
 * idempotent server-side (R2/C4): saving a log replaces its children rather
 * than appending, the warmup toggle sets an absolute value rather than
 * flipping one, and a replayed measurement insert that collides with the row it
 * already wrote treats the duplicate as success.
 *
 * Deliberately absent: assign_program and accept_change_request. Both depend
 * on current server state — replaying an assign made an hour ago could
 * overwrite a newer one — so they must fail fast rather than queue.
 */
export function registerMutationDefaults(queryClient: QueryClient) {
  queryClient.setMutationDefaults(["saveWorkoutLog"], {
    mutationFn: async (input: unknown) => {
      const { data, error } = await supabase.rpc(
        "save_workout_log",
        buildSaveWorkoutLogArgs(input as SaveWorkoutLogInput)
      );
      if (error) throw new Error(error.message);
      return data;
    },
  });

  queryClient.setMutationDefaults(["setWarmupCompleted"], {
    mutationFn: async (input: unknown) => {
      const { date, completed } = input as { date: string; completed: boolean };
      const { error } = await supabase.rpc("set_warmup_completed", {
        p_date: date,
        p_completed: completed,
      });
      if (error) throw new Error(error.message);
    },
  });

  queryClient.setMutationDefaults(["sendMessage"], {
    mutationFn: async (input: unknown) => {
      const { clientId, text } = input as { clientId: string; text: string };
      const { data, error } = await supabase.rpc("send_message", {
        p_thread_client_id: clientId,
        p_text: text,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  queryClient.setMutationDefaults(["createBodyMeasurement"], {
    // Only the replay may treat a duplicate as done — it is re-sending a write
    // that already landed. The interactive save must not; see the note on
    // insertBodyMeasurement.
    mutationFn: async (input: unknown) =>
      insertBodyMeasurement(input as CreateBodyMeasurementInput, { onDuplicate: "succeed" }),
  });

  queryClient.setMutationDefaults(["toggleGoalLog"], {
    mutationFn: async (input: unknown) => {
      // Same variable shape useToggleGoalLog sends, so a replay reconstructs
      // the identical call.
      const { goal, clientId, date, isLogged } = input as {
        goal: { id: string; text: string };
        clientId: string;
        date: string;
        isLogged: boolean;
      };
      if (isLogged) {
        const { error } = await supabase
          .from("goal_logs")
          .delete()
          .eq("goal_id", goal.id)
          .eq("date", date);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("goal_logs")
        .upsert(
          { goal_id: goal.id, client_id: clientId, date, goal_text: goal.text },
          { onConflict: "goal_id,date", ignoreDuplicates: true }
        );
      if (error) throw error;
    },
  });
}
