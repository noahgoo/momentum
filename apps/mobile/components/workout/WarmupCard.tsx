import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ChevronDown, Check } from "lucide-react-native";
import { parseSetConfig, type Workout } from "@momentum/shared";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";
import { formatPrescription } from "./format";
import type { WorkoutExerciseWithName } from "../../lib/queries/useWorkoutDay";

interface WarmupCardProps {
  warmup: Workout;
  exercises: WorkoutExerciseWithName[];
  completed: boolean;
  /** Disabled on future dates — nothing is loggable yet. */
  readOnly?: boolean;
  onToggle: (completed: boolean) => void;
}

/**
 * Collapsible warm-up card shown above the workout logger. Ported from
 * mindful-miya/src/components/client/WarmupCard.tsx. Deliberately separate
 * from the logger's set count — finishing the warmup is tracked
 * independently (workout_logs.warmup_completed) and never gates completing
 * the workout itself (plan finding #5).
 */
export function WarmupCard({ warmup, exercises, completed, readOnly = false, onToggle }: WarmupCardProps) {
  const [open, setOpen] = useState(false);

  const totalMinutes = warmup.estimated_duration_minutes ?? 0;

  return (
    <View style={[styles.card, shadows.cardSubtle]}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => !readOnly && onToggle(!completed)}
          disabled={readOnly}
          accessibilityLabel={`${completed ? "Clear" : "Complete"} warm-up`}
          style={[
            styles.checkbox,
            {
              backgroundColor: completed ? colors.ok : colors.paper,
              borderColor: completed ? colors.ok : colors.line2,
              opacity: readOnly ? 0.5 : 1,
            },
          ]}
        >
          {completed && <Check color="#fff" size={14} strokeWidth={3} />}
        </TouchableOpacity>

        <TouchableOpacity style={styles.titleColumn} onPress={() => setOpen((v) => !v)}>
          <Text style={styles.eyebrow}>WARM-UP</Text>
          <Text style={styles.title}>{warmup.name}</Text>
          <Text style={styles.subtitle}>
            {exercises.length} movement{exercises.length !== 1 ? "s" : ""}
            {totalMinutes > 0 ? ` · ~${totalMinutes} min` : ""}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setOpen((v) => !v)}
          accessibilityLabel={open ? "Hide warm-up movements" : "Show warm-up movements"}
          style={styles.chevronButton}
        >
          <ChevronDown
            color={colors.ink50}
            size={16}
            style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
          />
        </TouchableOpacity>
      </View>

      {open && (
        <View style={styles.movementList}>
          {exercises.map((ex, i) => {
            const configs = Array.isArray(ex.set_configs) ? ex.set_configs : [];
            const setCount = configs.length || 1;
            const firstConfig = configs.length > 0 ? parseSetConfig(configs[0]) : undefined;
            const prescription = formatPrescription(ex.mode, firstConfig);

            return (
              <View
                key={ex.id}
                style={[styles.movementRow, i > 0 ? styles.movementRowBorder : undefined]}
              >
                <Text style={styles.movementName} numberOfLines={2}>
                  {ex.exercises?.name ?? ex.notes ?? "Exercise"}
                </Text>
                <Text style={styles.movementPrescription}>
                  {setCount > 1 ? `${setCount} × ${prescription}` : prescription}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    marginTop: spacing.lg,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  checkbox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.ink50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
    marginTop: 2,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 2,
  },
  chevronButton: {
    padding: spacing.xs,
  },
  movementList: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  movementRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 7,
  },
  movementRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  movementName: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink70,
    flex: 1,
  },
  movementPrescription: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
  },
});
