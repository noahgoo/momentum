import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronLeft, Clock3 } from "lucide-react-native";
import {
  describeScheduleMoveError,
  type MovableDay,
  type PendingMove,
  type RequestScheduleMovesResult,
} from "@momentum/shared";
import { useAuth } from "../../../lib/auth";
import { useTabBarSpace } from "../../../components/PillTabBar";
import { useDraft } from "../../../lib/useDraft";
import { suggestTargets } from "../../../lib/moveSuggestions";
import { randomUuid } from "../../../lib/uuid";
import {
  useCancelScheduleMoves,
  useMovableDays,
  useRequestScheduleMoves,
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
  const cancel = useCancelScheduleMoves(uid);

  const draft = useDraft<MoveDraft>(uid ? `moveDraft:${uid}` : null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<RequestScheduleMovesResult | null>(null);
  const [restoredNote, setRestoredNote] = useState(false);
  // One id per submission attempt, kept across retries so the server can
  // recognise a double tap or a retry (C4). Reset only once a request lands.
  const batchId = useRef<string>(randomUuid());
  const seeded = useRef(false);

  const missed = data?.missed ?? [];
  const upcoming = data?.upcoming ?? [];
  const restDays = data?.rest_days ?? [];
  const today = data?.today ?? "";

  // Seed once, when both the draft and the server's data are in: a restored
  // selection (minus anything the server no longer offers), or the date the
  // client arrived from.
  useEffect(() => {
    if (seeded.current || !draft.hydrated || !data) return;
    seeded.current = true;

    const movable = new Set([...data.missed, ...data.upcoming].map((d) => d.date));
    const free = new Set(data.rest_days);
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

  async function send() {
    if (selected.length === 0) return;
    try {
      const result = await request.mutateAsync({
        batchId: batchId.current,
        moves: selected.map((from) => ({ fromDate: from, toDate: targets[from]! })),
      });
      setOutcome(result);
      draft.clear();
      setTargets({});
      batchId.current = randomUuid();
    } catch {
      // The error is shown from request.error; the draft and batch id stay so
      // the client can fix the selection and send again.
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
              <Text key={s.id} style={styles.resultSkipped}>
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 96 }]}>
        <TouchableOpacity onPress={goBack} style={styles.backRow} accessibilityRole="button">
          <ChevronLeft color={colors.ink50} size={16} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reschedule workouts</Text>
        <Text style={styles.subtitle}>
          Pick the workouts to move, then a rest day for each.
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

        {data && missed.length > 0 && (
          <Section label="MISSED">
            {missed.map((day) => (
              <MoveRow
                key={day.date}
                day={day}
                missed
                target={targets[day.date]}
                choices={restDays.filter((d) => !Object.values(targets).includes(d) || targets[day.date] === d)}
                onToggle={() => toggle(day)}
                onPick={(to) => pickTarget(day.date, to)}
              />
            ))}
          </Section>
        )}

        {data && upcoming.length > 0 && (
          <Section label="UPCOMING">
            {upcoming.map((day) => (
              <MoveRow
                key={day.date}
                day={day}
                target={targets[day.date]}
                choices={restDays.filter((d) => !Object.values(targets).includes(d) || targets[day.date] === d)}
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
        <View style={[styles.footer, { paddingBottom: spacing.lg }]}>
          {request.error && <Text style={styles.errorText}>{describeScheduleMoveError(request.error)}</Text>}
          {request.isPaused && <Text style={styles.errorText}>You are offline. This sends when you reconnect.</Text>}
          <TouchableOpacity
            onPress={() => void send()}
            disabled={request.isPending}
            style={[styles.primary, request.isPending ? styles.disabled : undefined]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>
              {request.isPending
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
      {pending.map((move) => (
        <View key={move.id} style={styles.pendingRow}>
          <Clock3 color={colors.ink50} size={16} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>
              {move.session_name ?? "Workout"}
            </Text>
            <Text style={styles.rowDate}>
              {shortDate(move.from_date)} → {shortDate(move.to_date)}
            </Text>
          </View>
          <TouchableOpacity onPress={() => onWithdraw(move.id)} disabled={busy} hitSlop={8}>
            <Text style={styles.withdraw}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      ))}
    </Section>
  );
}

function MoveRow({
  day,
  missed,
  target,
  choices,
  onToggle,
  onPick,
}: {
  day: MovableDay;
  missed?: boolean;
  target: string | undefined;
  choices: string[];
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    bottom: 0,
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
