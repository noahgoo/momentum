import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import type { WorkoutWeekDay } from "../../lib/queries/useWorkoutWeek";
import type { DayState } from "./dayState";

interface WeekGridProps {
  days: WorkoutWeekDay[];
}

const STATUS_LABEL: Partial<Record<DayState, string>> = {
  done: "✓ Done",
  inProgress: "In progress",
  today: "Today",
  missed: "Missed",
};

function statusColor(state: DayState): string {
  switch (state) {
    case "done":
      return colors.ok;
    case "inProgress":
    case "today":
      return colors.blueDeep;
    case "missed":
      return colors.bad;
    default:
      return colors.ink50;
  }
}

function cardBackground(state: DayState): string {
  switch (state) {
    case "done":
      return colors.okBg;
    case "inProgress":
      return "rgba(168,196,216,0.22)";
    case "missed":
      return colors.badBg;
    default:
      return colors.surface;
  }
}

function cardBorderColor(state: DayState): string {
  switch (state) {
    case "done":
      return colors.okLine;
    case "inProgress":
      return "rgba(122,170,196,0.42)";
    case "missed":
      return colors.badLine;
    case "today":
      return colors.blueDeep;
    default:
      return colors.line;
  }
}

/**
 * Midday, not midnight: parsing "2026-09-18" as UTC midnight renders as the
 * previous day anywhere west of Greenwich. Matches goals.tsx.
 */
function dateLabel(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00`);
  const dayAbbrev = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  return `${dayAbbrev} · ${monthDay}`;
}

/**
 * Single-column, Monday-to-Sunday list — same dated-row-card idiom as
 * workout/history.tsx. Rest and out-of-range days render as a single thin
 * dashed line rather than a full tile, so a mostly-rest week doesn't cost
 * seven tiles of scroll.
 */
export function WeekGrid({ days }: WeekGridProps) {
  return (
    <View style={styles.list}>
      {days.map((day) => {
        const { state } = day;
        const label = dateLabel(day.dateStr);

        if (state === "outOfRange" || state === "rest") {
          return (
            <View
              key={day.dateStr}
              style={[styles.thinRow, state === "outOfRange" ? styles.thinRowFaded : undefined]}
            >
              <Text style={styles.thinDateLabel}>{label}</Text>
              {state === "rest" && <Text style={styles.thinStatus}>Rest</Text>}
            </View>
          );
        }

        const statusLabel = STATUS_LABEL[state];

        return (
          <TouchableOpacity
            key={day.dateStr}
            onPress={() => router.push(`/(tabs)/workout/${day.dateStr}`)}
            style={[
              styles.card,
              {
                backgroundColor: cardBackground(state),
                borderColor: cardBorderColor(state),
                borderWidth: state === "today" ? 1.5 : 1,
              },
            ]}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.dateLabel}>{label}</Text>
              <Text style={styles.workoutName} numberOfLines={1}>
                {day.workout?.name}
              </Text>
            </View>
            <View style={styles.cardRight}>
              {statusLabel && (
                <Text style={[styles.statusLabel, { color: statusColor(state) }]}>{statusLabel}</Text>
              )}
              {day.workout?.estimated_duration_minutes ? (
                <Text style={styles.duration}>{day.workout.estimated_duration_minutes} min</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  cardLeft: {
    flex: 1,
    minWidth: 0,
  },
  cardRight: {
    alignItems: "flex-end",
  },
  dateLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink50,
  },
  workoutName: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.ink,
    marginTop: 2,
  },
  statusLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
  },
  duration: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 2,
  },
  thinRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radii.control,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
  },
  thinRowFaded: {
    opacity: 0.4,
  },
  thinDateLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink50,
  },
  thinStatus: {
    fontFamily: fonts.displayRegular,
    fontSize: 13,
    fontStyle: "italic",
    color: colors.ink50,
  },
});
