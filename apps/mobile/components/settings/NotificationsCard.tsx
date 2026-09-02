import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import type { Profile } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useUpdateProfileSettings } from "../../lib/queries/useUpdateProfileSettings";
import { SavedLabel } from "./SavedLabel";
import { SettingsCard } from "./SettingsCard";

const DEFAULT_TIME = "08:00";
const SAVED_FLASH_MS = 2000;
const MINUTE_OPTIONS = [0, 15, 30, 45];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function parseTime(value: string | null): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return { hour: 8, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

interface NotificationsCardProps {
  profile: Profile;
}

/**
 * notifications_enabled switch (immediate save, no blur needed — a switch
 * has no intermediate "editing" state) + notification_time hour/minute
 * chip selects (autosave per selection). Simple selects rather than a wheel
 * picker per the slice brief ("simple hour/minute selects or wheel") — no
 * picker dependency is installed in this app yet.
 */
export function NotificationsCard({ profile }: NotificationsCardProps) {
  const updateSettings = useUpdateProfileSettings();
  const [saved, setSaved] = useState(false);

  const { hour, minute } = useMemo(
    () => parseTime(profile.notification_time ?? DEFAULT_TIME),
    [profile.notification_time]
  );

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  function handleToggle(next: boolean) {
    updateSettings.mutate({ uid: profile.id, patch: { notifications_enabled: next } });
  }

  function handleHourChange(nextHour: number) {
    if (nextHour === hour) return;
    updateSettings.mutate(
      { uid: profile.id, patch: { notification_time: formatTime(nextHour, minute) } },
      { onSuccess: flashSaved }
    );
  }

  function handleMinuteChange(nextMinute: number) {
    if (nextMinute === minute) return;
    updateSettings.mutate(
      { uid: profile.id, patch: { notification_time: formatTime(hour, nextMinute) } },
      { onSuccess: flashSaved }
    );
  }

  return (
    <SettingsCard label="Notifications">
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Enable reminders</Text>
        <Switch
          value={profile.notifications_enabled}
          onValueChange={handleToggle}
          trackColor={{ false: colors.creamDeep, true: colors.blue }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={[styles.timeSection, !profile.notifications_enabled && styles.disabled]}>
        <Text style={styles.timeLabel}>Daily reminder time</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {HOURS.map((h) => (
            <Pressable
              key={h}
              disabled={!profile.notifications_enabled}
              onPress={() => handleHourChange(h)}
              style={[styles.chip, h === hour && styles.chipActive]}
            >
              <Text style={[styles.chipText, h === hour && styles.chipTextActive]}>
                {formatHourLabel(h)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.minuteRow}>
          {MINUTE_OPTIONS.map((m) => (
            <Pressable
              key={m}
              disabled={!profile.notifications_enabled}
              onPress={() => handleMinuteChange(m)}
              style={[styles.chip, m === minute && styles.chipActive]}
            >
              <Text style={[styles.chipText, m === minute && styles.chipTextActive]}>
                :{String(m).padStart(2, "0")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <SavedLabel visible={saved} />

      <Text style={styles.hint}>Reminders arrive around this hour.</Text>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  timeSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  disabled: {
    opacity: 0.5,
  },
  timeLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  chipRow: {
    marginBottom: spacing.sm,
  },
  chipRowContent: {
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  minuteRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  chipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink,
  },
  chipTextActive: {
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
    lineHeight: 17,
  },
});
