import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, fonts, spacing } from "../../theme/tokens";

const SIZE = 52;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ProgressRingProps {
  /** 0..1 fraction of today's goals completed. */
  pct: number;
  firstName: string;
  remaining: number;
}

function greeting(pct: number): string {
  if (pct >= 1) return "All done,";
  if (pct === 0) return "Let's go,";
  return "Keep going,";
}

function subtitle(pct: number, remaining: number): string {
  if (pct >= 1) return "Great work today!";
  if (remaining === 1) return "1 goal left";
  return `${remaining} to go`;
}

/** SVG progress ring + greeting row, ported from the old app's goals page. */
export function ProgressRing({ pct, firstName, remaining }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, pct));

  return (
    <View style={styles.row}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colors.creamDeep}
          strokeWidth={STROKE}
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={colors.blueDeep}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
          strokeLinecap="round"
          rotation={-90}
          originX={SIZE / 2}
          originY={SIZE / 2}
        />
      </Svg>
      <View style={styles.textCol}>
        <Text style={styles.greeting}>
          {greeting(clamped)} <Text style={styles.name}>{firstName}</Text>
        </Text>
        <Text style={styles.subtitle}>{subtitle(clamped, remaining)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md + 2,
  },
  textCol: {
    flex: 1,
  },
  greeting: {
    fontFamily: fonts.body,
    fontSize: 22,
    color: colors.ink,
  },
  name: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
  },
});
