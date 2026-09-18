import { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { parseSetConfig, type WorkoutDifficulty } from "@momentum/shared";
import { useAuth } from "../../../lib/auth";
import { useWorkoutHistory } from "../../../lib/queries/useWorkoutHistory";
import { DIFFICULTY_LABELS } from "../../../components/workout/DifficultyPicker";
import { computePace, formatDuration, formatMiles, formatPace, formatTargetReps, formatTargetWeight } from "../../../components/workout/format";
import { colors, fonts, radii, spacing, shadows } from "../../../theme/tokens";

const COLLAPSED_COUNT = 15;

const DIFFICULTY_COLORS: Record<WorkoutDifficulty, string> = {
  too_easy: colors.blueDeep,
  challenging: colors.ok,
  overly_challenging: colors.bad,
};

function formatLogDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Workout history: completed logs, most recent first, collapsed to 15 with
 * a "Show all" expander, and an expandable per-entry exercise/set table.
 * Ported from mindful-miya's src/app/workout/history/page.tsx.
 */
export default function WorkoutHistoryScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const { data, isPending } = useWorkoutHistory(uid);

  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const logs = data?.logs ?? [];
  const visible = showAll ? logs : logs.slice(0, COLLAPSED_COUNT);

  // Pop rather than push: pushing the parent route again animates
  // FORWARD on what reads as a back gesture, and grows the stack every
  // time. canGoBack guards a cold start straight onto this route.
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/workout");
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={goBack} style={styles.backRow}>
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Program</Text>
        </TouchableOpacity>

        <Text style={styles.eyebrow}>WORKOUT HISTORY</Text>
        <Text style={styles.title}>Your History</Text>
        {!isPending && (
          <Text style={styles.subtitle}>
            {logs.length} completed workout{logs.length !== 1 ? "s" : ""}
          </Text>
        )}

        {!isPending && logs.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyBadge}>
              <Text style={styles.emptyBadgeText}>✦</Text>
            </View>
            <Text style={styles.emptyTitle}>No workouts logged yet</Text>
            <Text style={styles.emptySubtitle}>Complete a workout to see it here</Text>
          </View>
        )}

        <View style={styles.list}>
          {visible.map((log) => {
            const workout = log.workout_id ? data?.workoutsById.get(log.workout_id) : undefined;
            const open = openId === log.id;
            return (
              <View key={log.id} style={[styles.entryCard, shadows.cardSubtle]}>
                <TouchableOpacity onPress={() => setOpenId(open ? null : log.id)} style={styles.entryHeaderRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.entryDate}>{formatLogDate(log.date).toUpperCase()}</Text>
                    <Text style={styles.entryName}>{workout?.name ?? "Workout"}</Text>
                    {workout?.estimated_duration_minutes ? (
                      <Text style={styles.entryDuration}>{workout.estimated_duration_minutes} min</Text>
                    ) : null}
                  </View>
                  <View style={styles.entryBadges}>
                    {log.warmup_completed && (
                      <View style={[styles.badge, { backgroundColor: colors.okBg }]}>
                        <Text style={[styles.badgeText, { color: colors.ok }]}>warm-up ✓</Text>
                      </View>
                    )}
                    {log.difficulty && (
                      <View style={[styles.badge, { backgroundColor: colors.cream }]}>
                        <Text style={[styles.badgeText, { color: DIFFICULTY_COLORS[log.difficulty] }]}>
                          {DIFFICULTY_LABELS[log.difficulty]}
                        </Text>
                      </View>
                    )}
                    <ChevronRight
                      color={colors.ink50}
                      size={16}
                      style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
                    />
                  </View>
                </TouchableOpacity>

                {open && (
                  <View style={styles.breakdown}>
                    {log.exercise_logs.map((ex) => (
                      <View key={ex.id} style={styles.exerciseSection}>
                        <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
                        <View style={styles.setsHeaderRow}>
                          <Text style={styles.setsHeaderCell}>SET</Text>
                          <Text style={styles.setsHeaderCell}>{ex.mode === "distance" ? "DIST" : "TARGET"}</Text>
                          <Text style={styles.setsHeaderCell}>{ex.mode === "distance" ? "TIME" : "ACTUAL"}</Text>
                          <Text style={styles.setsHeaderCell}>
                            {ex.mode === "time" ? "TIME" : ex.mode === "distance" ? "PACE" : "REPS"}
                          </Text>
                        </View>
                        {ex.set_logs.map((set) => {
                          const pace =
                            ex.mode === "distance" ? computePace(set.actual_miles, set.actual_seconds) : undefined;
                          // The target this set was logged against, snapshotted
                          // on the row itself — never re-read from the live
                          // workout, which the coach may have edited since.
                          const targetCfg = parseSetConfig(set.prescribed);
                          return (
                            <View key={set.id} style={styles.setRow}>
                              <Text style={styles.setCell}>{set.set_number}</Text>
                              <Text style={styles.setCell}>
                                {ex.mode === "distance" ? formatMiles(set.actual_miles) : formatTargetWeight(targetCfg)}
                              </Text>
                              <Text style={styles.setCell}>
                                {ex.mode === "distance"
                                  ? formatDuration(set.actual_seconds)
                                  : set.weight != null
                                    ? `${set.weight}${set.weight_unit === "kg" ? " kg" : ""}`
                                    : "—"}
                              </Text>
                              <Text style={styles.setCell}>
                                {ex.mode === "time"
                                  ? formatDuration(set.target_seconds)
                                  : ex.mode === "distance"
                                    ? pace != null
                                      ? `${formatPace(pace)}/mi`
                                      : "—"
                                    : // "/side" qualifies what the rep count
                                      // MEANS, so it belongs on the logged
                                      // number too — taken from the snapshot,
                                      // never the live workout.
                                      formatTargetReps({
                                        reps: set.reps ?? undefined,
                                        perSide: targetCfg.perSide,
                                      })}
                              </Text>
                              <Text style={{ color: set.completed ? colors.ok : colors.ink30, fontSize: 12 }}>
                                {set.completed ? "✓" : "✗"}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {logs.length > COLLAPSED_COUNT && (
          <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={styles.showAllButton}>
            <Text style={styles.showAllButtonText}>{showAll ? "Show fewer" : `Show all ${logs.length}`}</Text>
          </TouchableOpacity>
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
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  backText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.ink50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontStyle: "italic",
    color: colors.ink,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: 48,
  },
  emptyBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBadgeText: {
    fontSize: 30,
    color: colors.ink,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontStyle: "italic",
    color: colors.ink,
  },
  emptySubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    maxWidth: 240,
    lineHeight: 20,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  entryCard: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  entryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  entryDate: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink50,
  },
  entryName: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
    marginTop: 2,
  },
  entryDuration: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 2,
  },
  entryBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  badgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
  },
  breakdown: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
    padding: spacing.lg,
    gap: spacing.md,
  },
  exerciseSection: {
    gap: 4,
  },
  exerciseName: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
    marginBottom: 4,
  },
  setsHeaderRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: 4,
  },
  setsHeaderCell: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.ink50,
    flex: 1,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  setCell: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
    flex: 1,
  },
  showAllButton: {
    alignSelf: "center",
    marginTop: spacing.md,
  },
  showAllButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.blueDeep,
  },
});
