import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { Friendship } from "@momentum/shared";
import { parseFriendshipStats } from "@momentum/shared";
import { otherMember } from "../../lib/queries/useFriendships";
import { colors, fonts, spacing } from "../../theme/tokens";

interface FriendRowProps {
  friendship: Friendship;
  myUid: string;
  /** Device-local today (YYYY-MM-DD) — stats are only meaningful if computed for this date. */
  today: string;
  isLast: boolean;
  onUnfriend: (pairId: string) => void;
}

/**
 * One accepted-friend row: name, today status derived from
 * `friendships.stats[friendUid]` (plan 8.6 #1), that member's individual
 * streak, and the pair's `shared_streak` badge. Long-press reveals a native
 * confirm before unfriending (plan #3: "swipe or long-press → confirm →
 * delete" — long-press chosen so this rarer, destructive action doesn't
 * duplicate GoalRow's PanResponder swipe machinery for a single use site).
 */
export function FriendRow({ friendship, myUid, today, isLast, onUnfriend }: FriendRowProps) {
  const friend = otherMember(friendship, myUid);
  const stats = parseFriendshipStats(friendship.stats ?? {})[friend.uid];

  const statusLabel = (() => {
    if (!stats || stats.date !== today) return "—";
    if (stats.workoutDoneToday) return "Trained today ✓";
    if (stats.hasWorkoutToday) return "Workout pending";
    return "Rest day";
  })();

  function handleLongPress() {
    Alert.alert(
      "Unfriend?",
      `You and ${friend.name} will lose your shared streak.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unfriend",
          style: "destructive",
          onPress: () => onUnfriend(friendship.pair_id),
        },
      ]
    );
  }

  return (
    <Pressable
      style={[styles.row, isLast && styles.rowLast]}
      onLongPress={handleLongPress}
      delayLongPress={400}
    >
      <View style={styles.textCol}>
        <Text style={styles.name}>{friend.name}</Text>
        <Text style={styles.meta}>
          {statusLabel}
          {stats ? ` · ${stats.streak}-day streak` : ""}
        </Text>
      </View>
      <View style={styles.sharedCol}>
        <Text style={styles.sharedValue}>🔥 {friendship.shared_streak}</Text>
        <Text style={styles.sharedLabel}>SHARED</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 3,
  },
  sharedCol: {
    flexShrink: 0,
    alignItems: "center",
  },
  sharedValue: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
    fontSize: 18,
    color: colors.ink,
  },
  sharedLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    color: colors.ink50,
    letterSpacing: 1,
    marginTop: 2,
  },
});
