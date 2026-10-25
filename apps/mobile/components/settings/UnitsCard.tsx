import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DistanceUnit, Profile, WeightUnit } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useUpdateProfileSettings } from "../../lib/queries/useUpdateProfileSettings";
import { SettingsCard } from "./SettingsCard";

const WEIGHT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: "lbs", label: "lb" },
  { value: "kg", label: "kg" },
];
const DISTANCE_OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: "mi", label: "mi" },
  { value: "km", label: "km" },
];

interface UnitsCardProps {
  profile: Profile;
}

/**
 * Preferred weight and distance units (autosave on select). These only seed
 * what a client types when a set has no prescribed unit; a coach's prescription
 * keeps its own unit, and nothing already logged is ever converted (P6).
 */
export function UnitsCard({ profile }: UnitsCardProps) {
  const updateSettings = useUpdateProfileSettings();

  return (
    <SettingsCard label="Units">
      <Segmented
        label="Weight"
        options={WEIGHT_OPTIONS}
        value={profile.weight_unit}
        onChange={(weight_unit) => {
          if (weight_unit !== profile.weight_unit) {
            updateSettings.mutate({ uid: profile.id, patch: { weight_unit } });
          }
        }}
      />
      <View style={styles.gap} />
      <Segmented
        label="Distance"
        options={DISTANCE_OPTIONS}
        value={profile.distance_unit}
        onChange={(distance_unit) => {
          if (distance_unit !== profile.distance_unit) {
            updateSettings.mutate({ uid: profile.id, patch: { distance_unit } });
          }
        }}
      />
      <Text style={styles.hint}>Your coach&apos;s prescribed units always show as written.</Text>
    </SettingsCard>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: value === o.value }}
            style={[styles.segment, value === o.value && styles.segmentActive]}
          >
            <Text style={styles.segmentText}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  gap: {
    height: spacing.md,
  },
  segmented: {
    flexDirection: "row",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    overflow: "hidden",
  },
  segment: {
    height: 40,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: colors.blue,
  },
  segmentText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
