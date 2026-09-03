import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Check } from "lucide-react-native";
import { type WorkoutDifficulty } from "@momentum/shared";
import { useAuth } from "../../../lib/auth";
import { useClientDate } from "../../../lib/useClientDate";
import { useWorkoutDay } from "../../../lib/queries/useWorkoutDay";
import { usePendingChangeRequest } from "../../../lib/queries/useChangeRequest";
import { useWarmupToggle } from "../../../lib/queries/useWarmupToggle";
import { useSetWorkoutDifficulty } from "../../../lib/queries/useSetWorkoutDifficulty";
import { WarmupCard } from "../../../components/workout/WarmupCard";
import { WorkoutLogger } from "../../../components/workout/WorkoutLogger";
import { MoveWorkoutCard } from "../../../components/workout/MoveWorkoutCard";
import { DifficultyPicker } from "../../../components/workout/DifficultyPicker";
import { colors, fonts, radii, spacing, shadows } from "../../../theme/tokens";

function parseDateParam(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatHeader(value: string): string {
  return parseDateParam(value)
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    .toUpperCase();
}

export default function WorkoutDayScreen() {
  const { date: dateParam } = useLocalSearchParams<{ date: string }>();
  const { session, profile } = useAuth();
  const uid = session?.user.id;

  const { today: todayStr } = useClientDate();
  const isToday = dateParam === todayStr;
  const isFuture = Boolean(dateParam) && dateParam > todayStr;

  const { data, isPending } = useWorkoutDay(uid, dateParam);
  const { data: pendingRequest } = usePendingChangeRequest(uid);
  const warmupToggle = useWarmupToggle();
  const setDifficulty = useSetWorkoutDifficulty();

  const [viewingCompletedLog, setViewingCompletedLog] = useState(false);

  useEffect(() => {
    setViewingCompletedLog(false);
  }, [dateParam]);

  if (isPending || !uid || !dateParam || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingState} />
      </SafeAreaView>
    );
  }

  const workout = data.workout;
  const log = data.log;
  const completed = log?.completed ?? false;

  function handleWarmupToggle(next: boolean) {
    if (!uid || !dateParam || !workout) return;
    warmupToggle.mutate({ clientId: uid, date: dateParam, workoutId: workout.id, completed: next });
  }

  function handleDifficultyChange(value: WorkoutDifficulty) {
    if (!uid || !dateParam) return;
    setDifficulty.mutate({ clientId: uid, date: dateParam, difficulty: value });
  }

  const BackHeader = (
    <View style={styles.backRow}>
      <TouchableOpacity onPress={() => router.push("/(tabs)/workout")} style={styles.backButton}>
        <ChevronLeft color={colors.ink} size={20} />
      </TouchableOpacity>
      <Text style={styles.backLabel}>Program</Text>
    </View>
  );

  if (!workout) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          {BackHeader}
          <Text style={styles.eyebrow}>{formatHeader(dateParam)}</Text>
          <View style={[styles.card, shadows.cardSubtle, styles.restDayCard]}>
            <Text style={styles.restDayText}>Rest day — take it easy</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (completed && !viewingCompletedLog) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          {BackHeader}
          <View style={styles.doneHero}>
            <Check color={colors.cream} size={28} strokeWidth={2.5} />
            <Text style={styles.doneTitle}>Done ✓</Text>
            <Text style={styles.doneSubtitle}>{workout.name} completed</Text>
          </View>

          <DifficultyPicker value={log?.difficulty ?? null} onChange={handleDifficultyChange} />

          <TouchableOpacity onPress={() => setViewingCompletedLog(true)} style={styles.viewEditLink}>
            <Text style={styles.viewEditLinkText}>View / edit log</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {BackHeader}

        <View style={[styles.headerCard]}>
          <Text style={styles.headerEyebrow}>
            {isToday ? "TODAY" : formatHeader(dateParam)}
            {workout.estimated_duration_minutes ? ` · ${workout.estimated_duration_minutes} MIN` : ""}
          </Text>
          <Text style={styles.headerTitle}>{workout.name}</Text>
          <View style={styles.headerMetaRow}>
            <Text style={styles.headerMeta}>
              {data.exercises.length} exercise{data.exercises.length !== 1 ? "s" : ""}
            </Text>
            {workout.estimated_duration_minutes ? (
              <>
                <Text style={styles.headerMeta}>·</Text>
                <Text style={styles.headerMeta}>{workout.estimated_duration_minutes} min</Text>
              </>
            ) : null}
          </View>
        </View>

        {workout.equipment && workout.equipment.length > 0 && (
          <View style={styles.equipmentRow}>
            {workout.equipment.map((item) => (
              <View key={item} style={styles.equipmentPill}>
                <Text style={styles.equipmentPillText}>{item}</Text>
              </View>
            ))}
          </View>
        )}

        {isFuture && (
          <View style={styles.futureNotice}>
            <Text style={styles.futureNoticeText}>
              Scheduled for{" "}
              {parseDateParam(dateParam).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              . Come back on the day to log it.
            </Text>
          </View>
        )}

        {data.warmup && (
          <WarmupCard
            warmup={data.warmup}
            exercises={data.warmupExercises}
            completed={log?.warmup_completed ?? false}
            readOnly={isFuture}
            onToggle={handleWarmupToggle}
          />
        )}

        {!isFuture && uid && (
          <View style={styles.loggerSpacing}>
            <WorkoutLogger
              clientId={uid}
              date={dateParam}
              workoutId={workout.id}
              exercises={data.exercises}
              existingLog={log?.exercise_logs}
              previousLog={data.previousLog?.exercise_logs}
              warmupCompleted={data.warmup ? (log?.warmup_completed ?? false) : undefined}
              onComplete={() => setViewingCompletedLog(false)}
            />
          </View>
        )}

        {(isToday || isFuture) && uid && profile?.invited_by && (
          <MoveWorkoutCard
            clientId={uid}
            coachId={profile.invited_by}
            fromDate={dateParam}
            workoutId={workout.id}
            minDate={todayStr}
            maxDate={data.programEndDate}
            pendingRequest={pendingRequest}
          />
        )}
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
    padding: spacing.xl,
    paddingBottom: spacing.xxl * 2,
  },
  loadingState: {
    flex: 1,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.ink08,
    alignItems: "center",
    justifyContent: "center",
  },
  backLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink70,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.ink50,
  },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    marginTop: spacing.lg,
  },
  restDayCard: {
    alignItems: "center",
  },
  restDayText: {
    fontFamily: fonts.displayRegular,
    fontSize: 13,
    color: colors.ink50,
    fontStyle: "italic",
  },
  headerCard: {
    backgroundColor: colors.ink,
    borderRadius: 20,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  headerEyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: "rgba(246,244,240,0.55)",
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.cream,
    marginTop: 4,
  },
  headerMetaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headerMeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: "rgba(246,244,240,0.65)",
  },
  equipmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  equipmentPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  equipmentPillText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink70,
  },
  futureNotice: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    borderRadius: 14,
  },
  futureNoticeText: {
    fontFamily: fonts.displayRegular,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    fontStyle: "italic",
  },
  loggerSpacing: {
    marginTop: spacing.lg,
  },
  doneHero: {
    backgroundColor: colors.ink,
    borderRadius: 20,
    padding: spacing.xl,
    alignItems: "center",
  },
  doneTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.cream,
    marginTop: spacing.sm,
  },
  doneSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(246,244,240,0.65)",
    marginTop: 4,
  },
  viewEditLink: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  viewEditLinkText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    textDecorationLine: "underline",
  },
});
