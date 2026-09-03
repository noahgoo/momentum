import { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../../lib/auth";
import { useClientDate } from "../../../lib/useClientDate";
import { useWorkoutWeek } from "../../../lib/queries/useWorkoutWeek";
import { ProgressRing } from "../../../components/workout/ProgressRing";
import { WeekGrid } from "../../../components/workout/WeekGrid";
import { colors, fonts, spacing } from "../../../theme/tokens";

/**
 * Workout tab week view. Ported from mindful-miya's
 * src/app/workout/page.tsx: program-name header + progress ring, a
 * horizontal week-pill selector, and a 2-col 7-day grid (rotated to the
 * program's start weekday rather than a fixed Monday start).
 */
export default function WorkoutWeekScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const { today: todayStr } = useClientDate();

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  // First render: we don't know currentWeekNumber yet, so fetch week 1 to
  // discover totalWeeks/currentWeekNumber, then seed the selector from it.
  const bootstrapQuery = useWorkoutWeek(uid, selectedWeek ?? 1, todayStr);
  const effectiveWeek = selectedWeek ?? bootstrapQuery.data?.currentWeekNumber ?? 1;
  const { data, isPending } = useWorkoutWeek(uid, effectiveWeek, todayStr);

  const weekPills = useMemo(
    () => Array.from({ length: data?.totalWeeks ?? 0 }, (_, i) => i + 1),
    [data?.totalWeeks]
  );

  if (isPending || !data) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{isPending ? "Loading…" : "No program yet"}</Text>
          {!isPending && (
            <Text style={styles.emptySubtext}>Ask your coach to assign you a program.</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <ProgressRing percent={data.percentElapsed} />
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>YOUR PROGRAM</Text>
            <Text style={styles.programName} numberOfLines={1}>
              {data.programName}
            </Text>
            <Text style={styles.weekLabel}>
              Week {effectiveWeek} of {data.totalWeeks}
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => router.push("/(tabs)/workout/history")} style={styles.historyLink}>
          <Text style={styles.historyLinkText}>HISTORY →</Text>
        </TouchableOpacity>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
          {weekPills.map((w) => {
            const selected = w === effectiveWeek;
            return (
              <TouchableOpacity
                key={w}
                onPress={() => setSelectedWeek(w)}
                style={[
                  styles.pill,
                  selected ? styles.pillSelected : undefined,
                  w === data.currentWeekNumber && !selected ? styles.pillCurrent : undefined,
                ]}
              >
                <Text style={[styles.pillText, selected ? styles.pillTextSelected : undefined]}>{w}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.weekNavRow}>
          <TouchableOpacity
            onPress={() => setSelectedWeek(Math.max(1, effectiveWeek - 1))}
            disabled={effectiveWeek === 1}
            style={styles.navButton}
          >
            <Text style={[styles.navChevron, effectiveWeek === 1 ? styles.navChevronDisabled : undefined]}>
              ‹
            </Text>
          </TouchableOpacity>
          <View style={styles.weekNavCenter}>
            <Text style={styles.weekNavTitle}>
              {effectiveWeek === data.currentWeekNumber ? "This week" : `Week ${effectiveWeek}`}
            </Text>
            <Text style={styles.weekNavSubtitle}>WEEK {effectiveWeek}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setSelectedWeek(Math.min(data.totalWeeks, effectiveWeek + 1))}
            disabled={effectiveWeek === data.totalWeeks}
            style={styles.navButton}
          >
            <Text
              style={[
                styles.navChevron,
                effectiveWeek === data.totalWeeks ? styles.navChevronDisabled : undefined,
              ]}
            >
              ›
            </Text>
          </TouchableOpacity>
        </View>

        <WeekGrid days={data.days} />
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
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  emptyText: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  emptySubtext: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.ink50,
  },
  programName: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginTop: 2,
  },
  weekLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 2,
  },
  historyLink: {
    alignSelf: "flex-end",
    marginTop: spacing.sm,
  },
  historyLinkText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.blueDeep,
    letterSpacing: 0.6,
  },
  pillRow: {
    marginTop: spacing.lg,
  },
  pill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.xs,
    backgroundColor: colors.creamDeep,
  },
  pillSelected: {
    backgroundColor: colors.ink,
  },
  pillCurrent: {
    borderWidth: 1.5,
    borderColor: colors.blueDeep,
  },
  pillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.ink70,
  },
  pillTextSelected: {
    color: "#fff",
  },
  weekNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  navButton: {
    padding: spacing.sm,
  },
  navChevron: {
    fontSize: 22,
    lineHeight: 22,
    color: colors.ink,
  },
  navChevronDisabled: {
    color: colors.ink30,
  },
  weekNavCenter: {
    alignItems: "center",
  },
  weekNavTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
  },
  weekNavSubtitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.ink50,
    marginTop: 2,
  },
});
