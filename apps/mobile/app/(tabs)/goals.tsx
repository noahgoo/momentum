import { useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { dateStr, type Goal } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { useClientDate } from "../../lib/useClientDate";
import { useGoals } from "../../lib/queries/useGoals";
import { useGoalLogsRange } from "../../lib/queries/useGoalLogsRange";
import { useToggleGoalLog } from "../../lib/queries/useToggleGoalLog";
import { useCreateGoal } from "../../lib/queries/useCreateGoal";
import { useArchiveGoal } from "../../lib/queries/useArchiveGoal";
import { rangeCompletion, dayCompletion } from "../../lib/goalHistory";
import { AddGoalModal } from "../../components/goals/AddGoalModal";
import { ProgressRing } from "../../components/goals/ProgressRing";
import { GoalRow } from "../../components/goals/GoalRow";
import { WeekChart, type DayBar } from "../../components/goals/WeekChart";
import { DayDetailPanel } from "../../components/goals/DayDetailPanel";
import { colors, fonts, radii, shadows, spacing } from "../../theme/tokens";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function last7Dates(anchor: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() - (6 - i));
    return dateStr(d);
  });
}

function dayLetter(dateStr: string): string {
  return DAY_LETTERS[new Date(`${dateStr}T12:00:00`).getDay()];
}

function formatDayFull(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function headerDateLabel(): string {
  const d = new Date();
  const wd = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const mo = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${wd} · ${mo} ${d.getDate()}`;
}

export default function GoalsScreen() {
  const { session, profile } = useAuth();
  const uid = session?.user.id;

  const { today } = useClientDate();
  const last7 = useMemo(() => last7Dates(new Date(`${today}T12:00:00`)), [today]);
  const fromDate = last7[0];
  const toDate = last7[last7.length - 1];

  const { data: goals = [], isLoading: goalsLoading } = useGoals(uid);
  const { data: allGoals = [] } = useGoals(uid, true);
  const { data: weekLogs = [], isLoading: logsLoading } = useGoalLogsRange(uid, fromDate, toDate);

  const toggleGoalLog = useToggleGoalLog();
  const createGoal = useCreateGoal();
  const archiveGoal = useArchiveGoal();

  const [showModal, setShowModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [addingDraft, setAddingDraft] = useState<string | null>(null);
  const inlineInputRef = useRef<TextInput>(null);

  const loading = goalsLoading || logsLoading;

  const todayLogs = weekLogs.filter((l) => l.date === today);
  const completedToday = goals.filter((g) => todayLogs.some((l) => l.goal_id === g.id)).length;
  const total = goals.length;
  const pct = total > 0 ? completedToday / total : 0;
  const remaining = total - completedToday;

  const weekRange = rangeCompletion(allGoals, weekLogs, last7);
  const weekPct = weekRange.total > 0 ? Math.round((weekRange.done / weekRange.total) * 100) : 0;

  const firstName = profile?.display_name?.split(" ")[0] ?? "there";

  const dayBars: DayBar[] = last7.map((date) => {
    const { done, total: dayTotal } = dayCompletion(allGoals, weekLogs, date);
    return { date, dayLetter: dayLetter(date), done, total: dayTotal, isToday: date === today };
  });

  function handleToggle(goal: Goal) {
    if (!uid) return;
    const isLogged = todayLogs.some((l) => l.goal_id === goal.id);
    toggleGoalLog.mutate({ goal: { id: goal.id, text: goal.text }, clientId: uid, date: today, isLogged });
  }

  function handleTogglePastDay(goal: Goal, date: string) {
    if (!uid) return;
    const isLogged = weekLogs.some((l) => l.goal_id === goal.id && l.date === date);
    toggleGoalLog.mutate({ goal: { id: goal.id, text: goal.text }, clientId: uid, date, isLogged });
  }

  function handleArchive(goalId: string) {
    if (!uid) return;
    archiveGoal.mutate({ goalId, clientId: uid });
  }

  function handleModalSubmit(text: string) {
    if (!uid) return;
    createGoal.mutate({ clientId: uid, text });
  }

  function handleInlineCommit() {
    const text = (addingDraft ?? "").trim();
    if (text && uid) {
      createGoal.mutate({ clientId: uid, text });
    }
    setAddingDraft(null);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingContent}>
          <View style={[styles.skeletonBlock, { width: 80, height: 12 }]} />
          <View style={[styles.skeletonBlock, { width: 180, height: 36, marginTop: 6 }]} />
          <View style={[styles.skeletonBlock, { width: 220, height: 14, marginTop: 6 }]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerDate}>{headerDateLabel()}</Text>
            <Text style={styles.headerTitle}>Today&apos;s goals</Text>
            <Text style={styles.headerSubtitle}>
              {completedToday} of {total} complete · resets at midnight
            </Text>
          </View>
          <Pressable style={styles.addButton} onPress={() => setShowModal(true)} hitSlop={8}>
            <Text style={styles.addButtonLabel}>+</Text>
          </Pressable>
        </View>

        {/* Progress ring row */}
        <ProgressRing pct={pct} firstName={firstName} remaining={remaining} />

        {/* Checklist card */}
        <View style={[styles.card, styles.checklistCard]}>
          {goals.map((goal, i) => {
            const done = todayLogs.some((l) => l.goal_id === goal.id);
            const isOwn = goal.set_by === uid;
            const isSwipeable = isOwn && !goal.locked;
            return (
              <GoalRow
                key={goal.id}
                goal={goal}
                done={done}
                isOwn={isOwn}
                isSwipeable={isSwipeable}
                isLast={i === goals.length - 1 && addingDraft === null}
                onToggle={() => handleToggle(goal)}
                onArchive={() => handleArchive(goal.id)}
              />
            );
          })}

          {/* Inline add row */}
          <View style={[styles.inlineAddRow, goals.length > 0 && styles.inlineAddRowBordered]}>
            <View style={styles.inlineAddIcon}>
              <Text style={styles.inlineAddIconText}>+</Text>
            </View>
            {addingDraft !== null ? (
              <TextInput
                ref={inlineInputRef}
                value={addingDraft}
                onChangeText={setAddingDraft}
                onSubmitEditing={handleInlineCommit}
                onBlur={handleInlineCommit}
                placeholder="Add a personal goal…"
                placeholderTextColor={colors.ink50}
                autoFocus
                style={styles.inlineAddInput}
              />
            ) : (
              <Pressable style={styles.inlineAddTextWrap} onPress={() => setAddingDraft("")}>
                <Text style={styles.inlineAddPlaceholder}>Add a personal goal…</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* This week card */}
        <View style={[styles.card, styles.weekCard]}>
          <View style={styles.weekHeaderRow}>
            <Text style={styles.weekLabel}>THIS WEEK</Text>
            <Text style={styles.weekPct}>
              {weekPct}
              <Text style={styles.weekPctSign}>%</Text>
            </Text>
          </View>

          {selectedDay && (
            <DayDetailPanel
              date={selectedDay}
              dateLabel={formatDayFull(selectedDay)}
              allGoals={allGoals}
              weekLogs={weekLogs}
              onClose={() => setSelectedDay(null)}
              onTogglePastDay={(goal) => handleTogglePastDay(goal, selectedDay)}
            />
          )}

          <WeekChart
            days={dayBars}
            selectedDay={selectedDay}
            onSelectDay={(date) => setSelectedDay((d) => (d === date ? null : date))}
          />
        </View>
      </ScrollView>

      <AddGoalModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={handleModalSubmit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  loadingContent: {
    padding: spacing.lg,
  },
  skeletonBlock: {
    backgroundColor: colors.creamDeep,
    borderRadius: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  headerDate: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.4,
  },
  headerTitle: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
    fontSize: 32,
    color: colors.ink,
    marginTop: 4,
  },
  headerSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 4,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonLabel: {
    color: colors.cream,
    fontSize: 22,
    fontWeight: "300",
    lineHeight: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    ...shadows.cardSubtle,
  },
  checklistCard: {
    padding: 6,
    overflow: "hidden",
  },
  weekCard: {
    padding: spacing.lg,
  },
  inlineAddRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
  },
  inlineAddRowBordered: {
    borderTopWidth: 1,
    borderTopColor: colors.line2,
    borderStyle: "dashed",
  },
  inlineAddIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  inlineAddIconText: {
    color: colors.ink50,
    fontSize: 16,
  },
  inlineAddTextWrap: {
    flex: 1,
  },
  inlineAddPlaceholder: {
    fontFamily: fonts.body,
    fontStyle: "italic",
    fontSize: 14,
    color: colors.ink50,
  },
  inlineAddInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    padding: 0,
  },
  weekHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  weekLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    color: colors.ink50,
    letterSpacing: 1.2,
  },
  weekPct: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
    fontSize: 18,
    color: colors.ink,
  },
  weekPctSign: {
    fontFamily: fonts.body,
    fontStyle: "normal",
    fontSize: 11,
    color: colors.ink50,
  },
});
