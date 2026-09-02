import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { bodyFatFromEntry, dateStr, type BodyMeasurement, type BodyMeasurementCreate } from "@momentum/shared";
import { useAuth } from "../../../lib/auth";
import { useProfile } from "../../../lib/queries/useProfile";
import { useBodyMeasurements } from "../../../lib/queries/useBodyMeasurements";
import { useCreateBodyMeasurement } from "../../../lib/queries/useCreateBodyMeasurement";
import { useDeleteBodyMeasurement } from "../../../lib/queries/useDeleteBodyMeasurement";
import { BodyFatHeroCard } from "../../../components/progress/BodyFatHeroCard";
import { MeasurementForm } from "../../../components/progress/MeasurementForm";
import { WeightSparkline } from "../../../components/progress/WeightSparkline";
import { colors, fonts, radii, spacing, shadows } from "../../../theme/tokens";

function formatEntryDate(dateString: string): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function entrySummaryLine(entry: BodyMeasurement, bf: number | null): string {
  const parts: string[] = [];
  if (entry.weight_lbs != null) parts.push(`${entry.weight_lbs} lbs`);
  if (bf != null) parts.push(`${bf.toFixed(1)}% BF`);
  return parts.join(" · ") || "No weight logged";
}

function entryOtherSitesLine(entry: BodyMeasurement): string {
  const parts: string[] = [];
  if (entry.neck_in != null) parts.push(`Neck ${entry.neck_in}"`);
  if (entry.waist_in != null) parts.push(`Waist ${entry.waist_in}"`);
  if (entry.hips_in != null) parts.push(`Hips ${entry.hips_in}"`);
  if (entry.chest_in != null) parts.push(`Chest ${entry.chest_in}"`);
  if (entry.arm_in != null) parts.push(`Arm ${entry.arm_in}"`);
  if (entry.thigh_in != null) parts.push(`Thigh ${entry.thigh_in}"`);
  return parts.join(" · ");
}

/**
 * Measurements: Navy BF% hero + log form + weight sparkline + history,
 * ported from mindful-miya's /progress/measurements. Measurements are
 * immutable (constraint #10) — no edit, only delete + re-add.
 */
export default function ProgressMeasurementsScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;

  const { data: profile } = useProfile(uid);
  const { data: entries = [], isPending } = useBodyMeasurements(uid);
  const createMutation = useCreateBodyMeasurement();
  const deleteMutation = useDeleteBodyMeasurement();

  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const latest = entries[0] ?? null;

  const sparklinePoints = entries
    .filter((e) => e.weight_lbs != null)
    .slice(0, 12)
    .reverse()
    .map((e) => ({ date: e.date, weightLbs: e.weight_lbs as number }));

  function handleSave(entry: BodyMeasurementCreate) {
    if (!uid || createMutation.isPending) return;
    setFormError(null);
    createMutation.mutate(
      { clientId: uid, entry: { ...entry, date: dateStr(new Date()) } },
      {
        onError: (err) => {
          console.error("Failed to save measurement:", err);
          setFormError("Couldn't save. Try again.");
        },
      }
    );
  }

  function handleDelete(entry: BodyMeasurement) {
    if (!uid || deletingId) return;
    Alert.alert("Delete this entry?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setDeletingId(entry.id);
          deleteMutation.mutate(
            { clientId: uid, entryId: entry.id },
            {
              onError: () => Alert.alert("Couldn't delete entry", "Try again."),
              onSettled: () => setDeletingId(null),
            }
          );
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.push("/(tabs)/progress")}>
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Progress</Text>
        </Pressable>

        <Text style={styles.eyebrow}>MEASUREMENTS</Text>
        <Text style={styles.title}>Body Composition</Text>
        {!isPending && (
          <Text style={styles.subtitle}>
            {entries.length === 0 ? "Track your measurements" : `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`}
          </Text>
        )}

        <View style={styles.section}>
          <BodyFatHeroCard profile={profile ?? null} latest={latest} />
        </View>

        <View style={styles.section}>
          <MeasurementForm
            date={dateStr(new Date())}
            saving={createMutation.isPending}
            error={formError}
            onSubmit={handleSave}
          />
        </View>

        {sparklinePoints.length >= 2 && (
          <View style={styles.section}>
            <WeightSparkline points={sparklinePoints} />
          </View>
        )}

        {!isPending && entries.length > 0 && (
          <View style={[styles.historyCard, shadows.cardSubtle]}>
            <Text style={styles.historyEyebrow}>HISTORY</Text>
            <View style={styles.historyList}>
              {entries.map((entry) => {
                const bf = profile
                  ? bodyFatFromEntry(
                      { sex: profile.sex ?? undefined, heightIn: profile.height_in ?? undefined },
                      { neckIn: entry.neck_in ?? undefined, waistIn: entry.waist_in ?? undefined, hipsIn: entry.hips_in ?? undefined }
                    )
                  : null;
                const otherSites = entryOtherSitesLine(entry);
                const isDeleting = deletingId === entry.id;
                return (
                  <View key={entry.id} style={styles.historyRow}>
                    <View style={styles.historyRowText}>
                      <Text style={styles.historyDate}>{formatEntryDate(entry.date)}</Text>
                      <Text style={styles.historySummary}>{entrySummaryLine(entry, bf)}</Text>
                      {otherSites ? <Text style={styles.historySites}>{otherSites}</Text> : null}
                    </View>
                    <Pressable onPress={() => handleDelete(entry)} disabled={isDeleting} hitSlop={8}>
                      <Text style={styles.deleteLink}>{isDeleting ? "Deleting…" : "Delete"}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxl * 2,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  backText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.ink50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontStyle: "italic",
    color: colors.ink,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 4,
  },
  section: {
    marginTop: spacing.xl,
  },
  historyCard: {
    marginTop: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  historyEyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
    marginBottom: spacing.lg,
  },
  historyList: {
    gap: spacing.lg,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  historyRowText: {
    flex: 1,
    minWidth: 0,
  },
  historyDate: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    letterSpacing: 0.4,
  },
  historySummary: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    marginTop: 4,
  },
  historySites: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink30,
    marginTop: 2,
  },
  deleteLink: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink30,
  },
});
