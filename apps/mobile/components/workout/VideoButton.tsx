import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Play } from "lucide-react-native";
import { colors, fonts } from "../../theme/tokens";

/** The small "VIDEO" pill beside an exercise name; opens it in VideoModal. */
export function VideoButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.button} accessibilityLabel="Play exercise video">
      <Play color={colors.blueDeep} size={12} fill={colors.blueDeep} />
      <Text style={styles.text}>VIDEO</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  text: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.blueDeep,
    letterSpacing: 0.6,
  },
});
