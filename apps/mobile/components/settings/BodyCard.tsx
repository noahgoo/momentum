import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Database, Profile } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useUpdateProfileSettings } from "../../lib/queries/useUpdateProfileSettings";
import { SavedLabel } from "./SavedLabel";
import { SettingsCard } from "./SettingsCard";

type Sex = Database["public"]["Enums"]["sex"];

// Matches profileSettingsUpdateSchema (heightIn: min(20).max(96)) in
// packages/shared/src/schemas.ts.
const MIN_HEIGHT_IN = 20;
const MAX_HEIGHT_IN = 96;
const SAVED_FLASH_MS = 2000;
const SEX_OPTIONS: Sex[] = ["male", "female"];

interface BodyCardProps {
  profile: Profile;
}

/**
 * Height (ft/in, combined to height_in on blur) + sex segmented control
 * (autosave on select). Feeds the Navy body-fat % formula (plan finding
 * #10) — female requires hips, but that's collected in the Progress
 * measurements flow, not here.
 */
export function BodyCard({ profile }: BodyCardProps) {
  const updateSettings = useUpdateProfileSettings();
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [heightSaved, setHeightSaved] = useState(false);
  const [sexSaved, setSexSaved] = useState(false);

  useEffect(() => {
    if (profile.height_in) {
      setFeet(String(Math.floor(profile.height_in / 12)));
      setInches(String(profile.height_in % 12));
    } else {
      setFeet("");
      setInches("");
    }
  }, [profile.height_in]);

  function flash(setter: (v: boolean) => void) {
    setter(true);
    setTimeout(() => setter(false), SAVED_FLASH_MS);
  }

  function handleHeightBlur() {
    const ft = parseInt(feet, 10);
    const inch = parseInt(inches, 10);
    if (!Number.isFinite(ft) || !Number.isFinite(inch)) return;
    const totalIn = ft * 12 + inch;
    if (totalIn < MIN_HEIGHT_IN || totalIn > MAX_HEIGHT_IN) return;
    if (totalIn === profile.height_in) return;
    updateSettings.mutate(
      { uid: profile.id, patch: { height_in: totalIn } },
      { onSuccess: () => flash(setHeightSaved) }
    );
  }

  function handleSexChange(value: Sex) {
    if (value === profile.sex) return;
    updateSettings.mutate(
      { uid: profile.id, patch: { sex: value } },
      { onSuccess: () => flash(setSexSaved) }
    );
  }

  return (
    <SettingsCard label="Body">
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Height</Text>
        <View style={styles.heightInputs}>
          <TextInput
            value={feet}
            onChangeText={setFeet}
            onBlur={handleHeightBlur}
            placeholder="5"
            placeholderTextColor={colors.ink30}
            keyboardType="number-pad"
            style={styles.heightInput}
          />
          <Text style={styles.unitLabel}>ft</Text>
          <TextInput
            value={inches}
            onChangeText={setInches}
            onBlur={handleHeightBlur}
            placeholder="10"
            placeholderTextColor={colors.ink30}
            keyboardType="number-pad"
            style={styles.heightInput}
          />
          <Text style={styles.unitLabel}>in</Text>
        </View>
      </View>

      <SavedLabel visible={heightSaved} />

      <View style={[styles.row, styles.sexRow]}>
        <Text style={styles.rowLabel}>Sex</Text>
        <View style={styles.segmented}>
          {SEX_OPTIONS.map((value) => (
            <Pressable
              key={value}
              onPress={() => handleSexChange(value)}
              style={[styles.segment, profile.sex === value && styles.segmentActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  profile.sex === value && styles.segmentTextActive,
                ]}
              >
                {value === "male" ? "Male" : "Female"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <SavedLabel visible={sexSaved} />

      <Text style={styles.hint}>Used to estimate body fat from your measurements.</Text>
    </SettingsCard>
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
  heightInputs: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  heightInput: {
    width: 52,
    height: 40,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.cream,
    textAlign: "center",
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  unitLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
  },
  sexRow: {
    marginTop: spacing.md,
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
  segmentTextActive: {
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
    lineHeight: 17,
  },
});
