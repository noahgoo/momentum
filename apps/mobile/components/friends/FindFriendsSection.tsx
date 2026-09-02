import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

/**
 * Disabled "find friends" section (plan 8.6 roster-readability finding).
 *
 * A same-coach client roster would normally back an "Add a friend" picker,
 * but `profiles` RLS (0005_rls_helpers_and_core_policies.sql) only grants a
 * client SELECT on their own row and their own coach's row — NOT sibling
 * clients under the same coach. There is no policy a client-side query can
 * satisfy to list "other clients who share my coach," so a roster query
 * here would just return empty, not degrade gracefully. Per the plan's
 * explicit instruction, no RLS/schema changes ship in this slice — this
 * section stays disabled with an explanatory note instead of silently
 * showing an empty list that looks like a bug.
 *
 * Follow-up (reported to orchestrator): a SECURITY DEFINER RPC like
 * `list_coach_siblings()` (mirroring `my_coach_id()` in
 * 0017_fix_profiles_recursion.sql) could return `{id, display_name}` for
 * same-coach clients without widening `profiles` SELECT policy itself.
 */
export function FindFriendsSection() {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>FIND FRIENDS</Text>
      <Text style={styles.body}>
        Ask your coach to connect you with another client — sending new
        requests from here is coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    opacity: 0.6,
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
});
