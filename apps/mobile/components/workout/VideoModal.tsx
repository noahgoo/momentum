import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { X } from "lucide-react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { embedHtml, videoFileHtml, videoSource } from "./videoEmbed";

interface VideoModalProps {
  /** The stored link and the exercise it demonstrates; null keeps the modal closed. */
  video: { url: string; title: string } | null;
  onClose: () => void;
}

/**
 * Plays an exercise demo in-app. YouTube/Vimeo links play in their embed
 * player and direct files in a <video> tag; the WebView is locked to that one
 * origin so a tap inside the player can't navigate it elsewhere. A link we
 * don't recognise opens externally instead of being loaded in here, and the
 * original link is always one tap away.
 */
export function VideoModal({ video, onClose }: VideoModalProps) {
  const source = video ? videoSource(video.url) : null;

  return (
    <Modal visible={video != null} animationType="fade" transparent onRequestClose={onClose}>
      {/* A centred dialog over a dimmed screen: tapping the dimmed area closes it. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close video">
        <Pressable style={styles.container} onPress={() => undefined} accessible={false}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {video?.title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Close video"
              hitSlop={8}
              style={styles.close}
            >
              <X color={colors.ink} size={22} />
            </TouchableOpacity>
          </View>

          {source ? (
            <View style={styles.player}>
              <WebView
                originWhitelist={
                  source.kind === "embed" ? [`https://${source.host}`] : ["https://*"]
                }
                source={
                  source.kind === "embed"
                    ? { html: embedHtml(source.url), baseUrl: `https://${source.host}` }
                    : { html: videoFileHtml(source.url) }
                }
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={(req) =>
                  source.kind === "embed"
                    ? req.url.startsWith(`https://${source.host}/`) || req.url === "about:blank"
                    : req.url === "about:blank" ||
                      req.url === source.url ||
                      req.url.startsWith("data:") ||
                      req.url.startsWith("about:")
                }
                style={styles.webview}
              />
            </View>
          ) : (
            <Text style={styles.fallbackText}>This video can&apos;t play inside the app.</Text>
          )}

          <TouchableOpacity
            style={styles.openButton}
            onPress={() => {
              if (video?.url) void Linking.openURL(video.url);
            }}
          >
            <Text style={styles.openButtonText}>Open in browser</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  container: {
    backgroundColor: colors.cream,
    borderRadius: radii.card,
    padding: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  close: {
    padding: spacing.xs,
  },
  player: {
    marginTop: spacing.lg,
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radii.card,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  webview: {
    flex: 1,
    backgroundColor: "#000",
  },
  fallbackText: {
    marginTop: spacing.xl,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink70,
  },
  openButton: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  openButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#fff",
  },
});
