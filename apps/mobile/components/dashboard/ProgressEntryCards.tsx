import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { Camera, Ruler } from "lucide-react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";
import type { DashboardMeasurementSummary, DashboardPhotoSummary } from "../../lib/queries/useDashboard";

interface ProgressEntryCardsProps {
  photos: DashboardPhotoSummary;
  measurement: DashboardMeasurementSummary | null;
}

function entryDateLabel(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Ports the old dashboard's photos + measurements link cards. Both are
 * link-only (NON-GOAL: no photo grid or measurement entry UI here — that's
 * 8.4's job) — tapping either navigates to the progress tab.
 */
export function ProgressEntryCards({ photos, measurement }: ProgressEntryCardsProps) {
  const router = useRouter();

  return (
    <>
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push("/(tabs)/progress")}
        accessibilityRole="button"
      >
        <View style={styles.iconWrap}>
          <Camera size={22} color={colors.ink} />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.label}>PROGRESS PHOTOS</Text>
          <Text style={styles.value}>
            {photos.count === 0 ? "Add your first photo" : `${photos.count} photo${photos.count === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Text style={styles.chevron}>→</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push("/(tabs)/progress")}
        accessibilityRole="button"
      >
        <View style={styles.iconWrap}>
          <Ruler size={22} color={colors.ink} />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.label}>MEASUREMENTS</Text>
          <Text style={styles.value}>
            {measurement
              ? `${measurement.weightLbs != null ? `${measurement.weightLbs} lbs · ` : ""}${entryDateLabel(measurement.date)}`
              : "Log your first measurements"}
          </Text>
        </View>
        <Text style={styles.chevron}>→</Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    ...shadows.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.creamDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  value: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    marginTop: 6,
  },
  chevron: {
    fontSize: 18,
    color: colors.ink30,
  },
});
