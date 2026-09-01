import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { useProfile } from "../../lib/queries/useProfile";
import { useTodayWorkout } from "../../lib/queries/useTodayWorkout";
import { colors, fonts, spacing } from "../../theme/tokens";

/**
 * Placeholder-level wiring only — proves the Wave 6 hooks type-flow end to
 * end (useProfile + useTodayWorkout). The real dashboard (motivation card,
 * today's-workout card, goals row, etc.) lands in Wave 7 (8.1).
 */
export default function Dashboard() {
  const { session } = useAuth();
  const uid = session?.user.id;

  const { data: profile } = useProfile(uid);
  const { data: today } = useTodayWorkout(uid);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.content}>
        <Text style={styles.title}>Hi{profile?.display_name ? `, ${profile.display_name}` : ""}</Text>
        <Text style={styles.description}>Streak: {today?.streak ?? 0} days</Text>
        <Text style={styles.description}>
          {today?.workout ? `Today: ${today.workout.name}` : "No workout scheduled today"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink50,
    textAlign: "center",
  },
});
