import { useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import type { ProgressPhotoWithUrls } from "../../lib/queries/useProgressPhotos";
import { fonts } from "../../theme/tokens";

interface PhotoLightboxProps {
  photos: ProgressPhotoWithUrls[];
  initialIndex: number;
  onClose: () => void;
  onDelete: (photo: ProgressPhotoWithUrls) => void;
  deleting: boolean;
}

function formatFullDate(takenAt: string | null): string {
  if (!takenAt) return "";
  return new Date(takenAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Full-screen photo lightbox: swipe (FlatList paging) or arrow taps to move
 * between photos, delete with a native confirm. Ported from mindful-miya's
 * single-photo dialog, extended to swipe/arrows across the whole set since
 * this is a scrollable grid rather than a modal-per-tap web page.
 */
export function PhotoLightbox({ photos, initialIndex, onClose, onDelete, deleting }: PhotoLightboxProps) {
  const { width } = Dimensions.get("window");
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<ProgressPhotoWithUrls>>(null);

  const photo = photos[index];

  function goTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= photos.length) return;
    setIndex(nextIndex);
    listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
  }

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (nextIndex !== index) setIndex(nextIndex);
  }

  function handleDeletePress() {
    if (!photo || deleting) return;
    Alert.alert("Delete this photo?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(photo) },
    ]);
  }

  if (!photo) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.dateLabel}>{formatFullDate(photo.taken_at)}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
            <X color="#fff" size={22} />
          </Pressable>
        </View>

        <View style={styles.imageArea}>
          <FlatList
            ref={listRef}
            data={photos}
            keyExtractor={(item) => item.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={handleScrollEnd}
            renderItem={({ item }) => (
              <View style={[styles.slide, { width }]}>
                {item.signedUrl ? (
                  <Image source={{ uri: item.signedUrl }} style={styles.fullImage} resizeMode="contain" />
                ) : (
                  <Text style={styles.loadingText}>Loading…</Text>
                )}
              </View>
            )}
          />

          {index > 0 && (
            <Pressable style={[styles.arrow, styles.arrowLeft]} onPress={() => goTo(index - 1)} hitSlop={12}>
              <ChevronLeft color="#fff" size={28} />
            </Pressable>
          )}
          {index < photos.length - 1 && (
            <Pressable style={[styles.arrow, styles.arrowRight]} onPress={() => goTo(index + 1)} hitSlop={12}>
              <ChevronRight color="#fff" size={28} />
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={handleDeletePress}
          disabled={deleting}
          style={[styles.deleteButton, deleting && styles.deleteButtonDisabled]}
        >
          <Text style={styles.deleteLabel}>{deleting ? "Deleting…" : "Delete photo"}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(28,28,28,0.94)",
    paddingTop: 54,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.4,
  },
  closeButton: {
    padding: 4,
  },
  imageArea: {
    flex: 1,
    marginVertical: 12,
    justifyContent: "center",
  },
  slide: {
    alignItems: "center",
    justifyContent: "center",
  },
  fullImage: {
    width: "100%",
    height: "100%",
  },
  loadingText: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: fonts.body,
    fontSize: 13,
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: {
    left: 4,
  },
  arrowRight: {
    right: 4,
  },
  deleteButton: {
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteLabel: {
    color: "#fff",
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
  },
});
