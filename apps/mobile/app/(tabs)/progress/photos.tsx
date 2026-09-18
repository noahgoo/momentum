import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { ChevronLeft } from "lucide-react-native";
import { useAuth } from "../../../lib/auth";
import { useTabBarSpace } from "../../../components/PillTabBar";
import { useProgressPhotos, type ProgressPhotoWithUrls } from "../../../lib/queries/useProgressPhotos";
import { useUploadProgressPhotos } from "../../../lib/queries/useUploadProgressPhotos";
import { useDeleteProgressPhoto } from "../../../lib/queries/useDeleteProgressPhoto";
import { PhotoGrid } from "../../../components/progress/PhotoGrid";
import { PhotoLightbox } from "../../../components/progress/PhotoLightbox";
import { colors, fonts, spacing } from "../../../theme/tokens";

/** Progress photos: 3-col grid + lightbox, ported from mindful-miya's /progress/photos. */
export default function ProgressPhotosScreen() {
  const tabBarSpace = useTabBarSpace();
  const { session } = useAuth();
  const uid = session?.user.id;

  const { data: photos = [], isPending } = useProgressPhotos(uid);
  const uploadMutation = useUploadProgressPhotos();
  const deleteMutation = useDeleteProgressPhoto();

  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  async function handleAddPhotos() {
    if (!uid || uploadMutation.isPending) return;
    setError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to add photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const { failed, succeeded } = await uploadMutation.mutateAsync({
      clientId: uid,
      photos: result.assets.map((asset) => ({ uri: asset.uri })),
    });

    if (failed > 0) {
      setError(
        succeeded === 0
          ? "Upload failed. Try again."
          : `${failed} of ${failed + succeeded} photos failed to upload.`
      );
    }
  }

  function handleDelete(photo: ProgressPhotoWithUrls) {
    if (!uid || deleteMutation.isPending) return;
    deleteMutation.mutate(
      { clientId: uid, photoId: photo.id, storagePath: photo.storage_path },
      {
        onSuccess: () => setViewerIndex(null),
        onError: () => {
          Alert.alert("Couldn't delete photo", "Try again.");
        },
      }
    );
  }

  // Pop rather than push: pushing the parent route again animates
  // FORWARD on what reads as a back gesture, and grows the stack every
  // time. canGoBack guards a cold start straight onto this route.
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/progress");
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}>
        <Pressable style={styles.backRow} onPress={goBack}>
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Progress</Text>
        </Pressable>

        <Text style={styles.eyebrow}>PROGRESS PHOTOS</Text>
        <Text style={styles.title}>Your Photos</Text>
        {!isPending && (
          <Text style={styles.subtitle}>
            {photos.length === 0 ? "Track how far you've come" : `${photos.length} photo${photos.length !== 1 ? "s" : ""}`}
          </Text>
        )}

        <Pressable
          onPress={handleAddPhotos}
          disabled={uploadMutation.isPending}
          style={[styles.addButton, uploadMutation.isPending && styles.addButtonDisabled]}
        >
          {uploadMutation.isPending ? (
            <ActivityIndicator color={colors.ink30} />
          ) : (
            <Text style={styles.addButtonLabel}>+ Add photos</Text>
          )}
        </Pressable>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {!isPending && photos.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyBadge}>
              <Text style={styles.emptyBadgeText}>📷</Text>
            </View>
            <Text style={styles.emptyTitle}>No photos yet</Text>
            <Text style={styles.emptySubtitle}>Add your first progress photo — future you will thank you.</Text>
          </View>
        ) : (
          <View style={styles.gridWrap}>
            <PhotoGrid photos={photos} onSelect={(photo) => setViewerIndex(photos.indexOf(photo))} />
          </View>
        )}
      </ScrollView>

      {viewerIndex != null && (
        <PhotoLightbox
          photos={photos}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onDelete={handleDelete}
          deleting={deleteMutation.isPending}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.xl,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  backText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.ink50,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontStyle: "italic",
    color: colors.ink,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 4,
  },
  addButton: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  addButtonDisabled: {
    backgroundColor: colors.creamDeep,
  },
  addButtonLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.ink,
  },
  errorText: {
    marginTop: spacing.md,
    fontSize: 13,
    color: colors.bad,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: 48,
  },
  emptyBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBadgeText: {
    fontSize: 30,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontStyle: "italic",
    color: colors.ink,
  },
  emptySubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    maxWidth: 240,
    lineHeight: 20,
  },
  gridWrap: {
    marginTop: spacing.xl,
  },
});
