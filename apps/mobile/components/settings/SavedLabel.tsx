import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../../theme/tokens";

const RESERVED_HEIGHT = 18;

/**
 * "Saved ✓" confirmation with a fixed-height wrapper so its appearance
 * never shifts layout below it (slice brief: "reserved-height confirmations
 * to avoid layout shift" — matches the old app's `height: 18/20` wrapper
 * divs in src/app/settings/page.tsx).
 */
export function SavedLabel({ visible }: { visible: boolean }) {
  return <View style={styles.wrap}>{visible ? <Text style={styles.text}>Saved ✓</Text> : null}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    height: RESERVED_HEIGHT,
    justifyContent: "center",
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ok,
  },
});
