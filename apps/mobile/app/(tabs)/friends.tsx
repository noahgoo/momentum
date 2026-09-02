import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { dateStr } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { useFriendships } from "../../lib/queries/useFriendships";
import { useAcceptFriendRequest } from "../../lib/queries/useAcceptFriendRequest";
import { useRemoveFriendship } from "../../lib/queries/useRemoveFriendship";
import { FriendRow } from "../../components/friends/FriendRow";
import { RequestRow } from "../../components/friends/RequestRow";
import { FindFriendsSection } from "../../components/friends/FindFriendsSection";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

/**
 * Friends tab (plan 8.6). No realtime subscription (explicit non-goal) —
 * refetches on focus instead, via expo-router's `useFocusEffect`, so
 * accepting/declining from elsewhere (there isn't anywhere else yet, but a
 * push deep-link could land here later) is picked up on return to the tab.
 */
export default function FriendsScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const today = dateStr(new Date());

  const { data: friendships = [], isLoading, refetch } = useFriendships(uid);
  const acceptRequest = useAcceptFriendRequest();
  const removeFriendship = useRemoveFriendship();

  const [busyPairId, setBusyPairId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const accepted = friendships.filter((f) => f.status === "accepted");
  const incoming = friendships.filter((f) => f.status === "pending" && f.requested_by !== uid);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.requested_by === uid);

  function handleAccept(pairId: string) {
    if (!uid) return;
    setBusyPairId(pairId);
    acceptRequest.mutate(
      { pairId, clientId: uid },
      { onSettled: () => setBusyPairId(null) }
    );
  }

  function handleDecline(pairId: string) {
    if (!uid) return;
    setBusyPairId(pairId);
    removeFriendship.mutate(
      { pairId, clientId: uid },
      { onSettled: () => setBusyPairId(null) }
    );
  }

  function handleUnfriend(pairId: string) {
    if (!uid) return;
    removeFriendship.mutate({ pairId, clientId: uid });
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingContent}>
          <View style={[styles.skeletonBlock, { width: 120, height: 32 }]} />
          <View style={[styles.skeletonBlock, { width: 200, height: 14, marginTop: 10 }]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Friends</Text>
          <Text style={styles.headerSubtitle}>TRAIN TOGETHER, STREAK TOGETHER</Text>
        </View>

        {incoming.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>REQUESTS</Text>
            <View style={styles.listWrap}>
              {incoming.map((friendship, i) => (
                <RequestRow
                  key={friendship.pair_id}
                  friendship={friendship}
                  myUid={uid as string}
                  isLast={i === incoming.length - 1}
                  busy={busyPairId === friendship.pair_id}
                  direction="incoming"
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>YOUR FRIENDS</Text>
          {accepted.length === 0 ? (
            <Text style={styles.emptyText}>
              No friends yet — accepted requests will show up here with your shared streak.
            </Text>
          ) : (
            <View style={styles.listWrap}>
              {accepted.map((friendship, i) => (
                <FriendRow
                  key={friendship.pair_id}
                  friendship={friendship}
                  myUid={uid as string}
                  today={today}
                  isLast={i === accepted.length - 1}
                  onUnfriend={handleUnfriend}
                />
              ))}
            </View>
          )}
          <Text style={styles.footnote}>
            Your shared streak counts days you both stayed on plan and someone trained — rest days
            never break it. Long-press a friend to unfriend.
          </Text>
        </View>

        {outgoing.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>SENT</Text>
            <View style={styles.listWrap}>
              {outgoing.map((friendship, i) => (
                <RequestRow
                  key={friendship.pair_id}
                  friendship={friendship}
                  myUid={uid as string}
                  isLast={i === outgoing.length - 1}
                  busy={busyPairId === friendship.pair_id}
                  direction="outgoing"
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))}
            </View>
          </View>
        )}

        <FindFriendsSection friendships={friendships} />
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
    padding: spacing.lg,
    gap: spacing.lg,
  },
  loadingContent: {
    padding: spacing.lg,
  },
  skeletonBlock: {
    backgroundColor: colors.creamDeep,
    borderRadius: 8,
  },
  header: {
    paddingBottom: spacing.xs,
  },
  headerTitle: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
    fontSize: 36,
    color: colors.ink,
  },
  headerSubtitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.4,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    ...shadows.cardSubtle,
  },
  sectionLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.4,
  },
  listWrap: {
    marginTop: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink30,
    marginTop: spacing.md,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink30,
    marginTop: spacing.lg,
    lineHeight: 16,
  },
});
