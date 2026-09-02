import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../../theme/tokens";
import { SettingsCard } from "./SettingsCard";

interface TimezoneRowProps {
  timezone: string | null;
}

/**
 * Read-only display of the device-synced `profiles.timezone` (lib/timezone.ts
 * upserts it on auth/foreground). No manual picker anywhere in this UI —
 * plan decision: device timezone is the sole source of truth.
 */
export function TimezoneRow({ timezone }: TimezoneRowProps) {
  return (
    <SettingsCard label="Timezone">
      <View style={styles.row}>
        <Text style={styles.value}>{timezone ?? "Syncing…"}</Text>
      </View>
      <Text style={styles.hint}>Detected automatically from your device.</Text>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  value: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
});
