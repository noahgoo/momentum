import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Check } from "lucide-react-native";
import type { Goal } from "@momentum/shared";
import { colors, fonts, italicOverhang, radii, shadows, spacing } from "../../theme/tokens";

interface GoalsStreakRowProps {
  goals: Goal[];
  completedGoalIds: string[];
  onToggleGoal: (goal: Goal) => void;
  streak: number;
}

/** Ports the old dashboard's goals-checklist + streak-numeral two-card row. */
export function GoalsStreakRow({
  goals,
  completedGoalIds,
  onToggleGoal,
  streak,
}: GoalsStreakRowProps) {
  const completedCount = goals.filter((goal) => completedGoalIds.includes(goal.id)).length;

  return (
    <View style={styles.row}>
      <View style={[styles.card, styles.goalsCard]}>
        <View style={styles.goalsHeader}>
          <Text style={styles.label}>GOALS</Text>
          {goals.length > 0 && (
            <Text style={styles.goalsCount}>
              {completedCount}/{goals.length}
            </Text>
          )}
        </View>

        {goals.length === 0 ? (
          <Text style={styles.emptyText}>No goals set</Text>
        ) : (
          <View style={styles.goalsList}>
            {goals.map((goal) => {
              const done = completedGoalIds.includes(goal.id);
              return (
                <TouchableOpacity
                  key={goal.id}
                  style={styles.goalRow}
                  onPress={() => onToggleGoal(goal)}
                  accessibilityRole="button"
                >
                  <View style={[styles.checkbox, done && styles.checkboxDone]}>
                    {done && <Check size={12} color={colors.surface} strokeWidth={3} />}
                  </View>
                  <Text
                    style={[styles.goalText, done && styles.goalTextDone]}
                    numberOfLines={2}
                  >
                    {goal.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <View style={[styles.card, styles.streakCard]}>
        <Text style={styles.label}>STREAK</Text>
        <View style={styles.streakBody}>
          {/* adjustsFontSizeToFit so a 3-digit streak shrinks to fit the
              fixed-width card instead of overflowing it. */}
          <Text style={styles.streakNumber} numberOfLines={1} adjustsFontSizeToFit>
            {streak}
          </Text>
          <Text style={styles.streakUnit}>days</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "stretch",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  goalsCard: {
    flex: 1,
    minWidth: 0,
  },
  goalsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  goalsCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.blueDeep,
    letterSpacing: 0.6,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink30,
    marginTop: spacing.md,
  },
  goalsList: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDone: {
    borderColor: colors.blueDeep,
    backgroundColor: colors.blueDeep,
  },
  goalText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 17,
  },
  goalTextDone: {
    color: colors.ink50,
    textDecorationLine: "line-through",
  },
  streakCard: {
    width: 130,
    alignItems: "center",
  },
  streakBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.sm,
    gap: 2,
  },
  streakNumber: {
    fontFamily: fonts.displayRegular,
    fontSize: 60,
    lineHeight: 62,
    color: colors.ink,
    // No negative letterSpacing here: RN applies it after the final glyph as
    // well, which shrinks the measured box and clips this italic face.
    paddingRight: italicOverhang(60),
  },
  streakUnit: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    letterSpacing: 0.4,
  },
});
