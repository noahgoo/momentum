import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { Profile } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useUpdateProfileSettings } from "../../lib/queries/useUpdateProfileSettings";
import { getPermissionStatus } from "../../lib/pushToken";
import { SavedLabel } from "./SavedLabel";
import { SettingsCard } from "./SettingsCard";
import { TimeSelect } from "./TimeSelect";
import { formatStoredTime, nearestSlotValue } from "./timeSlots";

const DEFAULT_TIME = "08:00";
const SAVED_FLASH_MS = 2000;

interface NotificationsCardProps {
  profile: Profile;
}

/**
 * notifications_enabled switch (immediate save, no blur needed — a switch has
 * no intermediate "editing" state) + a reminder time select that autosaves on
 * pick.
 *
 * The time was previously assembled from two chip rows — 24 hours in a
 * horizontal scroller plus four minute chips — which made the client build a
 * time out of two half-answers and pushed most of the hours off the edge of
 * the card. One field now opens a list of the quarter-hour slots the scheduler
 * actually visits (C1a), so no reachable choice is silently rounded.
 */
export function NotificationsCard({ profile }: NotificationsCardProps) {
  const updateSettings = useUpdateProfileSettings();
  const [saved, setSaved] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Re-checked on focus rather than once: the client may grant or revoke the
  // permission in Settings while this screen is open.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getPermissionStatus().then((status) => {
        if (!cancelled) setPermissionDenied(status === "denied");
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const time = nearestSlotValue(profile.notification_time, DEFAULT_TIME);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  function handleToggle(next: boolean) {
    updateSettings.mutate({ uid: profile.id, patch: { notifications_enabled: next } });
  }

  function handleTimeChange(next: string) {
    updateSettings.mutate(
      { uid: profile.id, patch: { notification_time: next } },
      { onSuccess: flashSaved }
    );
  }

  return (
    <SettingsCard label="Notifications">
      {/* The in-app preference and the OS permission are different things.
          A client who turned reminders ON but denied the system prompt would
          otherwise just hear nothing, with no way to know why (N4). */}
      {profile.notifications_enabled && permissionDenied && (
        <Pressable onPress={() => void Linking.openSettings()} style={styles.permissionNotice}>
          <Text style={styles.permissionText}>
            Reminders are on, but notifications are blocked for Momentum in your device
            settings. Tap to open Settings.
          </Text>
        </Pressable>
      )}

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
        <Text style={styles.timeLabel}>Daily reminder</Text>
        <TimeSelect
          value={time}
          disabled={!profile.notifications_enabled}
          onChange={handleTimeChange}
          accessibilityLabel="Daily reminder time"
        />
      </View>

      <SavedLabel visible={saved} />

      <Text style={styles.hint}>
        Reminders arrive at {formatStoredTime(time)} in your own timezone, on days you have a
        workout you have not finished.
      </Text>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  permissionNotice: {
    backgroundColor: colors.creamDeep,
    borderRadius: radii.control,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  permissionText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
  },
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
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 2,
    lineHeight: 17,
  },
});
