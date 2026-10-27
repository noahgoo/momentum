import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { Goal } from "@momentum/shared";
import { colors, fonts, spacing } from "../../theme/tokens";

interface GoalRowProps {
  goal: Goal;
  done: boolean;
  /** Set by the client themselves (vs. by their coach). Drives the "from you"/"from coach" label. */
  isOwn: boolean;
  /** Own, unlocked goal: press-and-hold archives it. Locked/coach goals cannot be. */
  canArchive: boolean;
  isLast: boolean;
  onToggle: () => void;
  onArchive: () => void;
}

/**
 * One checklist row. Tap toggles today's check-off. Own unlocked goals can be
 * archived with a press-and-hold, confirmed in an alert (a swipe fought with
 * the tab swipe and the tap). Locked/coach goals render a 🔒 badge and ignore
 * the hold.
 */
export function GoalRow({ goal, done, isOwn, canArchive, isLast, onToggle, onArchive }: GoalRowProps) {
  const confirmArchive = () => {
    Alert.alert("Archive this goal?", goal.text, [
      { text: "Cancel", style: "cancel" },
      { text: "Archive", style: "destructive", onPress: onArchive },
    ]);
  };

  return (
    <View style={[styles.wrapper, isLast && styles.wrapperLast]}>
      <Pressable
        style={styles.rowPressable}
        onPress={onToggle}
        onLongPress={canArchive ? confirmArchive : undefined}
        delayLongPress={400}
        accessibilityActions={canArchive ? [{ name: "archive", label: "Archive goal" }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "archive") confirmArchive();
        }}
      >
        <View style={[styles.checkbox, done && styles.checkboxDone]}>
          {done && <Text style={styles.checkmark}>✓</Text>}
        </View>
        <View style={styles.textCol}>
          <Text style={[styles.goalText, done && styles.goalTextDone]}>{goal.text}</Text>
          <Text style={styles.meta}>
            {goal.locked ? "🔒 " : ""}
            {isOwn ? "from you" : "from coach"}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  wrapperLast: {
    borderBottomWidth: 0,
  },
  rowPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDone: {
    backgroundColor: colors.blueDeep,
    borderColor: colors.blueDeep,
  },
  checkmark: {
    color: "#fff",
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },
  textCol: {
    flex: 1,
  },
  goalText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: colors.ink,
  },
  goalTextDone: {
    color: colors.ink50,
    textDecorationLine: "line-through",
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.ink50,
    marginTop: 2,
  },
});
