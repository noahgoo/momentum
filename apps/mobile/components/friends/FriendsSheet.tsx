import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { useClientDate } from "../../lib/useClientDate";
import { useFriendships } from "../../lib/queries/useFriendships";
import { useAcceptFriendRequest } from "../../lib/queries/useAcceptFriendRequest";
import { useRemoveFriendship } from "../../lib/queries/useRemoveFriendship";
import { FriendRow } from "./FriendRow";
import { RequestRow } from "./RequestRow";
import { FindFriendsSection } from "./FindFriendsSection";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface FriendsSheetProps {
  onClose: () => void;
}

/**
 * The whole friends surface — requests, your friends, sent, find friends.
 *
 * Was the `(tabs)/friends` route until the tab bar was cut to five icons; it
 * is now presented as a modal from the dashboard's FriendsCard, which is the
 * only way in. Body is unchanged apart from the refetch and the close button.
 *
 * Still no realtime subscription (explicit non-goal). The route version
 * refetched via expo-router's `useFocusEffect`, which never fires for a modal,
 * so the refetch moved to mount — the caller renders this only while open, so
 * mount and open are the same moment.
 */
export function FriendsSheet({ onClose }: FriendsSheetProps) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const { today } = useClientDate();

  const { data: friendships = [], isLoading, refetch } = useFriendships(uid);
  const acceptRequest = useAcceptFriendRequest();
  const removeFriendship = useRemoveFriendship();

  const [busyPairId, setBusyPairId] = useState<string | null>(null);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const accepted = friendships.filter((f) => f.status === "accepted");
  const incoming = friendships.filter((f) => f.status === "pending" && f.requested_by !== uid);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.requested_by === uid);

  function handleAccept(pairId: string) {
    if (!uid) return;
    setBusyPairId(pairId);
    acceptRequest.mutate({ pairId, clientId: uid }, { onSettled: () => setBusyPairId(null) });
  }

  function handleDecline(pairId: string) {
    if (!uid) return;
    setBusyPairId(pairId);
    removeFriendship.mutate({ pairId, clientId: uid }, { onSettled: () => setBusyPairId(null) });
  }

  function handleUnfriend(pairId: string) {
    if (!uid) return;
    removeFriendship.mutate({ pairId, clientId: uid });
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.headerTextCol}>
        <Text style={styles.headerTitle}>Friends</Text>
        <Text style={styles.headerSubtitle}>TRAIN TOGETHER, STREAK TOGETHER</Text>
      </View>
      <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" style={styles.closeButton}>
        <Text style={styles.closeLabel}>Done</Text>
      </Pressable>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingContent}>
          {header}
          <View style={[styles.skeletonBlock, { width: 200, height: 14, marginTop: 10 }]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}

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
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
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
  closeButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.creamDeep,
    marginTop: spacing.sm,
  },
  closeLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.ink,
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
