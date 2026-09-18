import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Friendship } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { useCoachSiblings } from "../../lib/queries/useCoachSiblings";
import { useSendFriendRequest } from "../../lib/queries/useSendFriendRequest";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface FindFriendsSectionProps {
  /** Existing friendships (any status) for this client — used to hide siblings already in a pair. */
  friendships: Friendship[];
}

/**
 * "Find friends" roster (plan 8.6 follow-up). Lists same-coach clients from
 * `list_coach_siblings()` (0018_list_coach_siblings.sql — a SECURITY DEFINER
 * RPC, since `profiles` RLS doesn't let a client read sibling rows directly)
 * who aren't already in a friendship of any status with this client, and
 * lets the client send a request via the existing `useSendFriendRequest`
 * mutation. Keeps the explanatory empty state when there's nothing to show,
 * either because the coach has no other clients or every sibling is already
 * connected.
 */
export function FindFriendsSection({ friendships }: FindFriendsSectionProps) {
  const { session } = useAuth();
  const uid = session?.user.id;

  const { data: siblings = [], isLoading } = useCoachSiblings(uid);
  const sendRequest = useSendFriendRequest();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectedIds = new Set(
    friendships.map((f) => (f.client_id === uid ? f.friend_id : f.client_id))
  );
  const available = siblings.filter((s) => !connectedIds.has(s.id));

  function handleAdd(friendId: string) {
    if (!uid) return;
    setPendingId(friendId);
    setError(null);
    sendRequest.mutate(
      { friendId, clientId: uid },
      {
        // Without this the spinner just stopped and nothing else happened —
        // the failure was invisible, which is how a policy that refused EVERY
        // request went unnoticed (0029).
        onError: (err) => {
          const message = err instanceof Error ? err.message : String(err);
          setError(
            message.includes("friends_must_share_coach")
              ? "You can only add clients who share your coach."
              : "Couldn't send that request. Check your connection and try again."
          );
        },
        onSettled: () => setPendingId(null),
      }
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>FIND FRIENDS</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.ink30} style={styles.loading} />
      ) : available.length === 0 ? (
        <Text style={styles.body}>
          No one else to add right now — ask your coach to bring on another client, or check back
          once a request is accepted.
        </Text>
      ) : (
        <View style={styles.listWrap}>
          {available.map((sibling, i) => (
            <View
              key={sibling.id}
              style={[styles.row, i === available.length - 1 && styles.rowLast]}
            >
              <Text style={styles.name} numberOfLines={1}>
                {sibling.display_name}
              </Text>
              {pendingId === sibling.id ? (
                <ActivityIndicator size="small" color={colors.ink50} />
              ) : (
                <Pressable
                  style={styles.pillButton}
                  onPress={() => handleAdd(sibling.id)}
                  disabled={sendRequest.isPending}
                >
                  <Text style={styles.pillLabel}>Add</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.bad,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    ...shadows.cardSubtle,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.4,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  loading: {
    marginTop: spacing.md,
  },
  listWrap: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
  },
  pillButton: {
    height: 32,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blue,
  },
  pillLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.ink,
  },
});
