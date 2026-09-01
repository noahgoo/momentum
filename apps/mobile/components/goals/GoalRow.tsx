import { useMemo, useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { Goal } from "@momentum/shared";
import { colors, fonts, spacing } from "../../theme/tokens";

const ARCHIVE_ZONE_WIDTH = 72;
const SWIPE_OPEN_THRESHOLD = -36;

interface GoalRowProps {
  goal: Goal;
  done: boolean;
  /** Set by the client themselves (vs. by their coach). Drives the "from you"/"from coach" label. */
  isOwn: boolean;
  /** Own, unlocked goal: swipeable + archivable. Locked/coach goals are not. */
  isSwipeable: boolean;
  isLast: boolean;
  onToggle: () => void;
  onArchive: () => void;
}

/**
 * One checklist row. Own unlocked goals reveal a red "Archive" zone via a
 * horizontal pan gesture (no gesture-handler/reanimated dependency in this
 * app yet — `PanResponder` + `Animated` from core React Native cover this
 * one-row swipe without adding one). Locked/coach goals render a 🔒 badge
 * and are not swipeable or tap-editable.
 */
export function GoalRow({ goal, done, isOwn, isSwipeable, isLast, onToggle, onArchive }: GoalRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const latestOffset = useRef(0);
  const movedPastTapThreshold = useRef(false);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          isSwipeable && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          movedPastTapThreshold.current = false;
        },
        onPanResponderMove: (_evt, gesture) => {
          movedPastTapThreshold.current = true;
          // Clamp to [-ARCHIVE_ZONE_WIDTH, 0], relative to wherever the row
          // currently sits (so a second swipe from an already-open row works).
          const base = latestOffset.current;
          const clamped = Math.min(0, Math.max(-ARCHIVE_ZONE_WIDTH, base + gesture.dx));
          translateX.setValue(clamped);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const base = latestOffset.current;
          const clamped = Math.min(0, Math.max(-ARCHIVE_ZONE_WIDTH, base + gesture.dx));
          const openIt = clamped < SWIPE_OPEN_THRESHOLD;
          const target = openIt ? -ARCHIVE_ZONE_WIDTH : 0;
          latestOffset.current = target;
          Animated.timing(translateX, {
            toValue: target,
            duration: 180,
            useNativeDriver: true,
          }).start();
        },
      }),
    [isSwipeable, translateX]
  );

  const handlePress = () => {
    if (movedPastTapThreshold.current) {
      movedPastTapThreshold.current = false;
      return;
    }
    onToggle();
  };

  const handleArchive = () => {
    latestOffset.current = 0;
    Animated.timing(translateX, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    onArchive();
  };

  return (
    <View style={[styles.wrapper, isLast && styles.wrapperLast]}>
      {isSwipeable && (
        <View style={styles.archiveZone}>
          <Pressable onPress={handleArchive} hitSlop={8}>
            <Text style={styles.archiveLabel}>Archive</Text>
          </Pressable>
        </View>
      )}
      <Animated.View
        {...(isSwipeable ? panResponder.panHandlers : {})}
        style={[styles.row, { transform: [{ translateX }] }]}
      >
        <Pressable style={styles.rowPressable} onPress={handlePress}>
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  wrapperLast: {
    borderBottomWidth: 0,
  },
  archiveZone: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ARCHIVE_ZONE_WIDTH,
    backgroundColor: colors.bad,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveLabel: {
    color: "#fff",
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  row: {
    backgroundColor: colors.surface,
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
