import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import type { Workout } from "@momentum/shared";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface TodayWorkoutCardProps {
  workout: Workout | null;
  exerciseCount: number;
  /** True when today's workout_logs row has completed = true. */
  logged: boolean;
}

/**
 * Ports the old dashboard's today's-workout card. This is a summary +
 * link only — the actual set logger is 8.2's job (NON-GOAL here). Tapping
 * the button navigates to the workout tab, which resolves today's day view
 * itself.
 */
export function TodayWorkoutCard({ workout, exerciseCount, logged }: TodayWorkoutCardProps) {
  const router = useRouter();

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>TODAY&apos;S WORKOUT</Text>
        {logged && <Text style={styles.loggedBadge}>✓ LOGGED</Text>}
      </View>

      {workout ? (
        <>
          <Text style={styles.workoutName}>{workout.name}</Text>
          <Text style={styles.workoutMeta}>
            {workout.estimated_duration_minutes != null
              ? `${workout.estimated_duration_minutes} min · `
              : ""}
            {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.push("/(tabs)/workout")}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{logged ? "Review workout" : "Start workout"}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.restBlock}>
          <Text style={styles.restTitle}>Rest day</Text>
          <Text style={styles.restSubtitle}>Check in with your coach →</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    ...shadows.card,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  loggedBadge: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ok,
    letterSpacing: 0.8,
  },
  workoutName: {
    fontFamily: fonts.displayRegular,
    fontSize: 26,
    color: colors.ink,
    marginTop: 10,
    lineHeight: 29,
  },
  workoutMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    marginTop: 8,
  },
  button: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.ink,
  },
  restBlock: {
    marginTop: 14,
  },
  restTitle: {
    fontFamily: fonts.displayRegular,
    fontSize: 26,
    color: colors.ink,
  },
  restSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    marginTop: 6,
  },
});
