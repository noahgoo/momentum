import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronDown, ChevronLeft, Clock3 } from "lucide-react-native";
import {
  describeScheduleMoveError,
  type MovableDay,
  type PendingMove,
  type RequestScheduleMovesResult,
} from "@momentum/shared";
import { useAuth } from "../../../lib/auth";
import { useTabBarSpace } from "../../../components/PillTabBar";
import { useDraft } from "../../../lib/useDraft";
import { splitMissedByWeek, suggestTargets } from "../../../lib/moveSuggestions";
import { randomUuid } from "../../../lib/uuid";
import {
  useCancelScheduleMoves,
  useMovableDays,
  useRequestScheduleMoves,
  useRequestScheduleSwap,
} from "../../../lib/queries/useScheduleMoves";
import { colors, fonts, radii, spacing } from "../../../theme/tokens";

/** Midday, not midnight: see WeekGrid.dateLabel. */
function shortDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

interface MoveDraft {
  /** from date -> chosen target date. A date being a key IS its selection. */
  targets: Record<string, string>;
}

/**
 * Move several workouts at once, including ones the client missed.
 *
 * Everything the screen offers comes from one get_movable_days call, resolved
 * in SQL against the client's own today. What the client picks is kept as a
 * local draft (S1) until the server has the request, so backing out or a crash
 * does not lose a selection.
 *
 * Whether a move needs the coach is the coach's per-client setting; this
 * screen reports what the server actually did rather than assuming.
 */
export default function RescheduleScreen() {
  const tabBarSpace = useTabBarSpace();
  const { session, profile } = useAuth();
  const uid = session?.user.id;
  const { date: preselect } = useLocalSearchParams<{ date?: string }>();

  const { data, isPending, isError, refetch } = useMovableDays(uid);
  const request = useRequestScheduleMoves(uid);
  const requestSwap = useRequestScheduleSwap(uid);
  const cancel = useCancelScheduleMoves(uid);

  const draft = useDraft<MoveDraft>(uid ? `moveDraft:${uid}` : null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<RequestScheduleMovesResult | null>(null);
  const [restoredNote, setRestoredNote] = useState(false);
  // One id per submission attempt, kept across retries so the server can
  // recognise a double tap or a retry (C4). Reset only once a request lands.
  const batchId = useRef<string>(randomUuid());
  // Swaps are filed one by one; each keeps its own id across retries for the same reason.
  const swapBatchIds = useRef<Record<string, string>>({});
  const seeded = useRef(false);

  const missed = data?.missed ?? [];
  const upcoming = data?.upcoming ?? [];
  const restDays = data?.rest_days ?? [];
  const today = data?.today ?? "";
  const { thisWeek: missedThisWeek, older: missedOlder } = splitMissedByWeek(missed, today);
  const [showOlder, setShowOlder] = useState(false);
  // A selection must never sit hidden: open the older group when it holds one.
  const olderHasSelection = missedOlder.some((d) => targets[d.date] !== undefined);

  // Seed once, when both the draft and the server's data are in: a restored
  // selection (minus anything the server no longer offers), or the date the
  // client arrived from.
  useEffect(() => {
    if (seeded.current || !draft.hydrated || !data) return;
    seeded.current = true;

    const movable = new Set([...data.missed, ...data.upcoming].map((d) => d.date));
    // A target is either a free rest day or another upcoming workout (a swap).
    const free = new Set([...data.rest_days, ...data.upcoming.map((d) => d.date)]);
    const kept: Record<string, string> = {};
    for (const [from, to] of Object.entries(draft.restored?.targets ?? {})) {
      if (movable.has(from) && free.has(to)) kept[from] = to;
    }

    if (Object.keys(kept).length > 0) {
      setTargets(kept);
      setRestoredNote(true);
    } else if (preselect && movable.has(preselect)) {
      setTargets(suggestTargets([preselect], data.rest_days, data.today));
    }
  }, [draft.hydrated, draft.restored, data, preselect]);

  function update(next: Record<string, string>) {
    setTargets(next);
    setRestoredNote(false);
    if (Object.keys(next).length > 0) draft.save({ targets: next });
    else draft.clear();
  }

  function toggle(day: MovableDay) {
    // This day is another workout's swap partner; picking it up too would ask for it twice.
    if (Object.values(targets).includes(day.date)) return;
    if (targets[day.date]) {
      const next = { ...targets };
      delete next[day.date];
      update(next);
      return;
    }
    update({ ...targets, ...suggestTargets([day.date], restDays, today, targets) });
  }

  function pickTarget(from: string, to: string) {
    update({ ...targets, [from]: to });
  }

  const selected = Object.keys(targets).sort();
  const unplaced = useMemo(
    () => [...missed, ...upcoming].filter((d) => targets[d.date] === undefined).length,
    [missed, upcoming, targets]
  );
  const auto = profile?.move_approval === "auto";
  const sending = request.isPending || requestSwap.isPending;

  /**
   * Other upcoming workouts this one could trade places with. Missed days can
   * only move forward, so they never offer a swap. A day already picked up to
   * move, or already someone else's partner, is not offered.
   */
  function swapChoicesFor(day: MovableDay, missedDay: boolean): MovableDay[] {
    if (missedDay) return [];
    const partners = Object.values(targets);
    return upcoming.filter(
      (d) =>
        d.date !== day.date &&
        targets[d.date] === undefined &&
        (!partners.includes(d.date) || targets[day.date] === d.date)
    );
  }

  async function send() {
    if (selected.length === 0) return;
    const upcomingDates = new Set(upcoming.map((d) => d.date));
    // A target that is itself a workout day is a swap; a rest day is a move.
    const swaps = selected.filter((from) => upcomingDates.has(targets[from]!));
    const moves = selected.filter((from) => !upcomingDates.has(targets[from]!));
    try {
      const results: RequestScheduleMovesResult[] = [];
      let filed = 0;
      let applied = 0;
      if (moves.length > 0) {
        const r = await request.mutateAsync({
          batchId: batchId.current,
          moves: moves.map((from) => ({ fromDate: from, toDate: targets[from]! })),
        });
        results.push(r);
        filed += r.filed ?? 0;
        applied += r.applied ?? 0;
      }
      for (const from of swaps) {
        const key = `${from}|${targets[from]}`;
        swapBatchIds.current[key] ??= randomUuid();
        const r = await requestSwap.mutateAsync({
          batchId: swapBatchIds.current[key]!,
          dateA: from,
          dateB: targets[from]!,
        });
        results.push(r);
        // A swap is two rows but one request to the client.
        filed += r.duplicate ? 0 : 1;
        applied += r.applied ? 1 : 0;
      }
      setOutcome({
        batch_id: batchId.current,
        duplicate: false,
        filed,
        applied,
        auto_applied: results.some((r) => r.auto_applied),
        skipped: results.flatMap((r) => r.skipped ?? []),
      });
      draft.clear();
      setTargets({});
      batchId.current = randomUuid();
      swapBatchIds.current = {};
    } catch {
      // The error is shown from request.error / requestSwap.error; the draft
      // and batch ids stay so the client can fix the selection and send again.
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/workout");
  }

  if (outcome) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}>
          <View style={styles.resultCard}>
            <Check color={colors.ok} size={22} />
            <Text style={styles.resultTitle}>
              {outcome.auto_applied
                ? `Moved ${outcome.applied ?? 0} workout${outcome.applied === 1 ? "" : "s"}`
                : `Sent ${outcome.filed ?? 0} to your coach`}
            </Text>
            <Text style={styles.resultBody}>
              {outcome.auto_applied
                ? "Your schedule is updated."
                : "They will show on your week as pending until your coach decides."}
            </Text>
            {(outcome.skipped ?? []).map((s) => (
              <Text key={s.id ?? s.reason} style={styles.resultSkipped}>
                {describeScheduleMoveError(s.reason)}
              </Text>
            ))}
          </View>
          <TouchableOpacity onPress={goBack} style={styles.primary}>
            <Text style={styles.primaryText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 140 }]}>
        <TouchableOpacity onPress={goBack} style={styles.backRow} accessibilityRole="button">
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reschedule workouts</Text>
        <Text style={styles.subtitle}>
          Pick the workouts to move, then a rest day for each. To trade two workouts, use "Or swap with".
          {auto ? " Your coach has you set to move automatically." : " Your coach approves each request."}
        </Text>

        {isPending && <ActivityIndicator color={colors.blueDeep} style={{ marginTop: spacing.xl }} />}

        {isError && !data && (
          <TouchableOpacity onPress={() => void refetch()} style={styles.errorCard}>
            <Text style={styles.errorText}>Could not load your schedule. Tap to try again.</Text>
          </TouchableOpacity>
        )}

        {restoredNote && <Text style={styles.note}>Restored your unsaved selection.</Text>}

        {data && (data.pending ?? []).length > 0 && (
          <PendingSection
            pending={data.pending}
            busy={cancel.isPending}
            onWithdraw={(id) => cancel.mutate([id])}
          />
        )}

        {data && missedThisWeek.length > 0 && (
          <Section label="MISSED THIS WEEK">
            {missedThisWeek.map((day) => (
              <MoveRow
                key={day.date}
                day={day}
                missed
                target={targets[day.date]}
                choices={restDays.filter((d) => !Object.values(targets).includes(d) || targets[day.date] === d)}
                swapChoices={swapChoicesFor(day, true)}
                onToggle={() => toggle(day)}
                onPick={(to) => pickTarget(day.date, to)}
              />
            ))}
          </Section>
        )}

        {data && missedOlder.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => setShowOlder((v) => !v)}
              style={styles.olderToggle}
              accessibilityRole="button"
              accessibilityState={{ expanded: showOlder || olderHasSelection }}
            >
              <Text style={styles.sectionLabel}>OLDER MISSED ({missedOlder.length})</Text>
              <ChevronDown
                color={colors.ink50}
                size={16}
                style={{ transform: [{ rotate: showOlder || olderHasSelection ? "180deg" : "0deg" }] }}
              />
            </TouchableOpacity>
            {(showOlder || olderHasSelection) && (
              <View style={styles.sectionBody}>
                {missedOlder.map((day) => (
                  <MoveRow
                    key={day.date}
                    day={day}
                    missed
                    target={targets[day.date]}
                    choices={restDays.filter((d) => !Object.values(targets).includes(d) || targets[day.date] === d)}
                    swapChoices={swapChoicesFor(day, true)}
                    onToggle={() => toggle(day)}
                    onPick={(to) => pickTarget(day.date, to)}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {data && upcoming.length > 0 && (
          <Section label="UPCOMING">
            {upcoming.map((day) => (
              <MoveRow
                key={day.date}
                day={day}
                target={targets[day.date]}
                choices={restDays.filter((d) => !Object.values(targets).includes(d) || targets[day.date] === d)}
                swapChoices={swapChoicesFor(day, false)}
                onToggle={() => toggle(day)}
                onPick={(to) => pickTarget(day.date, to)}
              />
            ))}
          </Section>
        )}

        {data && missed.length === 0 && upcoming.length === 0 && (
          <Text style={styles.empty}>Nothing to reschedule. Every workout is done or already waiting on a decision.</Text>
        )}

        {data && restDays.length === 0 && (missed.length > 0 || upcoming.length > 0) && (
          <Text style={styles.empty}>There are no free rest days left in your program to move a workout to.</Text>
        )}
      </ScrollView>

      {selected.length > 0 && (
        <View style={[styles.footer, { bottom: tabBarSpace, paddingBottom: spacing.lg }]}>
          {(request.error || requestSwap.error) && (
            <Text style={styles.errorText}>{describeScheduleMoveError(request.error ?? requestSwap.error)}</Text>
          )}
          {request.isPaused && <Text style={styles.errorText}>You are offline. This sends when you reconnect.</Text>}
          <TouchableOpacity
            onPress={() => void send()}
            disabled={sending}
            style={[styles.primary, sending ? styles.disabled : undefined]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>
              {sending
                ? "Sending…"
                : auto
                  ? `Move ${selected.length} workout${selected.length === 1 ? "" : "s"}`
                  : `Send ${selected.length} request${selected.length === 1 ? "" : "s"}`}
            </Text>
          </TouchableOpacity>
          {unplaced > 0 && <Text style={styles.footerHint}>{unplaced} more not selected</Text>}
        </View>
      )}
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function PendingSection({
  pending,
  busy,
  onWithdraw,
}: {
  pending: PendingMove[];
  busy: boolean;
  onWithdraw: (id: string) => void;
}) {
  return (
    <Section label="WAITING ON YOUR COACH">
      {pending
        // A swap is two rows; show it once. Withdrawing it withdraws both.
        .filter((move, i, all) => !move.swap_id || all.findIndex((m) => m.swap_id === move.swap_id) === i)
        .map((move) => {
          const partner = move.swap_id
            ? pending.find((m) => m.swap_id === move.swap_id && m.id !== move.id)
            : undefined;
          return (
        <View key={move.id} style={styles.pendingRow}>
          <Clock3 color={colors.ink50} size={16} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>
              {partner
                ? `${move.session_name ?? "Workout"} ⇄ ${partner.session_name ?? "Workout"}`
                : (move.session_name ?? "Workout")}
            </Text>
            <Text style={styles.rowDate}>
              {partner
                ? `Swap ${shortDate(move.from_date)} and ${shortDate(move.to_date)}`
                : `${shortDate(move.from_date)} → ${shortDate(move.to_date)}`}
            </Text>
          </View>
          <TouchableOpacity onPress={() => onWithdraw(move.id)} disabled={busy} hitSlop={8}>
            <Text style={styles.withdraw}>Withdraw</Text>
          </TouchableOpacity>
        </View>
          );
        })}
    </Section>
  );
}

function MoveRow({
  day,
  missed,
  target,
  choices,
  swapChoices,
  onToggle,
  onPick,
}: {
  day: MovableDay;
  missed?: boolean;
  target: string | undefined;
  choices: string[];
  swapChoices: MovableDay[];
  onToggle: () => void;
  onPick: (to: string) => void;
}) {
  const selected = target !== undefined;
  return (
    <View style={[styles.row, selected ? styles.rowSelected : undefined]}>
      <TouchableOpacity
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${day.name ?? "Workout"} on ${shortDate(day.date)}`}
        style={styles.rowHead}
      >
        <View style={[styles.box, selected ? styles.boxOn : undefined]}>
          {selected && <Check color="#fff" size={13} />}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {day.name ?? "Workout"}
          </Text>
          <Text style={[styles.rowDate, missed ? styles.rowDateMissed : undefined]}>
            {missed ? "Missed · " : ""}
            {shortDate(day.date)}
          </Text>
        </View>
      </TouchableOpacity>

      {selected && (
        <View style={styles.targetGroups}>
          <View>
            <Text style={styles.moveTo}>Move to</Text>
            {choices.length === 0 ? (
              <Text style={styles.rowDate}>No free day left</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {choices.map((to) => (
                  <TouchableOpacity
                    key={to}
                    onPress={() => onPick(to)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: to === target }}
                    style={[styles.chip, to === target ? styles.chipOn : undefined]}
                  >
                    <Text style={[styles.chipText, to === target ? styles.chipTextOn : undefined]}>{shortDate(to)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {swapChoices.length > 0 && (
            <View>
              <Text style={styles.moveTo}>Or swap with</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {swapChoices.map((other) => (
                  <TouchableOpacity
                    key={other.date}
                    onPress={() => onPick(other.date)}
                    accessibilityRole="button"
                    accessibilityLabel={`Swap with ${other.name ?? "workout"} on ${shortDate(other.date)}`}
                    accessibilityState={{ selected: other.date === target }}
                    style={[styles.chip, other.date === target ? styles.chipOn : undefined]}
                  >
                    <Text style={[styles.chipText, other.date === target ? styles.chipTextOn : undefined]}>
                      {shortDate(other.date)} · {other.name ?? "Workout"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  olderToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  screen: { flex: 1, backgroundColor: colors.cream },
  content: { padding: spacing.xl },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  backText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink50 },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink, marginTop: spacing.md },
  subtitle: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink50, marginTop: spacing.xs },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.blueDeep, marginTop: spacing.md },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink50,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  section: { marginTop: spacing.xl },
  sectionLabel: { fontFamily: fonts.bodySemiBold, fontSize: 10, letterSpacing: 1.4, color: colors.ink50 },
  sectionBody: { gap: spacing.sm, marginTop: spacing.sm },
  row: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowSelected: { borderColor: colors.blueDeep },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontFamily: fonts.display, fontSize: 15, color: colors.ink },
  rowDate: { fontFamily: fonts.body, fontSize: 12, color: colors.ink50, marginTop: 2 },
  rowDateMissed: { color: colors.bad },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  moveTo: { fontFamily: fonts.bodySemiBold, fontSize: 10, letterSpacing: 1, color: colors.ink50, marginBottom: 6 },
  targetGroups: { gap: spacing.md },
  chips: { gap: spacing.sm },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.creamDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.ink70 },
  chipTextOn: { color: "#fff" },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  withdraw: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink50, textDecorationLine: "underline" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` is set at render to sit above the floating tab bar (useTabBarSpace).
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },
  footerHint: { fontFamily: fonts.body, fontSize: 11, color: colors.ink50, textAlign: "center" },
  primary: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: "#fff" },
  disabled: { opacity: 0.5 },
  errorCard: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.card, backgroundColor: colors.badBg },
  errorText: { fontFamily: fonts.body, fontSize: 12, color: colors.bad },
  resultCard: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
    padding: spacing.xl,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.sm,
  },
  resultTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, textAlign: "center" },
  resultBody: { fontFamily: fonts.body, fontSize: 13, color: colors.ink50, textAlign: "center" },
  resultSkipped: { fontFamily: fonts.body, fontSize: 12, color: colors.bad, textAlign: "center" },
});
