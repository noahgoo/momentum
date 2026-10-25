import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from "react-native";
import { Check, Play, X } from "lucide-react-native";
import {
  computePace,
  describeTarget,
  digitsFromSeconds,
  digitsFromText,
  distanceUnitLabel,
  exerciseBadges,
  formatDuration,
  formatPace,
  formatWeight,
  maskDigits,
  paceSuffix,
  parseDecimal,
  secondsFromDigits,
  weightUnitLabel,
  parseSetConfig,
  type DistanceUnit,
  type ExerciseMode,
  type SetConfig,
  type WeightUnit,
} from "@momentum/shared";
import { colors, fonts, radii, spacing, shadows } from "../../theme/tokens";
import type { WorkoutExerciseWithName, ExerciseLogWithSets } from "../../lib/queries/useWorkoutDay";
import { useSaveWorkoutLog, type ExerciseLogInput, type SetLogInput } from "../../lib/queries/useSaveWorkoutLog";
import { useWorkoutDraft } from "../../lib/useWorkoutDraft";
import { VideoModal } from "./VideoModal";
import {
  lastWeightsForExercise,
  resolvedSetConfig,
  type LastSetWeights,
} from "./resolveTargetWeight";

/** How long after checking a set off to push it to the server. */
const AUTOSAVE_DEBOUNCE_MS = 2000;

interface WorkoutLoggerProps {
  clientId: string;
  date: string;
  sessionId: string;
  exercises: WorkoutExerciseWithName[];
  existingLog: ExerciseLogWithSets[] | undefined;
  /** workout_logs.updated_at — decides whether a stored draft is still newer. */
  logUpdatedAt?: string | null;
  previousLog: ExerciseLogWithSets[] | undefined;
  /** Per-exercise last logged weights, for resolving "+N from last" targets. */
  lastSetWeights: LastSetWeights;
  /**
   * The client's unit preferences. They only fill in when a set has no
   * prescribed unit of its own; a prescription's unit always wins.
   */
  preferredWeightUnit?: WeightUnit;
  preferredDistanceUnit?: DistanceUnit;
  onComplete?: () => void;
}

type AutofillField = "reps" | "weight" | "actualSeconds" | "actualDistance";

interface SetDraft {
  setNumber: number;
  completed: boolean;
  /** Actual reps the client did. Empty means "not entered", never "the target" (P2). */
  reps?: number;
  weight?: number;
  /** True once the client types a weight — distinguishes a real lift from a bare check-off (P2). */
  weightEntered?: boolean;
  /** Unit the weight is in: the prescription's, else the client's preference. */
  weightUnit?: WeightUnit;
  targetSeconds?: number;
  actualSeconds?: number;
  actualDistance?: number;
  /** Unit the distance is in: the prescription's, else the client's preference. */
  distanceUnit?: DistanceUnit;
  /** Fields filled from the target on check-off and not touched since; un-checking clears them. */
  autofilled?: AutofillField[];
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
  existingLog: ExerciseLogWithSets[] | undefined,
  lastSetWeights: LastSetWeights,
  preferredWeightUnit: WeightUnit,
  preferredDistanceUnit: DistanceUnit
): ExerciseDraft[] {
  return exercises.map((ex, exIdx) => {
    const configs = Array.isArray(ex.set_configs) ? ex.set_configs : [];
    const existing = existingLog?.find((e) => e.exercise_id === ex.exercise_id);
    const existingSets = existing?.set_logs ?? [];
    const lastForExercise = lastWeightsForExercise(lastSetWeights, ex.exercise_id);

    const setCount = Math.max(configs.length, existingSets.length, 1);

    const sets: SetDraft[] = Array.from({ length: setCount }, (_, i) => {
      // Resolve "+N from last" into the concrete number the client is being
      // asked for, so the snapshot below records a fact rather than a rule
      // (P1). Prior weights are keyed by set NUMBER, not array index (P3).
      const cfg = resolvedSetConfig(parseSetConfig(configs[i]), lastForExercise?.[String(i + 1)]);
      const existingSet = existingSets.find((s) => s.set_number === i + 1);
      return {
        setNumber: i + 1,
        completed: existingSet?.completed ?? false,
        reps: existingSet?.reps ?? undefined,
        // Never seed `weight` from the target (cfg.weight): a client who taps
        // the checkbox without typing would record the prescription as their
        // actual, making the two indistinguishable in the data. The target is
        // shown as ghost text in the empty input instead. See rules P2.
        weight: existingSet?.weight ?? undefined,
        weightEntered: existingSet?.weight_entered ?? false,
        weightUnit: existingSet?.weight_unit ?? cfg.weightUnit ?? preferredWeightUnit,
        targetSeconds: cfg.seconds,
        prescribed: cfg,
        actualSeconds: existingSet?.actual_seconds ?? undefined,
        actualDistance: existingSet?.actual_distance ?? undefined,
        distanceUnit: existingSet?.distance_unit ?? cfg.distanceUnit ?? preferredDistanceUnit,
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

/**
 * Checking a set off with a field left empty means "did it as prescribed", so
 * the target becomes the actual. `weightEntered` is deliberately left alone: it
 * stays false for a filled-in weight, which is how a typed lift is still told
 * apart from a check-off (P2).
 */
function fillEmptyFromTarget(set: SetDraft, mode: ExerciseMode): SetDraft {
  const t = set.prescribed;
  if (!t) return set;
  const wanted: [AutofillField, number | undefined][] = [
    ["reps", mode === "reps" ? t.reps : undefined],
    ["actualSeconds", mode === "time" || mode === "distance" ? t.seconds : undefined],
    ["actualDistance", mode === "distance" ? t.distance : undefined],
    ["weight", mode !== "distance" ? t.weight : undefined],
  ];
  const next = { ...set };
  const filled = new Set(set.autofilled);
  for (const [field, value] of wanted) {
    if (next[field] == null && value != null) {
      next[field] = value;
      filled.add(field);
    }
  }
  return filled.size > 0 ? { ...next, autofilled: [...filled] } : next;
}

/** Undoes fillEmptyFromTarget: fields the client never touched go back to empty. */
function clearAutofilled(set: SetDraft): SetDraft {
  if (!set.autofilled?.length) return set;
  const next = { ...set, autofilled: undefined };
  for (const field of set.autofilled) next[field] = undefined;
  return next;
}

function getPrevSets(previousLog: ExerciseLogWithSets[] | undefined, exerciseId: string | null) {
  return previousLog?.find((e) => e.exercise_id === exerciseId)?.set_logs ?? [];
}

/** "10 × 25 lb" / "0:45" / "3 mi in 24:30" for the last time this set was done. Undefined when there is nothing to show. */
function describeLast(
  mode: ExerciseMode,
  prev: ExerciseLogWithSets["set_logs"][number] | undefined
): string | undefined {
  if (!prev) return undefined;
  if (mode === "time") return prev.actual_seconds != null ? formatDuration(prev.actual_seconds) : undefined;
  if (mode === "distance") {
    if (prev.actual_distance == null) return undefined;
    const dist = `${prev.actual_distance} ${distanceUnitLabel(prev.distance_unit)}`;
    return prev.actual_seconds != null ? `${dist} in ${formatDuration(prev.actual_seconds)}` : dist;
  }
  if (prev.reps == null && prev.weight == null) return undefined;
  const reps = prev.reps != null ? `${prev.reps}` : "—";
  return prev.weight != null ? `${reps} × ${formatWeight(prev.weight, prev.weight_unit)}` : `${reps} reps`;
}

/**
 * Per-exercise set logger. Each exercise shows what its numbers MEAN up top
 * (each hand / total / bodyweight, each side, max effort, the coach's cue and
 * rest), then one row per set: the target in plain words, last time's result,
 * and inputs for what the client actually did. Targets only ever appear as
 * ghost text — inputs start empty (P2). Writes go through useSaveWorkoutLog's
 * delete+reinsert-children upsert (plan finding #5).
 */
export function WorkoutLogger({
  clientId,
  date,
  sessionId,
  exercises,
  existingLog,
  logUpdatedAt,
  previousLog,
  lastSetWeights,
  preferredWeightUnit = "lbs",
  preferredDistanceUnit = "mi",
  onComplete,
}: WorkoutLoggerProps) {
  const [drafts, setDrafts] = useState<ExerciseDraft[]>(() =>
    buildInitialDrafts(exercises, existingLog, lastSetWeights, preferredWeightUnit, preferredDistanceUnit)
  );
  const [videoModal, setVideoModal] = useState<{ url: string; title: string } | null>(null);
  const [dismissedRestore, setDismissedRestore] = useState(false);
  const saveWorkoutLog = useSaveWorkoutLog();

  const draft = useWorkoutDraft<ExerciseDraft[]>(clientId, date, sessionId, logUpdatedAt);
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
              sets: ex.sets.map((s, si) => {
                if (si !== setIdx) return s;
                const completed = !s.completed;
                return { ...(completed ? fillEmptyFromTarget(s, ex.mode) : clearAutofilled(s)), completed };
              }),
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
        return {
          ...ex,
          sets: ex.sets.map((s) => ({
            ...(shouldComplete ? (s.completed ? s : fillEmptyFromTarget(s, ex.mode)) : clearAutofilled(s)),
            completed: shouldComplete,
          })),
        };
      }),
      { syncToServer: true }
    );
  }

  function updateSet(exIdx: number, setIdx: number, patch: Partial<SetDraft>) {
    // Local draft only — typing must not hit the network mid-keystroke.
    updateDrafts(
      drafts.map((ex, ei) =>
        ei !== exIdx
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, si) => {
                if (si !== setIdx) return s;
                // Typing over an autofilled field makes it the client's own.
                const autofilled = s.autofilled?.filter((f) => !(f in patch));
                return { ...s, ...patch, autofilled: autofilled?.length ? autofilled : undefined };
              }),
            }
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
        actualDistance: s.actualDistance,
        // A distance is meaningless without its unit (P6); the DB refuses one without.
        distanceUnit: s.actualDistance != null ? s.distanceUnit : undefined,
        prescribed: s.prescribed,
      })),
    }));

    await saveWorkoutLog.mutateAsync({
      clientId,
      date,
      sessionId,
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
          const badges = exerciseBadges(ex.sets.map((s) => s.prescribed));
          const note = workoutEx?.notes?.trim();
          const rest = workoutEx?.rest_seconds;
          // Bodyweight work has no load to enter; everything else does.
          const showWeight =
            mode === "reps" && !ex.sets.every((s) => s.prescribed?.loadType === "bodyweight");
          const weightCaption = ex.sets.some((s) => s.prescribed?.loadType === "assisted")
            ? "ASSIST"
            : ex.sets.some((s) => s.prescribed?.loadType === "bodyweight_plus")
              ? "+ ADDED"
              : "WEIGHT";

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

              {(badges.length > 0 || rest != null) && (
                <View style={styles.badgeRow}>
                  {badges.map((b) => (
                    <View key={b} style={styles.badge}>
                      <Text style={styles.badgeText}>{b}</Text>
                    </View>
                  ))}
                  {rest != null && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>REST {formatDuration(rest).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              )}
              {note ? <Text style={styles.cue}>{note}</Text> : null}

              {mode !== "distance" && (
                <View style={styles.captionRow}>
                  {mode === "reps" && <Text style={[styles.caption, styles.repsInputWidth]}>REPS</Text>}
                  {showWeight && <Text style={[styles.caption, styles.weightInputWidth]}>{weightCaption}</Text>}
                  {mode === "time" && <Text style={[styles.caption, styles.timeInputWidth]}>TIME</Text>}
                </View>
              )}

              {ex.sets.map((set, setIdx) => {
                // By set_number, never by array position: a coach inserting or
                // deleting a set would otherwise silently reassign every
                // prior weight in this column (P3).
                const prevSet = prevSets.find((p) => p.set_number === setIdx + 1);
                // The draft's own snapshot, already resolved in
                // buildInitialDrafts — NOT a fresh parse of the live config,
                // which would show "+5" as a blank instead of a number.
                const targetCfg: SetConfig = set.prescribed ?? {};
                const last = describeLast(mode, prevSet);
                const distanceUnit = set.distanceUnit ?? preferredDistanceUnit;
                const weightUnit = set.weightUnit ?? preferredWeightUnit;

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

                const targetBlock = (
                  <View style={styles.targetBlock}>
                    <Text style={styles.setLabel}>SET {setIdx + 1}</Text>
                    <Text style={styles.setTargetText}>{describeTarget(mode, targetCfg)}</Text>
                    {last ? <Text style={styles.setLastText}>Last: {last}</Text> : null}
                  </View>
                );

                if (mode === "distance") {
                  const livePace = computePace(set.actualDistance, set.actualSeconds);
                  return (
                    <View
                      key={setIdx}
                      style={[styles.distanceRow, setIdx > 0 ? styles.distanceRowBorder : undefined]}
                    >
                      <View style={styles.distanceHeaderRow}>
                        {checkbox}
                        {targetBlock}
                      </View>
                      <View style={styles.distanceInputsRow}>
                        <View style={styles.distanceInputColumn}>
                          <Text style={styles.caption}>DISTANCE</Text>
                          <NumberField
                            value={set.actualDistance}
                            onChange={(actualDistance) => updateSet(exIdx, setIdx, { actualDistance })}
                            unit={distanceUnitLabel(distanceUnit)}
                            placeholder={targetCfg.distance != null ? String(targetCfg.distance) : "—"}
                            accessibilityLabel={`Distance for set ${setIdx + 1}`}
                          />
                        </View>
                        <View style={styles.distanceInputColumn}>
                          <Text style={styles.caption}>TIME</Text>
                          <TimeField
                            value={set.actualSeconds}
                            onChange={(actualSeconds) => updateSet(exIdx, setIdx, { actualSeconds })}
                            accessibilityLabel={`Time for set ${setIdx + 1}`}
                          />
                        </View>
                        <Text style={styles.distancePace}>
                          {livePace != null ? `→ ${formatPace(livePace)}${paceSuffix(distanceUnit)}` : "—"}
                        </Text>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={setIdx} style={styles.setRow}>
                    {checkbox}
                    {targetBlock}
                    {mode === "time" ? (
                      <TimeField
                        value={set.actualSeconds}
                        onChange={(actualSeconds) => updateSet(exIdx, setIdx, { actualSeconds })}
                        placeholder={targetCfg.seconds != null ? maskDigits(digitsFromSeconds(targetCfg.seconds)) : undefined}
                        style={styles.timeInputWidth}
                        accessibilityLabel={`Time for set ${setIdx + 1}`}
                      />
                    ) : (
                      <>
                        <NumberField
                          integer
                          value={set.reps}
                          onChange={(reps) => updateSet(exIdx, setIdx, { reps })}
                          placeholder={targetCfg.reps != null ? String(targetCfg.reps) : "—"}
                          style={styles.repsInputWidth}
                          accessibilityLabel={`Reps for set ${setIdx + 1}`}
                        />
                        {showWeight && (
                          <NumberField
                            value={set.weight}
                            onChange={(weight) =>
                              // Typing is what makes a weight the client's own.
                              updateSet(exIdx, setIdx, { weight, weightEntered: weight !== undefined })
                            }
                            unit={weightUnitLabel(weightUnit)}
                            placeholder={targetCfg.weight != null ? String(targetCfg.weight) : "—"}
                            style={styles.weightInputWidth}
                            accessibilityLabel={`Weight for set ${setIdx + 1}`}
                          />
                        )}
                      </>
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

      <VideoModal video={videoModal} onClose={() => setVideoModal(null)} />
    </View>
  );
}

/**
 * Decimal/integer entry that keeps what the client is typing. The raw text
 * lives here so "22." on the way to "22.5" isn't snapped back to "22"; the
 * parsed number goes up only when it is a real one (never NaN — P5). A change
 * from outside (a restored draft) replaces the text.
 */
function NumberField({
  value,
  onChange,
  unit,
  placeholder,
  integer,
  style,
  accessibilityLabel,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  unit?: string;
  placeholder?: string;
  integer?: boolean;
  style?: object;
  accessibilityLabel?: string;
}) {
  const [raw, setRaw] = useState(value != null ? String(value) : "");

  useEffect(() => {
    if (parseDecimal(raw) !== value) setRaw(value != null ? String(value) : "");
    // Deliberately keyed on `value` alone: only an outside change should reset the text.
  }, [value]);

  return (
    <View style={[styles.fieldWrap, style]}>
      <TextInput
        keyboardType={integer ? "number-pad" : "decimal-pad"}
        placeholder={placeholder}
        placeholderTextColor={colors.ink30}
        value={raw}
        onChangeText={(text) => {
          const cleaned = integer ? text.replace(/\D/g, "") : text;
          setRaw(cleaned);
          onChange(cleaned === "" ? undefined : parseDecimal(cleaned));
        }}
        accessibilityLabel={accessibilityLabel}
        style={[styles.textInput, unit ? styles.textInputWithUnit : undefined]}
      />
      {unit ? (
        <Text pointerEvents="none" style={styles.unitText}>
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Elapsed-time entry that fills in from the right like a timer: type 2-4-3-0
 * and it reads 24:30. "30" is always 0:30 and half an hour is 3-0-0-0, so
 * there is no guessing whether a bare number means seconds or minutes. The
 * field is controlled, so backspacing to empty really clears it.
 */
function TimeField({
  value,
  onChange,
  placeholder,
  style,
  accessibilityLabel,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
  placeholder?: string;
  style?: object;
  accessibilityLabel?: string;
}) {
  const [digits, setDigits] = useState(digitsFromSeconds(value));

  useEffect(() => {
    if (secondsFromDigits(digits) !== value) setDigits(digitsFromSeconds(value));
    // Deliberately keyed on `value` alone: only an outside change should reset the digits.
  }, [value]);

  return (
    <View style={[styles.fieldWrap, style]}>
      <TextInput
        keyboardType="number-pad"
        placeholder={placeholder ?? "0:00"}
        placeholderTextColor={colors.ink30}
        value={maskDigits(digits)}
        onChangeText={(text) => {
          const next = digitsFromText(text);
          setDigits(next);
          onChange(secondsFromDigits(next));
        }}
        accessibilityLabel={accessibilityLabel}
        style={styles.textInput}
      />
    </View>
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
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: colors.creamDeep,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.ink70,
  },
  cue: {
    fontFamily: fonts.body,
    fontSize: 12,
    fontStyle: "italic",
    color: colors.ink70,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  captionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  caption: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    color: colors.ink50,
    letterSpacing: 1,
  },
  repsInputWidth: {
    width: 56,
  },
  weightInputWidth: {
    width: 92,
  },
  timeInputWidth: {
    width: 96,
  },
  targetBlock: {
    flex: 1,
    minWidth: 0,
  },
  setLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 9,
    color: colors.ink50,
    letterSpacing: 1,
  },
  fieldWrap: {
    justifyContent: "center",
  },
  textInputWithUnit: {
    paddingRight: 30,
  },
  unitText: {
    position: "absolute",
    right: 8,
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
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
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
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
    color: colors.ink,
    marginTop: 1,
  },
  setLastText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    fontStyle: "italic",
    marginTop: 1,
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
});
