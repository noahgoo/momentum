import { View, Text, StyleSheet } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";

export interface WeightPoint {
  date: string;
  weightLbs: number;
}

const WIDTH = 280;
const HEIGHT = 64;
const PADDING = 6;

/** SVG weight-over-time sparkline, ported from mindful-miya's measurements page polyline. */
export function WeightSparkline({ points }: { points: WeightPoint[] }) {
  if (points.length < 2) return null;

  const weights = points.map((p) => p.weightLbs);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = max - min || 1;
  const step = (WIDTH - PADDING * 2) / (points.length - 1);

  const coords = points
    .map((p, i) => {
      const x = PADDING + i * step;
      const y = PADDING + (HEIGHT - PADDING * 2) * (1 - (p.weightLbs - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View style={[styles.card, shadows.cardSubtle]}>
      <Text style={styles.eyebrow}>WEIGHT TREND</Text>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
        <Polyline
          points={coords}
          fill="none"
          stroke={colors.blueDeep}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.ink50,
    marginBottom: spacing.md,
  },
});
