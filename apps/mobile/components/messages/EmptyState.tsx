import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../../theme/tokens";

/** Ports mindful-miya's empty messages state: ✦ badge + "Say hi to your
 * coach" prompt, centered in the scroll area. */
export function EmptyState() {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Text style={styles.badgeGlyph}>✦</Text>
      </View>
      <Text style={styles.title}>No messages yet</Text>
      <Text style={styles.subtitle}>Say hi to your coach to get started</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeGlyph: {
    fontSize: 30,
    color: colors.ink,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    maxWidth: 220,
    lineHeight: 20,
  },
});
