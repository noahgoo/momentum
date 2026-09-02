import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Friendship } from "@momentum/shared";
import { otherMember } from "../../lib/queries/useFriendships";
import { colors, fonts, radii, spacing } from "../../theme/tokens";

interface RequestRowProps {
  friendship: Friendship;
  myUid: string;
  isLast: boolean;
  busy: boolean;
  /** Incoming (someone else requested me): Accept / Decline. Outgoing: "Waiting…" / Cancel. */
  direction: "incoming" | "outgoing";
  onAccept: (pairId: string) => void;
  onDecline: (pairId: string) => void;
}

/** One pending-request row, rendered differently depending on who sent it (plan 8.6 #2). */
export function RequestRow({
  friendship,
  myUid,
  isLast,
  busy,
  direction,
  onAccept,
  onDecline,
}: RequestRowProps) {
  const friend = otherMember(friendship, myUid);

  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <Text style={styles.name} numberOfLines={1}>
        {friend.name}
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={colors.ink50} />
      ) : direction === "incoming" ? (
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.pillButton, styles.pillPrimary]}
            onPress={() => onAccept(friendship.pair_id)}
          >
            <Text style={styles.pillPrimaryLabel}>Accept</Text>
          </Pressable>
          <Pressable
            style={[styles.pillButton, styles.pillQuiet]}
            onPress={() => onDecline(friendship.pair_id)}
          >
            <Text style={styles.pillQuietLabel}>Decline</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.buttonRow}>
          <Text style={styles.waitingLabel}>Waiting…</Text>
          <Pressable
            style={[styles.pillButton, styles.pillQuiet]}
            onPress={() => onDecline(friendship.pair_id)}
          >
            <Text style={styles.pillQuietLabel}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
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
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
  },
  waitingLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink30,
  },
  pillButton: {
    height: 32,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  pillPrimary: {
    backgroundColor: colors.blue,
  },
  pillPrimaryLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.ink,
  },
  pillQuiet: {
    borderWidth: 1.5,
    borderColor: colors.line2,
  },
  pillQuietLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.ink,
  },
});
