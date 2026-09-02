import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { BodyMeasurementCreate } from "@momentum/shared";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";

interface FieldSpec {
  key: keyof Pick<
    BodyMeasurementCreate,
    "weightLbs" | "neckIn" | "waistIn" | "hipsIn" | "chestIn" | "armIn" | "thighIn"
  >;
  label: string;
  unit: string;
}

const FIELDS: FieldSpec[] = [
  { key: "weightLbs", label: "Weight", unit: "lbs" },
  { key: "neckIn", label: "Neck", unit: "in" },
  { key: "waistIn", label: "Waist", unit: "in" },
  { key: "hipsIn", label: "Hips", unit: "in" },
  { key: "chestIn", label: "Chest", unit: "in" },
  { key: "armIn", label: "Arm", unit: "in" },
  { key: "thighIn", label: "Thigh", unit: "in" },
];

interface MeasurementFormProps {
  date: string;
  saving: boolean;
  error: string | null;
  onSubmit: (entry: BodyMeasurementCreate) => void;
}

/**
 * Log-measurements form, ported from mindful-miya's measurements page.
 * `date` defaults to device-local "today" (constraint #11) and is not
 * editable here — measurements are immutable once saved (constraint #10),
 * so there's no "edit a past date" flow, only "log today".
 */
export function MeasurementForm({ date, saving, error, onSubmit }: MeasurementFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  const hasAnyValue = FIELDS.some((f) => values[f.key]?.trim());

  function handleSubmit() {
    if (!hasAnyValue || saving) return;
    const entry: BodyMeasurementCreate = { date };
    for (const field of FIELDS) {
      const raw = values[field.key]?.trim();
      if (raw) {
        const num = Number.parseFloat(raw);
        if (Number.isFinite(num)) entry[field.key] = num;
      }
    }
    onSubmit(entry);
    setValues({});
  }

  return (
    <View style={[styles.card, shadows.cardSubtle]}>
      <Text style={styles.eyebrow}>LOG MEASUREMENTS</Text>

      <View style={styles.grid}>
        {FIELDS.map((field) => (
          <View key={field.key} style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>
              {field.label} ({field.unit})
            </Text>
            <TextInput
              value={values[field.key] ?? ""}
              onChangeText={(text) => setValues((v) => ({ ...v, [field.key]: text }))}
              placeholder="—"
              placeholderTextColor={colors.ink30}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        onPress={handleSubmit}
        disabled={!hasAnyValue || saving}
        style={[styles.submitButton, (!hasAnyValue || saving) && styles.submitButtonDisabled]}
      >
        <Text style={[styles.submitLabel, (!hasAnyValue || saving) && styles.submitLabelDisabled]}>
          {saving ? "Saving…" : "Save entry"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
    marginBottom: spacing.lg,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  fieldWrap: {
    width: "47%",
  },
  fieldLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginBottom: 4,
  },
  input: {
    height: 44,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.ink,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.bad,
    textAlign: "center",
  },
  submitButton: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    backgroundColor: colors.creamDeep,
  },
  submitLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.ink,
  },
  submitLabelDisabled: {
    color: colors.ink30,
  },
});
