import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fonts, spacing } from "../../theme/tokens";

interface MessagesHeaderProps {
  coachName: string | null;
}

/** Fixed header: "Coach" title + coach display_name, with a green online-dot
 * decoration (mirrors mindful-miya's always-on "online" indicator — this app
 * has no presence tracking, it's purely decorative). */
export function MessagesHeader({ coachName }: MessagesHeaderProps) {
  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Coach</Text>
          {coachName && <Text style={styles.subtitle}>{coachName}</Text>}
        </View>
        <View style={styles.statusRow}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>online</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.cream,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink08,
  },
  header: {
    height: 64,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink50,
    marginTop: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.ok,
  },
  statusText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.ink50,
    letterSpacing: 0.4,
  },
});
