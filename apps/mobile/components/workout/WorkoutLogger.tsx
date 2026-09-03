import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Linking, Modal } from "react-native";
import { Check, Play, X } from "lucide-react-native";
import { parseSetConfig, type ExerciseMode, type SetConfig, type WeightUnit } from "@momentum/shared";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";
import type { WorkoutExerciseWithName, ExerciseLogWithSets } from "../../lib/queries/useWorkoutDay";
import { useSaveWorkoutLog, type ExerciseLogInput, type SetLogInput } from "../../lib/queries/useSaveWorkoutLog";
import { useWorkoutDraft } from "../../lib/useWorkoutDraft";
import { computePace, formatDuration, formatMiles, formatPace, formatTargetWeight, parseDuration } from "./format";

/** How long after checking a set off to push it to the server. */
const AUTOSAVE_DEBOUNCE_MS = 2000;

interface WorkoutLoggerProps {
  clientId: string;
  date: string;
  workoutId: string;
  exercises: WorkoutExerciseWithName[];
  existingLog: ExerciseLogWithSets[] | undefined;
  /** workout_logs.updated_at — decides whether a stored draft is still newer. */
  logUpdatedAt?: string | null;
  previousLog: ExerciseLogWithSets[] | undefined;
  onComplete?: () => void;
}

interface SetDraft {
  setNumber: number;
  completed: boolean;
  reps?: number;
  weight?: number;
  /** True once the client types a weight — distinguishes a real lift from a bare check-off (P2). */
  weightEntered?: boolean;
  weightUnit?: WeightUnit;
  targetSeconds?: number;
  actualSeconds?: number;
  actualMiles?: number;
  /** This set's target at render time, snapshotted onto the log on save (P1). */
  prescribed?: SetConfig;
}

interface ExerciseDraft {
  exerciseId: string | null;
  exerciseName: string;
  mode: ExerciseMode;
  sortOrder: number;
  sets: SetDraft[];
}

function buildInitialDrafts(
  exercises: WorkoutExerciseWithName[],
  existingLog: ExerciseLogWithSets[] | undefined
): ExerciseDraft[] {
  return exercises.map((ex, exIdx) => {
    const configs = Array.isArray(ex.set_configs) ? ex.set_configs : [];
    const existing = existingLog?.find((e) => e.exercise_id === ex.exercise_id);
    const existingSets = existing?.set_logs ?? [];

    const setCount = Math.max(configs.length, existingSets.length, 1);

    const sets: SetDraft[] = Array.from({ length: setCount }, (_, i) => {
      const cfg = parseSetConfig(configs[i]);
      const existingSet = existingSets.find((s) => s.set_number === i + 1);
      return {
        setNumber: i + 1,
        completed: existingSet?.completed ?? false,
        reps: existingSet?.reps ?? undefined,
        // Never seed `weight` from the target (cfg.weight): a client who taps
        // the checkbox without typing would record the prescription as their
        // actual, making the two indistinguishable in the data. The target is
        // shown read-only in the TARGET column instead. See rules P2.
        weight: existingSet?.weight ?? undefined,
        weightEntered: existingSet?.weight_entered ?? false,
        weightUnit: existingSet?.weight_unit ?? cfg.weightUnit,
        targetSeconds: cfg.seconds,
        prescribed: cfg,
        actualSeconds: existingSet?.actual_seconds ?? undefined,
        actualMiles: existingSet?.actual_miles ?? undefined,
      };
    });

    return {
      exerciseId: ex.exercise_id,
      exerciseName: ex.exercises?.name ?? "Exercise",
      mode: ex.mode,
      sortOrder: ex.sort_order ?? exIdx,
      sets,
    };
  });
}

function getPrevSets(previousLog: ExerciseLogWithSets[] | undefined, exerciseId: string | null) {
  return previousLog?.find((e) => e.exercise_id === exerciseId)?.set_logs ?? [];
}

/**
 * Per-exercise set logger. Ported from mindful-miya's WorkoutLogger.tsx:
 * complete-all toggle per exercise, target/last-time/actual columns for
 * reps+weight mode, a distance-mode two-line layout with derived pace, and
 * Save progress / Complete ✓ actions. Writes go through useSaveWorkoutLog's
 * delete+reinsert-children upsert (plan finding #5).
 */
export function WorkoutLogger({
  clientId,
  date,
  workoutId,
  exercises,
  existingLog,
  logUpdatedAt,
  previousLog,
  onComplete,
}: WorkoutLoggerProps) {
  const [drafts, setDrafts] = useState<ExerciseDraft[]>(() => buildInitialDrafts(exercises, existingLog));
  const [videoModal, setVideoModal] = useState<{ url: string; title: string } | null>(null);
  const [dismissedRestore, setDismissedRestore] = useState(false);
  const saveWorkoutLog = useSaveWorkoutLog();

  const draft = useWorkoutDraft<ExerciseDraft[]>(clientId, date, workoutId, logUpdatedAt);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The debounced autosave fires later, from a closure created earlier. Going
  // through a ref means it always calls the current saveDrafts rather than a
  // stale one captured at scheduling time.
  const saveDraftsRef = useRef<((next: ExerciseDraft[], completed: boolean) => Promise<void>) | null>(null);

  // Adopt a restored draft once, after hydration. It only survives if it was
  // newer than the server's copy (see useWorkoutDraft).
  useEffect(() => {
    if (draft.hydrated && draft.restored) setDrafts(draft.restored);
  }, [draft.hydrated, draft.restored]);

  /**
   * Every edit persists locally so nothing is lost to a crash or a phone
   * call. Only checking a set off also schedules a server save: that is the
   * discrete "I did this" moment. Typing does not, so partially-entered
   * values ("13" on the way to "135") never reach the server.
   */
  const updateDrafts = useCallback(
    (next: ExerciseDraft[], opts?: { syncToServer?: boolean }) => {
      setDrafts(next);
      draft.save(next);

      if (!opts?.syncToServer) return;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void saveDraftsRef.current?.(next, false);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [draft]
  );

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const totalSets = drafts.reduce((acc, ex) => acc + ex.sets.length, 0);
  const completedSets = drafts.reduce((acc, ex) => acc + ex.sets.filter((s) => s.completed).length, 0);

  function toggleSet(exIdx: number, setIdx: number) {
    updateDrafts(
      drafts.map((ex, ei) =>
        ei !== exIdx
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, si) => (si !== setIdx ? s : { ...s, completed: !s.completed })),
            }
      ),
      { syncToServer: true }
    );
  }

  function toggleExercise(exIdx: number) {
    updateDrafts(
      drafts.map((ex, ei) => {
        if (ei !== exIdx) return ex;
        const shouldComplete = !ex.sets.every((s) => s.completed);
        return { ...ex, sets: ex.sets.map((s) => ({ ...s, completed: shouldComplete })) };
      }),
      { syncToServer: true }
    );
  }

  function updateSet(exIdx: number, setIdx: number, patch: Partial<SetDraft>) {
    // Local draft only — typing must not hit the network mid-keystroke.
    updateDrafts(
      drafts.map((ex, ei) =>
        ei !== exIdx ? ex : { ...ex, sets: ex.sets.map((s, si) => (si !== setIdx ? s : { ...s, ...patch })) }
      )
    );
  }

  async function saveDrafts(current: ExerciseDraft[], completed: boolean) {
    const exercisesInput: ExerciseLogInput[] = current.map((ex) => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      mode: ex.mode,
      sortOrder: ex.sortOrder,
      prescribed: ex.sets.map((s) => s.prescribed ?? {}),
      sets: ex.sets.map<SetLogInput>((s) => ({
        setNumber: s.setNumber,
        completed: s.completed,
        reps: s.reps,
        weight: s.weight,
        weightEntered: s.weightEntered ?? false,
        weightUnit: s.weightUnit,
        targetSeconds: s.targetSeconds,
        actualSeconds: s.actualSeconds,
        actualMiles: s.actualMiles,
        prescribed: s.prescribed,
      })),
    }));

    await saveWorkoutLog.mutateAsync({
      clientId,
      date,
      workoutId,
      exercises: exercisesInput,
      completed,
    });

    // Only drop the local draft once the server has confirmed the write.
    draft.clear();
    if (completed) onComplete?.();
  }

  saveDraftsRef.current = saveDrafts;

  async function handleComplete() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    await saveDrafts(drafts, true);
  }

  const saving = saveWorkoutLog.isPending;

  return (
    <View>
      {draft.didRestore && !dismissedRestore && (
        <View style={styles.restoreBanner}>
          <Text style={styles.restoreText}>Restored your unsaved progress</Text>
          <TouchableOpacity
            onPress={() => setDismissedRestore(true)}
            accessibilityLabel="Dismiss restored progress notice"
            hitSlop={8}
          >
            <X color={colors.ink50} size={14} />
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.card, shadows.card]}>
        {drafts.map((ex, exIdx) => {
          const workoutEx = exercises[exIdx];
          const mode = ex.mode;
          const prevSets = getPrevSets(previousLog, ex.exerciseId);
          const allDone = ex.sets.every((s) => s.completed);
          const videoUrl = workoutEx?.exercises?.video_url ?? null;
          const configs = Array.isArray(workoutEx?.set_configs) ? workoutEx.set_configs : [];

          return (
            <View
              key={`${ex.exerciseId ?? "custom"}-${exIdx}`}
              style={[styles.exerciseBlock, exIdx < drafts.length - 1 ? styles.exerciseBlockBorder : undefined]}
            >
              <View style={styles.exerciseHeaderRow}>
                <View style={styles.exerciseHeaderLeft}>
                  <TouchableOpacity
                    onPress={() => toggleExercise(exIdx)}
                    accessibilityLabel={`${allDone ? "Clear" : "Complete"} all sets for ${ex.exerciseName}`}
                    style={[
                      styles.exerciseToggle,
                      {
                        backgroundColor: allDone ? colors.blueDeep : colors.paper,
                        borderColor: allDone ? colors.blueDeep : colors.line2,
                      },
                    ]}
                  >
                    {allDone && <Check color="#fff" size={13} strokeWidth={3} />}
                  </TouchableOpacity>
                  <Text style={styles.exerciseName}>{ex.exerciseName}</Text>
                </View>
                {videoUrl && (
                  <TouchableOpacity
                    onPress={() => setVideoModal({ url: videoUrl, title: ex.exerciseName })}
                    style={styles.videoButton}
                  >
                    <Play color={colors.blueDeep} size={12} fill={colors.blueDeep} />
                    <Text style={styles.videoButtonText}>VIDEO</Text>
                  </TouchableOpacity>
                )}
              </View>

              {mode !== "distance" && (
                <View style={styles.columnHeaderRow}>
                  <View style={styles.checkboxColumnWidth} />
                  <Text style={styles.columnLabel}>{mode === "time" ? "TIME" : "REPS"}</Text>
                  <Text style={styles.columnLabel}>TARGET</Text>
                  <Text style={styles.columnLabel}>LAST</Text>
                  <Text style={styles.columnLabel}>ACTUAL</Text>
                </View>
              )}

              {ex.sets.map((set, setIdx) => {
                const prevSet = prevSets[setIdx];
                const targetCfg = parseSetConfig(configs[setIdx]);

                const checkbox = (
                  <TouchableOpacity
                    onPress={() => toggleSet(exIdx, setIdx)}
                    accessibilityLabel={`${set.completed ? "Clear" : "Complete"} set ${setIdx + 1} of ${ex.exerciseName}`}
                    style={[
                      styles.setCheckbox,
                      {
                        backgroundColor: set.completed ? colors.blueDeep : "transparent",
                        borderColor: set.completed ? colors.blueDeep : colors.line2,
                      },
                    ]}
                  >
                    {set.completed && <Check color="#fff" size={12} strokeWidth={3} />}
                  </TouchableOpacity>
                );

                if (mode === "distance") {
                  const prevPace = computePace(prevSet?.actual_miles, prevSet?.actual_seconds);
                  const livePace = computePace(set.actualMiles, set.actualSeconds);
                  return (
                    <View
                      key={setIdx}
                      style={[styles.distanceRow, setIdx > 0 ? styles.distanceRowBorder : undefined]}
                    >
                      <View style={styles.distanceHeaderRow}>
                        {checkbox}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.distanceTarget}>
                            {formatMiles(targetCfg.miles)}
                            {targetCfg.paceSeconds != null ? ` · target ${formatPace(targetCfg.paceSeconds)}/mi` : ""}
                          </Text>
                          {prevPace != null && (
                            <Text style={styles.distanceLast}>last {formatPace(prevPace)}/mi</Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.distanceInputsRow}>
                        <View style={styles.distanceInputColumn}>
                          <Text style={styles.columnLabel}>MILES</Text>
                          <TextInput
                            keyboardType="decimal-pad"
                            placeholder="—"
                            placeholderTextColor={colors.ink30}
                            value={set.actualMiles != null ? String(set.actualMiles) : ""}
                            onChangeText={(text) =>
                              updateSet(exIdx, setIdx, { actualMiles: text === "" ? undefined : Number(text) })
                            }
                            style={styles.textInput}
                          />
                        </View>
                        <View style={styles.distanceInputColumn}>
                          <Text style={styles.columnLabel}>TIME</Text>
                          <TimeInput
                            value={set.actualSeconds}
                            onChange={(actualSeconds) => updateSet(exIdx, setIdx, { actualSeconds })}
                          />
                        </View>
                        <Text style={styles.distancePace}>
                          {livePace != null ? `→ ${formatPace(livePace)}/mi` : "—"}
                        </Text>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={setIdx} style={styles.setRow}>
                    {checkbox}
                    <Text style={styles.setTargetText}>
                      {mode === "time" ? formatDuration(set.targetSeconds) : (set.reps ?? targetCfg.reps ?? "—")}
                    </Text>
                    <Text style={styles.setTargetText}>{formatTargetWeight(targetCfg)}</Text>
                    <Text style={styles.setLastText}>{prevSet?.weight != null ? `${prevSet.weight}` : "—"}</Text>
                    {mode === "time" ? (
                      <TimeInput
                        value={set.actualSeconds}
                        onChange={(actualSeconds) => updateSet(exIdx, setIdx, { actualSeconds })}
                      />
                    ) : (
                      <TextInput
                        keyboardType="number-pad"
                        placeholder="—"
                        placeholderTextColor={colors.ink30}
                        value={set.weight != null ? String(set.weight) : ""}
                        onChangeText={(text) =>
                          updateSet(exIdx, setIdx, {
                            weight: text === "" ? undefined : Number(text),
                            // Typing is what makes a weight the client's own.
                            weightEntered: text !== "",
                          })
                        }
                        style={styles.textInput}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : "0%" },
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {completedSets}/{totalSets} sets done
      </Text>

      {/* No "Save progress" button: every set you check off saves itself, so
          there is nothing for the client to remember to do. Complete is the
          only explicit action left. */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={() => void handleComplete()}
          disabled={saving || completedSets < totalSets}
          style={[
            styles.completeButton,
            saving || completedSets < totalSets ? styles.buttonDisabled : undefined,
          ]}
        >
          <Text style={styles.completeButtonText}>{saving ? "Saving…" : "Complete ✓"}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={videoModal != null} animationType="slide" onRequestClose={() => setVideoModal(null)}>
        <View style={styles.videoModalContainer}>
          <TouchableOpacity style={styles.videoModalClose} onPress={() => setVideoModal(null)}>
            <X color={colors.ink} size={22} />
          </TouchableOpacity>
          <Text style={styles.videoModalTitle}>{videoModal?.title}</Text>
          <TouchableOpacity
            style={styles.videoModalOpenButton}
            onPress={() => {
              if (videoModal?.url) void Linking.openURL(videoModal.url);
            }}
          >
            <Text style={styles.videoModalOpenButtonText}>Open video</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Elapsed-time entry accepting "24:30" or bare seconds. Holds the raw string
 * while typing so a half-entered "24:" isn't clobbered; normalizes on blur.
 */
function TimeInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
}) {
  const [raw, setRaw] = useState(value != null ? formatDuration(value) : "");

  const displayValue = useMemo(() => (value != null ? formatDuration(value) : ""), [value]);

  return (
    <TextInput
      keyboardType="numbers-and-punctuation"
      placeholder="24:30"
      placeholderTextColor={colors.ink30}
      value={raw || displayValue}
      onChangeText={setRaw}
      onFocus={() => setRaw(displayValue)}
      onBlur={() => {
        const parsed = parseDuration(raw.replace(/s$/i, ""));
        onChange(parsed);
        setRaw("");
      }}
      style={styles.textInput}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: "hidden",
  },
  exerciseBlock: {
    padding: spacing.lg,
  },
  exerciseBlockBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  exerciseHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  exerciseHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    minWidth: 0,
  },
  exerciseToggle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseName: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
    flexShrink: 1,
  },
  videoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  videoButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.blueDeep,
    letterSpacing: 0.6,
  },
  columnHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  checkboxColumnWidth: {
    width: 34,
  },
  columnLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    color: colors.ink50,
    letterSpacing: 1,
    flex: 1,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 7,
  },
  setCheckbox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  setTargetText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink70,
    flex: 1,
  },
  setLastText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    fontStyle: "italic",
    flex: 1,
  },
  textInput: {
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 8,
    fontSize: 13,
    fontFamily: fonts.display,
    color: colors.ink,
    flex: 1,
  },
  distanceRow: {
    marginTop: 10,
    paddingTop: 10,
  },
  distanceRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
    borderStyle: "dashed",
  },
  distanceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  distanceTarget: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink70,
  },
  distanceLast: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    fontStyle: "italic",
  },
  distanceInputsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: 40,
  },
  distanceInputColumn: {
    flex: 1,
  },
  distancePace: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
    paddingBottom: 8,
    minWidth: 74,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.creamDeep,
    marginTop: spacing.lg,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.blueDeep,
    borderRadius: 2,
  },
  progressLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    marginTop: 5,
    textAlign: "center",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  restoreBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.cream,
  },
  restoreText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
  },
  completeButton: {
    flex: 1,
    height: 50,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  completeButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: "#fff",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  videoModalContainer: {
    flex: 1,
    backgroundColor: colors.cream,
    padding: spacing.xl,
    paddingTop: 64,
  },
  videoModalClose: {
    alignSelf: "flex-end",
    padding: spacing.sm,
  },
  videoModalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: spacing.lg,
  },
  videoModalOpenButton: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: 18,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  videoModalOpenButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: "#fff",
  },
});
