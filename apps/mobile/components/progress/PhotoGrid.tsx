import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ProgressPhotoWithUrls } from "../../lib/queries/useProgressPhotos";
import { colors, fonts, spacing } from "../../theme/tokens";

interface PhotoGridProps {
  photos: ProgressPhotoWithUrls[];
  onSelect: (photo: ProgressPhotoWithUrls) => void;
}

function formatPhotoDate(takenAt: string | null): string {
  if (!takenAt) return "";
  const d = new Date(takenAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

const COLUMNS = 3;
const GAP = spacing.sm + 2;
// Matches the screen's horizontal padding (spacing.xl on both sides, see
// progress/photos.tsx) so cell width accounts for the full available row width.
const SCREEN_PADDING = spacing.xl * 2;

/** 3-column thumbnail grid, ported from mindful-miya's photos page. Cell width
 * is computed from window width (not percentage) so the inter-cell `gap`
 * doesn't get double-counted against a percentage-based flex-wrap layout. */
export function PhotoGrid({ photos, onSelect }: PhotoGridProps) {
  const { width } = useWindowDimensions();
  const cellWidth = (width - SCREEN_PADDING - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <View style={styles.grid}>
      {photos.map((photo) => (
        <Pressable key={photo.id} style={{ width: cellWidth }} onPress={() => onSelect(photo)}>
          <View style={styles.thumbWrap}>
            {photo.signedThumbUrl ? (
              <Image source={{ uri: photo.signedThumbUrl }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>
          <Text style={styles.dateLabel}>{formatPhotoDate(photo.taken_at)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GAP,
  },
  thumbWrap: {
    aspectRatio: 1,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.creamDeep,
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    backgroundColor: colors.creamDeep,
  },
  dateLabel: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: colors.ink50,
    marginTop: 5,
    letterSpacing: 0.4,
  },
});
