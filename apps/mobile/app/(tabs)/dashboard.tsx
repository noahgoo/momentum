import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type Goal } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { useProfile } from "../../lib/queries/useProfile";
import { useClientDate } from "../../lib/useClientDate";
import { useTodayWorkout } from "../../lib/queries/useTodayWorkout";
import { useDashboard } from "../../lib/queries/useDashboard";
import { useToggleGoalLog } from "../../lib/queries/useToggleGoalLog";
import { useUpdateNextDayFeel } from "../../lib/queries/useUpdateNextDayFeel";
import { GreetingHeader } from "../../components/dashboard/GreetingHeader";
import { MotivationCard } from "../../components/dashboard/MotivationCard";
import { TodayWorkoutCard } from "../../components/dashboard/TodayWorkoutCard";
import { FeelPromptCard } from "../../components/dashboard/FeelPromptCard";
import { GoalsStreakRow } from "../../components/dashboard/GoalsStreakRow";
import { FriendsCard } from "../../components/dashboard/FriendsCard";
import { ProgressEntryCards } from "../../components/dashboard/ProgressEntryCards";
import { DashboardSkeleton } from "../../components/dashboard/DashboardSkeleton";
import { colors, fonts, spacing } from "../../theme/tokens";

/**
 * Ports mindful-miya/src/app/dashboard/page.tsx to RN. Data flows through
 * three hooks composed together (per lib/queries/README.md's guidance to
 * compose existing hooks rather than duplicate their fetches):
 * - useProfile: greeting name + the client's coach id (`invited_by`).
 * - useTodayWorkout: today's workout/exercises/log/streak (EXEMPLAR hook,
 *   already the canonical source for this — not re-fetched here).
 * - useDashboard: everything else the old dashboard shows in one batched
 *   query (qk.dashboard) — motivation, goals + today's completions,
 *   yesterday's-feel eligibility, friends summary, photos/measurements.
 */
export default function Dashboard() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const { today: todayStr } = useClientDate();

  const { data: profile, isPending: profilePending, isError: profileError } = useProfile(uid);
  const {
    data: today,
    isPending: todayPending,
    isError: todayError,
  } = useTodayWorkout(uid, todayStr);
  const {
    data: dashboard,
    isPending: dashboardPending,
    isError: dashboardError,
  } = useDashboard(uid, profile?.invited_by, todayStr);

  const toggleGoalLog = useToggleGoalLog();
  const updateNextDayFeel = useUpdateNextDayFeel();

  const isPending = profilePending || todayPending || dashboardPending;
  const isError = profileError || todayError || dashboardError;

  if (isPending) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <DashboardSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (isError || !profile || !today || !dashboard) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Couldn&apos;t load your dashboard. Pull to refresh or try again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const firstName = profile.display_name?.split(" ")[0] ?? "there";
  const workoutDone = today.workout ? today.log?.completed ?? false : false;


  function handleToggleGoal(goal: Goal) {
    if (!uid) return;
    const isLogged = dashboard!.completedGoalIds.includes(goal.id);
    toggleGoalLog.mutate({
      goal: { id: goal.id, text: goal.text },
      clientId: uid,
      date: todayStr,
      isLogged,
    });
  }

  function handleFeel(feel: 1 | 2 | 3 | 4 | 5) {
    if (!uid) return;
    updateNextDayFeel.mutate({ clientId: uid, feel, todayStr });
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <GreetingHeader firstName={firstName} />

        <MotivationCard motivation={dashboard.motivation} />

        <TodayWorkoutCard
          workout={today.workout}
          exerciseCount={today.exercises.length}
          logged={workoutDone}
        />

        {dashboard.showFeelPrompt && (
          <FeelPromptCard onSelect={handleFeel} disabled={updateNextDayFeel.isPending} />
        )}

        <GoalsStreakRow
          goals={dashboard.goals}
          completedGoalIds={dashboard.completedGoalIds}
          onToggleGoal={handleToggleGoal}
          streak={today.streak}
        />

        <FriendsCard friends={dashboard.friends} />

        <ProgressEntryCards photos={dashboard.photos} measurement={dashboard.measurement} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink50,
    textAlign: "center",
  },
});
