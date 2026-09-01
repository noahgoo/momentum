import { Image, StyleSheet, Text, View } from "react-native";
import type { MotivationEntry } from "@momentum/shared";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

interface MotivationCardProps {
  motivation: MotivationEntry | null;
}

const DEFAULT_QUOTE = "“Slow progress is still progress.”";

/** Ports the old dashboard's motivation card: 68x68 image (or a star glyph
 * placeholder), label, and an italic Fraunces quote. */
export function MotivationCard({ motivation }: MotivationCardProps) {
  return (
    <View style={styles.card}>
      {motivation?.image_url ? (
        <Image source={{ uri: motivation.image_url }} style={styles.image} />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.imagePlaceholderGlyph}>★</Text>
        </View>
      )}
      <View style={styles.textColumn}>
        <Text style={styles.label}>MOTIVATION · THIS WEEK</Text>
        <Text style={styles.quote}>{motivation?.quote ?? DEFAULT_QUOTE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    flexDirection: "row",
    gap: spacing.lg,
    alignItems: "center",
    ...shadows.card,
  },
  image: {
    width: 68,
    height: 68,
    borderRadius: 16,
  },
  imagePlaceholder: {
    width: 68,
    height: 68,
    borderRadius: 16,
    backgroundColor: colors.creamDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  imagePlaceholderGlyph: {
    fontSize: 28,
    color: colors.ink,
  },
  textColumn: {
    flex: 1,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.blueDeep,
    letterSpacing: 1.4,
  },
  quote: {
    fontFamily: fonts.displayRegular,
    fontSize: 17,
    color: colors.ink,
    marginTop: 6,
    lineHeight: 23,
  },
});
