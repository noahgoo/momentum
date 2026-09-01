import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface FeelPromptCardProps {
  onSelect: (feel: 1 | 2 | 3 | 4 | 5) => void;
  disabled?: boolean;
}

const FEEL_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * Ports the old dashboard's yesterday's-feel prompt: 1-5 circular buttons
 * labeled "Wrecked" -> "Great". Only rendered by the parent when
 * `showFeelPrompt` is true; disappears optimistically on tap (parent owns
 * that state via useUpdateNextDayFeel's onMutate).
 */
export function FeelPromptCard({ onSelect, disabled }: FeelPromptCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>HOW DO YOU FEEL AFTER YESTERDAY&apos;S WORKOUT?</Text>
      <View style={styles.row}>
        {FEEL_VALUES.map((n) => (
          <TouchableOpacity
            key={n}
            style={styles.circle}
            onPress={() => onSelect(n)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Feel rating ${n}`}
          >
            <Text style={styles.circleText}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>Wrecked</Text>
        <Text style={styles.caption}>Great</Text>
      </View>
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
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  circleText: {
    fontFamily: fonts.displayRegular,
    fontSize: 17,
    color: colors.ink,
  },
  captionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  caption: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.ink30,
    letterSpacing: 0.4,
  },
});
