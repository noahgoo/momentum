import { useQuery } from "@tanstack/react-query";
import {
  addDaysStr,
  mondayOfStr,
  type Friendship,
  type Goal,
  type GoalLog,
  type MotivationEntry,
} from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

export interface DashboardFriendSummary {
  count: number;
  pendingCount: number;
  /** First accepted friendship's shared streak + display name, for the card's headline. */
  first: { friendName: string; sharedStreak: number } | null;
}

export interface DashboardPhotoSummary {
  count: number;
}

export interface DashboardMeasurementSummary {
  weightLbs: number | null;
  date: string;
}

export interface DashboardResult {
  motivation: MotivationEntry | null;
  goals: Goal[];
  completedGoalIds: Set<string>;
  /** Yesterday's workout_log row, only the fields the feel prompt needs. */
  showFeelPrompt: boolean;
  friends: DashboardFriendSummary;
  photos: DashboardPhotoSummary;
  measurement: DashboardMeasurementSummary | null;
}

/**
 * Batches everything the dashboard needs that ISN'T already covered by
 * `useProfile` (greeting name) or `useTodayWorkout` (today's workout +
 * streak) — see dashboard.tsx, which composes all three. Mirrors the
 * `useTodayWorkout` composite-query shape (README "Row types" + "Query
 * keys" rules): one `qk.dashboard(uid)` key, everything fetched in
 * parallel, every "nothing found" branch returns a valid empty state
 * rather than throwing.
 */
export function useDashboard(
  uid: string | undefined,
  coachId: string | null | undefined,
  /** The client's today (YYYY-MM-DD), from useClientDate — never the device clock. */
  todayStr: string
) {
  return useQuery<DashboardResult>({
    queryKey: qk.dashboard(uid ?? "", todayStr),
    enabled: Boolean(uid),
    queryFn: async () => {
      const clientId = uid as string;
      const yesterdayStr = addDaysStr(todayStr, -1);
      const mondayStr = mondayOfStr(todayStr);

      const [motivation, goals, todayGoalLogs, yesterdayLog, friends, photos, measurement] =
        await Promise.all([
          fetchMotivation(coachId ?? null, mondayStr, todayStr),
          fetchActiveGoals(clientId),
          fetchGoalLogs(clientId, todayStr),
          fetchWorkoutLog(clientId, yesterdayStr),
          fetchFriendSummary(clientId),
          fetchPhotoCount(clientId),
          fetchLatestMeasurement(clientId),
        ]);

      return {
        motivation,
        goals,
        completedGoalIds: new Set(todayGoalLogs.map((log) => log.goal_id)),
        showFeelPrompt: Boolean(yesterdayLog?.completed) && yesterdayLog?.next_day_feel == null,
        friends,
        photos,
        measurement,
      };
    },
  });
}

async function fetchMotivation(
  coachId: string | null,
  mondayStr: string,
  todayStr: string
): Promise<MotivationEntry | null> {
  if (!coachId) return null;

  const { data: exact, error: exactError } = await supabase
    .from("motivation_entries")
    .select("*")
    .eq("created_by", coachId)
    .eq("week_start", mondayStr)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact) return exact;

  const { data: latest, error: latestError } = await supabase
    .from("motivation_entries")
    .select("*")
    .eq("created_by", coachId)
    .lte("week_start", todayStr)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  return latest ?? null;
}

async function fetchActiveGoals(clientId: string): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("client_id", clientId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchGoalLogs(clientId: string, date: string): Promise<GoalLog[]> {
  const { data, error } = await supabase
    .from("goal_logs")
    .select("*")
    .eq("client_id", clientId)
    .eq("date", date);
  if (error) throw error;
  return data ?? [];
}

async function fetchWorkoutLog(clientId: string, date: string) {
  const { data, error } = await supabase
    .from("workout_logs")
    .select("completed, next_day_feel")
    .eq("client_id", clientId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchFriendSummary(clientId: string): Promise<DashboardFriendSummary> {
  const { data, error } = await supabase
    .from("friendships")
    .select("*")
    .or(`client_id.eq.${clientId},friend_id.eq.${clientId}`);
  if (error) throw error;

  const rows = (data ?? []) as Friendship[];
  const accepted = rows.filter((f) => f.status === "accepted");
  const pending = rows.filter((f) => f.status === "pending" && f.requested_by !== clientId);

  let first: DashboardFriendSummary["first"] = null;
  if (accepted.length > 0) {
    const friendship = accepted[0];
    const friendId = friendship.client_id === clientId ? friendship.friend_id : friendship.client_id;
    const memberNames = (friendship.member_names ?? {}) as Record<string, string>;
    first = {
      friendName: memberNames[friendId] ?? "Friend",
      sharedStreak: friendship.shared_streak,
    };
  }

  return { count: accepted.length, pendingCount: pending.length, first };
}

async function fetchPhotoCount(clientId: string): Promise<DashboardPhotoSummary> {
  const { count, error } = await supabase
    .from("progress_photos")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw error;
  return { count: count ?? 0 };
}

async function fetchLatestMeasurement(
  clientId: string
): Promise<DashboardMeasurementSummary | null> {
  const { data, error } = await supabase
    .from("body_measurements")
    .select("weight_lbs, date")
    .eq("client_id", clientId)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { weightLbs: data.weight_lbs, date: data.date };
}
