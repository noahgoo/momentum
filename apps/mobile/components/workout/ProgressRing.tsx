import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, fonts } from "../../theme/tokens";

interface ProgressRingProps {
  /** 0-100 */
  percent: number;
  size?: number;
}

/**
 * SVG progress ring showing % of program days elapsed. Ported from the old
 * app's workout page ring (mindful-miya/src/app/workout/page.tsx) — same
 * stroke-dashoffset technique, react-native-svg instead of DOM svg.
 */
export function ProgressRing({ percent, size = 64 }: ProgressRingProps) {
  const strokeWidth = 5;
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.creamDeep}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.blueDeep}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.labelContainer}>
          <Text style={styles.label}>{clamped}%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.ink,
  },
});
