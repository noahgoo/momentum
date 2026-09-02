import { Text, View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { bodyFatFromEntry, type BodyMeasurement, type Profile } from "@momentum/shared";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";

interface BodyFatHeroCardProps {
  profile: Pick<Profile, "sex" | "height_in"> | null;
  latest: BodyMeasurement | null;
}

/**
 * Navy body-fat % hero, ported from mindful-miya's measurements page. Uses
 * the shared `bodyFatFromEntry` (canonical TS impl, constraint #10) —
 * null-safe: shows a helpful placeholder instead of NaN/blank whenever the
 * profile is missing sex/height or the latest entry lacks the sites needed
 * (neck+waist, plus hips for female).
 */
export function BodyFatHeroCard({ profile, latest }: BodyFatHeroCardProps) {
  const bf =
    latest && profile
      ? bodyFatFromEntry(
          { sex: profile.sex ?? undefined, heightIn: profile.height_in ?? undefined },
          { neckIn: latest.neck_in ?? undefined, waistIn: latest.waist_in ?? undefined, hipsIn: latest.hips_in ?? undefined }
        )
      : null;

  const missingProfile = !profile?.height_in || !profile?.sex;

  return (
    <View style={[styles.card, shadows.cardSubtle]}>
      <Text style={styles.eyebrow}>BODY FAT · US NAVY METHOD</Text>
      {bf != null ? (
        <Text style={styles.value}>{bf.toFixed(1)}%</Text>
      ) : missingProfile ? (
        <Text style={styles.placeholder}>
          <Text style={styles.link} onPress={() => router.push("/settings")}>
            Add your height and sex in Settings
          </Text>{" "}
          to estimate body fat.
        </Text>
      ) : (
        <Text style={styles.placeholder}>
          {profile?.sex === "female"
            ? "Log neck, waist, and hips to estimate body fat."
            : "Log neck and waist to estimate body fat."}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    alignItems: "center",
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.blueDeep,
  },
  value: {
    fontFamily: fonts.display,
    fontSize: 48,
    fontStyle: "italic",
    color: colors.ink,
    marginTop: spacing.sm,
  },
  placeholder: {
    marginTop: spacing.md,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
  },
  link: {
    color: colors.blueDeep,
    fontFamily: fonts.bodySemiBold,
  },
});
