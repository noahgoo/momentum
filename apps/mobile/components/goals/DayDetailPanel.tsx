import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Goal, GoalLog } from "@momentum/shared";
import { colors, fonts, spacing } from "../../theme/tokens";
import { goalExistsOnDay, goalsForDate } from "../../lib/goalHistory";

interface DayDetailPanelProps {
  date: string; // YYYY-MM-DD
  dateLabel: string;
  allGoals: Goal[];
  weekLogs: GoalLog[];
  onClose: () => void;
  onTogglePastDay: (goal: Goal) => void;
}

function DayDetailRow({
  completed,
  archived,
  text,
  tappable,
  onToggle,
}: {
  completed: boolean;
  archived: boolean;
  text: string;
  tappable: boolean;
  onToggle: () => void;
}) {
  const content = (
    <>
      <Text style={[styles.mark, completed ? styles.markDone : styles.markUndone]}>
        {completed ? "✓" : "✗"}
      </Text>
      <View style={styles.textCol}>
        <Text style={[styles.rowText, !completed && styles.rowTextMuted]}>{text}</Text>
        {archived && <Text style={styles.archivedTag}>archived</Text>}
      </View>
    </>
  );

  if (!tappable) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable style={styles.row} onPress={onToggle}>
      {content}
    </Pressable>
  );
}

/**
 * Detail panel shown under the week chart when a day is tapped: lists each
 * goal's completion state on that date. Includes goals archived since (via
 * `goalsForDate`'s log-union fallback — a goal that no longer exists today
 * still shows here if it was logged done on that day), per plan finding #6.
 */
export function DayDetailPanel({
  date,
  dateLabel,
  allGoals,
  weekLogs,
  onClose,
  onTogglePastDay,
}: DayDetailPanelProps) {
  const dayLogs = weekLogs.filter((l) => l.date === date);
  const loggedGoalIds = new Set(dayLogs.map((l) => l.goal_id));
  const goalsForDay = goalsForDate(allGoals, date, loggedGoalIds);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{dateLabel}</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.closeButton}>×</Text>
        </Pressable>
      </View>

      {goalsForDay.length === 0 ? (
        <Text style={styles.empty}>No goals on this day</Text>
      ) : (
        goalsForDay.map((goal) => {
          const completed = loggedGoalIds.has(goal.id);
          const archived = goal.active === false;
          const log = dayLogs.find((l) => l.goal_id === goal.id);
          const displayText = completed ? log?.goal_text ?? goal.text : goal.text;
          const tappable = goalExistsOnDay(goal, date);

          return (
            <DayDetailRow
              key={goal.id}
              completed={completed}
              archived={archived}
              text={displayText}
              tappable={tappable}
              onToggle={() => onTogglePastDay(goal)}
            />
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm + 2,
  },
  headerLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  closeButton: {
    color: colors.ink50,
    fontSize: 18,
    lineHeight: 18,
    paddingHorizontal: 2,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink30,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "baseline",
    paddingVertical: 3,
  },
  mark: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    width: 12,
  },
  markDone: {
    color: colors.blueDeep,
  },
  markUndone: {
    color: colors.ink30,
  },
  textCol: {
    flex: 1,
  },
  rowText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink,
  },
  rowTextMuted: {
    color: colors.ink30,
  },
  archivedTag: {
    fontFamily: fonts.body,
    fontStyle: "italic",
    fontSize: 10,
    color: colors.ink30,
    marginTop: 1,
  },
});
