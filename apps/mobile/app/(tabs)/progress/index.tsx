import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronRight, Camera, Ruler } from "lucide-react-native";
import { useAuth } from "../../../lib/auth";
import { useStreak } from "../../../lib/queries/useStreak";
import { colors, fonts, radii, spacing, shadows } from "../../../theme/tokens";

/**
 * Progress home: a streak hero (mirrors the dashboard's streak treatment)
 * plus links into the Photos and Measurements sub-screens. Ported layout
 * shape from mindful-miya's /progress landing, adapted to this app's
 * sub-screen-via-stack convention (see workout/_layout.tsx).
 */
export default function ProgressHomeScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const { data: streak, isPending } = useStreak(uid);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>PROGRESS</Text>
        <Text style={styles.title}>Your Journey</Text>

        <View style={[styles.streakCard, shadows.card]}>
          <Text style={styles.streakEyebrow}>CURRENT STREAK</Text>
          <Text style={styles.streakValue}>{isPending ? "—" : streak}</Text>
          <Text style={styles.streakUnit}>{streak === 1 ? "day" : "days"}</Text>
        </View>

        <View style={styles.linkList}>
          <Pressable
            style={[styles.linkCard, shadows.cardSubtle]}
            onPress={() => router.push("/(tabs)/progress/photos")}
          >
            <View style={[styles.linkIcon, { backgroundColor: colors.blue }]}>
              <Camera color={colors.ink} size={20} />
            </View>
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>Photos</Text>
              <Text style={styles.linkSubtitle}>Track how far you've come</Text>
            </View>
            <ChevronRight color={colors.ink30} size={18} />
          </Pressable>

          <Pressable
            style={[styles.linkCard, shadows.cardSubtle]}
            onPress={() => router.push("/(tabs)/progress/measurements")}
          >
            <View style={[styles.linkIcon, { backgroundColor: colors.okBg }]}>
              <Ruler color={colors.ok} size={20} />
            </View>
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>Measurements</Text>
              <Text style={styles.linkSubtitle}>Body fat &amp; weight trend</Text>
            </View>
            <ChevronRight color={colors.ink30} size={18} />
          </Pressable>
        </View>
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
    marginBottom: spacing.xl,
  },
  streakCard: {
    borderRadius: radii.card,
    backgroundColor: colors.blueDeep,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  streakEyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: "rgba(255,255,255,0.8)",
  },
  streakValue: {
    fontFamily: fonts.display,
    fontSize: 56,
    fontStyle: "italic",
    color: "#fff",
    marginTop: spacing.xs,
  },
  streakUnit: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    marginTop: -4,
  },
  linkList: {
    gap: spacing.md,
  },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  linkIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  linkTextWrap: {
    flex: 1,
  },
  linkTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
  },
  linkSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
  },
});
