import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { colors, fonts, spacing } from "../../theme/tokens";
import type { WorkoutWeekDay } from "../../lib/queries/useWorkoutWeek";
import type { DayState } from "./dayState";

interface WeekGridProps {
  days: WorkoutWeekDay[];
}

const STATUS_LABEL: Partial<Record<DayState, string>> = {
  done: "✓ DONE",
  inProgress: "IN PROGRESS",
  today: "TODAY",
  missed: "MISSED",
};

function statusColor(state: DayState): string {
  switch (state) {
    case "done":
      return colors.ok;
    case "inProgress":
      return colors.blueDeep;
    case "today":
      return colors.blue;
    case "missed":
      return colors.bad;
    default:
      return colors.ink50;
  }
}

function cellBackground(state: DayState): string {
  switch (state) {
    case "done":
      return colors.okBg;
    case "inProgress":
      return "rgba(168,196,216,0.22)";
    case "missed":
      return colors.badBg;
    case "today":
    case "future":
      return colors.ink;
    default:
      return colors.surface;
  }
}

function cellBorderColor(state: DayState): string {
  switch (state) {
    case "done":
      return colors.okLine;
    case "inProgress":
      return "rgba(122,170,196,0.42)";
    case "missed":
      return colors.badLine;
    case "today":
    case "future":
      return colors.ink;
    default:
      return colors.line;
  }
}

function dateLabel(date: Date): string {
  const dayAbbrev = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  return `${dayAbbrev} · ${monthDay}`;
}

/**
 * 2-column, 7-row day grid (rotated so the program's start weekday leads).
 * Ported from mindful-miya's workout page grid — same status-badge/color
 * scheme, dark cells for today/future.
 */
export function WeekGrid({ days }: WeekGridProps) {
  return (
    <View style={styles.grid}>
      {days.map((day) => {
        const { state } = day;
        const dark = state === "today" || state === "future";
        const label = dateLabel(day.date);

        if (state === "outOfRange") {
          return (
            <View key={day.dateStr} style={[styles.cell, styles.outOfRangeCell]}>
              <Text style={styles.outOfRangeLabel}>{label}</Text>
            </View>
          );
        }

        if (state === "rest") {
          return (
            <View key={day.dateStr} style={[styles.cell, styles.restCell]}>
              <Text style={styles.restDateLabel}>{label}</Text>
              <Text style={styles.restText}>Rest</Text>
            </View>
          );
        }

        const statusLabel = STATUS_LABEL[state];

        return (
          <TouchableOpacity
            key={day.dateStr}
            onPress={() => router.push(`/(tabs)/workout/${day.dateStr}`)}
            style={[
              styles.cell,
              {
                backgroundColor: cellBackground(state),
                borderColor: cellBorderColor(state),
                borderWidth: dark ? 1.5 : 1,
              },
            ]}
          >
            <View style={styles.cellTopRow}>
              <Text style={[styles.dateLabel, { color: dark ? "rgba(242,237,232,0.6)" : colors.ink50 }]}>
                {label}
              </Text>
              {statusLabel && (
                <Text style={[styles.statusLabel, { color: statusColor(state) }]}>{statusLabel}</Text>
              )}
            </View>
            <View>
              <Text style={[styles.workoutName, { color: dark ? colors.cream : colors.ink }]} numberOfLines={1}>
                {day.workout?.name}
              </Text>
              {day.workout?.estimated_duration_minutes ? (
                <Text
                  style={[
                    styles.workoutDuration,
                    { color: dark ? "rgba(242,237,232,0.6)" : colors.ink50 },
                  ]}
                >
                  {day.workout.estimated_duration_minutes} min
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cell: {
    width: "47%",
    minHeight: 80,
    borderRadius: 16,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  cellTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  dateLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
  },
  statusLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 1,
  },
  workoutName: {
    fontFamily: fonts.display,
    fontSize: 13,
  },
  workoutDuration: {
    fontFamily: fonts.body,
    fontSize: 10,
    marginTop: 4,
  },
  restCell: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line2,
  },
  restDateLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink50,
  },
  restText: {
    fontFamily: fonts.displayRegular,
    fontSize: 13,
    color: colors.ink50,
    fontStyle: "italic",
  },
  outOfRangeCell: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.line,
    opacity: 0.35,
  },
  outOfRangeLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.ink30,
  },
});
