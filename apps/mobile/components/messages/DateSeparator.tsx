import { StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "../../theme/tokens";

interface DateSeparatorProps {
  label: string;
}

/** Centered pill separating a day's worth of messages from the next. */
export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.pill}>
        <Text style={styles.text}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginVertical: 14,
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.ink08,
  },
  text: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.ink50,
    letterSpacing: 0.2,
  },
});
