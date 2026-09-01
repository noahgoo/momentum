import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { WorkoutDifficulty } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";

export const DIFFICULTY_LABELS: Record<WorkoutDifficulty, string> = {
  too_easy: "Too easy",
  challenging: "Just right",
  overly_challenging: "Too challenging",
};

const DIFFICULTY_ORDER: WorkoutDifficulty[] = ["too_easy", "challenging", "overly_challenging"];

interface DifficultyPickerProps {
  value: WorkoutDifficulty | null;
  onChange: (value: WorkoutDifficulty) => void;
}

/** 3-option difficulty picker shown on the completed-state hero card. */
export function DifficultyPicker({ value, onChange }: DifficultyPickerProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>HOW DID IT FEEL?</Text>
      <View style={styles.options}>
        {DIFFICULTY_ORDER.map((option) => {
          const selected = value === option;
          return (
            <TouchableOpacity
              key={option}
              onPress={() => onChange(option)}
              style={[styles.option, selected ? styles.optionSelected : undefined]}
            >
              <Text style={[styles.optionText, selected ? styles.optionTextSelected : undefined]}>
                {DIFFICULTY_LABELS[option]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value === null && <Text style={styles.hint}>Optional — tap to tell your coach</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    marginTop: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
  },
  options: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  option: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  optionSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  optionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink70,
  },
  optionTextSelected: {
    fontFamily: fonts.bodySemiBold,
    color: "#fff",
  },
  hint: {
    fontFamily: fonts.displayRegular,
    fontSize: 11,
    color: colors.ink50,
    marginTop: spacing.md,
    textAlign: "center",
    fontStyle: "italic",
  },
});
