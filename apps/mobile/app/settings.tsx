import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
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
  const uid = session?.user.id;

  // Read through the query hook (not auth-context `profile`) so every card's
  // autosave mutation and this screen share the same qk.profile(uid) cache
  // entry per the README's optimistic-mutation convention.
  const { data: profile } = useProfile(uid);
  const { data: requests = [], isLoading: requestsLoading } = useChangeRequestHistory(uid);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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
