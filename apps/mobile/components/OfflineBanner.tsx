import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { onlineManager, useIsMutating } from "@tanstack/react-query";
import { colors, fonts, radii, spacing } from "../theme/tokens";

/**
 * Says which of three states the app is in, without ever interrupting.
 *
 * Offline is a supported state, not an error (docs/rules/offline-perf.md S3):
 * no dialog, no toast over a set the client is mid-way through logging — a
 * calm line that resolves itself. It hides entirely when online and settled,
 * which is almost always.
 */
const SAVED_VISIBLE_MS = 2500;

export function OfflineBanner() {
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  const [showSaved, setShowSaved] = useState(false);
  const pending = useIsMutating();

  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);

  // Show "All changes saved" briefly on the transition from syncing to idle,
  // so a client who logged offline gets confirmation rather than silence.
  const [wasPending, setWasPending] = useState(false);
  useEffect(() => {
    if (pending > 0 && !wasPending) setWasPending(true);
    if (pending === 0 && wasPending) {
      setWasPending(false);
      if (online) {
        setShowSaved(true);
        const t = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
        return () => clearTimeout(t);
      }
    }
  }, [pending, wasPending, online]);

  if (!online) {
    return (
      <View style={[styles.banner, styles.offline]}>
        <Text style={styles.text}>Offline — your changes will sync when you reconnect</Text>
      </View>
    );
  }

  if (pending > 0) {
    return (
      <View style={[styles.banner, styles.syncing]}>
        <Text style={styles.text}>Syncing…</Text>
      </View>
    );
  }

  if (showSaved) {
    return (
      <View style={[styles.banner, styles.saved]}>
        <Text style={styles.text}>All changes saved</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  offline: { backgroundColor: colors.creamDeep },
  syncing: { backgroundColor: colors.cream },
  saved: { backgroundColor: colors.cream },
  text: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink70,
  },
});
