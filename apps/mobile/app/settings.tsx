import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useAuth } from "../lib/auth";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useProfile } from "../lib/queries/useProfile";
import { useChangeRequestHistory } from "../lib/queries/useChangeRequestHistory";
import { ProfileCard } from "../components/settings/ProfileCard";
import { NotificationsCard } from "../components/settings/NotificationsCard";
import { BodyCard } from "../components/settings/BodyCard";
import { TimezoneRow } from "../components/settings/TimezoneRow";
import { RequestsCard } from "../components/settings/RequestsCard";
import { AccountCard } from "../components/settings/AccountCard";
import { colors, fonts, spacing } from "../theme/tokens";

export default function Settings() {
  const { session, signOut } = useAuth();
  const { refreshing, onRefresh } = usePullToRefresh();
  const uid = session?.user.id;

  // Read through the query hook (not auth-context `profile`) so every card's
  // autosave mutation and this screen share the same qk.profile(uid) cache
  // entry per the README's optimistic-mutation convention.
  const { data: profile } = useProfile(uid);
  const { data: requests = [], isLoading: requestsLoading } = useChangeRequestHistory(uid);

  // This is a root-stack screen with headerShown: false, so without an explicit
  // control the only way out is the iOS swipe gesture. Pop rather than push, so
  // the transition runs in reverse; replace covers a cold start onto the route.
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/dashboard");
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blueDeep} />
        }
      >
        <Pressable style={styles.backRow} onPress={goBack} hitSlop={8} accessibilityRole="button">
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Dashboard</Text>
        </Pressable>

        <Text style={styles.title}>Settings</Text>

        {profile ? (
          <>
            <ProfileCard profile={profile} />
            <NotificationsCard profile={profile} />
            <BodyCard profile={profile} />
            <TimezoneRow timezone={profile.timezone} />
          </>
        ) : (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}

        <RequestsCard requests={requests} loading={requestsLoading} />
        <AccountCard signOut={signOut} />
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
    padding: spacing.xxl,
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
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    marginBottom: spacing.xl,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink50,
  },
});
