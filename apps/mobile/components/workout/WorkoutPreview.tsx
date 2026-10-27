import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { describeTarget, parseSetConfig } from "@momentum/shared";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";
import type { WorkoutExerciseWithName } from "../../lib/queries/useWorkoutDay";
import { VideoButton } from "./VideoButton";
import { VideoModal } from "./VideoModal";

/**
 * Read-only list of a future day's exercises and their prescriptions. Shows
 * what is planned, never an input: nothing is loggable yet, and a progressive
 * weight target is left unresolved because it depends on what the client
 * lifts between now and then.
 */
export function WorkoutPreview({ exercises }: { exercises: WorkoutExerciseWithName[] }) {
  const [video, setVideo] = useState<{ url: string; title: string } | null>(null);

  return (
    <View style={[styles.card, shadows.card]}>
      {exercises.map((ex, i) => {
        const configs = Array.isArray(ex.set_configs) ? ex.set_configs : [];
        const setCount = configs.length || 1;
        const first = configs.length > 0 ? parseSetConfig(configs[0]) : undefined;
        const prescription = describeTarget(ex.mode, first);
        const name = ex.exercises?.name ?? ex.notes ?? "Exercise";
        const videoUrl = ex.exercises?.video_url ?? null;

        return (
          <View key={ex.id} style={[styles.row, i > 0 ? styles.rowBorder : undefined]}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{name}</Text>
              {videoUrl && <VideoButton onPress={() => setVideo({ url: videoUrl, title: name })} />}
            </View>
            <Text style={styles.prescription}>
              {setCount > 1 ? `${setCount} × ${prescription}` : prescription}
            </Text>
            {ex.exercises?.name && ex.notes?.trim() ? <Text style={styles.notes}>{ex.notes.trim()}</Text> : null}
          </View>
        );
      })}
      <VideoModal video={video} onClose={() => setVideo(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
  },
  row: {
    paddingVertical: spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
  },
  prescription: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
  },
  notes: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
    marginTop: 4,
  },
});
