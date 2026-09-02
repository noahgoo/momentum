import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "../../theme/tokens";

interface MessageBubbleProps {
  text: string;
  time: string;
  isOwn: boolean;
  /** True when the previous message in the list was from the same sender —
   * tightens vertical spacing so consecutive messages read as one turn. */
  grouped: boolean;
}

/** One chat bubble. Own messages: blue-deep fill, white text, right-aligned.
 * Coach messages: white fill, ink text, left-aligned. Ports the corner-radius
 * "tail" treatment from mindful-miya's messages page (18/18/4/18 vs
 * 18/18/18/4). */
export function MessageBubble({ text, time, isOwn, grouped }: MessageBubbleProps) {
  return (
    <View
      style={[
        styles.row,
        { alignItems: isOwn ? "flex-end" : "flex-start", marginTop: grouped ? 2 : spacing.md },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleCoach,
          isOwn ? styles.tailOwn : styles.tailCoach,
        ]}
      >
        <Text style={[styles.text, { color: isOwn ? "#FFFFFF" : colors.ink }]}>{text}</Text>
      </View>
      <Text style={[styles.time, { paddingLeft: isOwn ? 0 : 4, paddingRight: isOwn ? 4 : 0 }]}>
        {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "column",
    width: "100%",
  },
  bubble: {
    maxWidth: "75%",
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  bubbleOwn: {
    backgroundColor: colors.blueDeep,
  },
  bubbleCoach: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.ink08,
  },
  tailOwn: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
  },
  tailCoach: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 18,
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  time: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.ink30,
    marginTop: 3,
  },
});
