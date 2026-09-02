import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface SettingsCardProps extends PropsWithChildren {
  label: string;
}

/** Shared card chrome (label + surface) for every settings section. */
export function SettingsCard({ label, children }: SettingsCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadows.cardSubtle,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
    marginBottom: spacing.lg,
    textTransform: "uppercase",
  },
});
