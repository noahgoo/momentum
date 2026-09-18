import { useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Users } from "lucide-react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";
import type { DashboardFriendSummary } from "../../lib/queries/useDashboard";
import { FriendsSheet } from "../friends/FriendsSheet";

interface FriendsCardProps {
  friends: DashboardFriendSummary;
}

/**
 * Count-of-accepted-friendships + first friend's shared streak, with a
 * pending-request badge dot.
 *
 * This card is now the ONLY way into the friends surface: the `(tabs)/friends`
 * route was removed to cut the tab bar to five icons, so tapping opens
 * FriendsSheet as a modal instead of navigating. The sheet is rendered only
 * while open so it mounts (and refetches) fresh each time.
 */
export function FriendsCard({ friends }: FriendsCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
    <TouchableOpacity
      style={styles.card}
      onPress={() => setOpen(true)}
      accessibilityRole="button"
    >
      <View style={styles.iconWrap}>
        <Users size={22} color={colors.ink} />
        {friends.pendingCount > 0 && <View style={styles.badgeDot} />}
      </View>
      <View style={styles.textColumn}>
        <Text style={styles.label}>FRIENDS</Text>
        <Text style={styles.value}>
          {friends.count === 0
            ? "Add a friend"
            : `${friends.count} friend${friends.count === 1 ? "" : "s"}`}
          {friends.first ? ` · ${friends.first.sharedStreak}-day streak` : ""}
        </Text>
      </View>
      <Text style={styles.chevron}>→</Text>
    </TouchableOpacity>

    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setOpen(false)}
    >
      {open && <FriendsSheet onClose={() => setOpen(false)} />}
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    ...shadows.card,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.creamDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.bad,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  value: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
    marginTop: 6,
  },
  chevron: {
    fontSize: 18,
    color: colors.ink30,
  },
});
