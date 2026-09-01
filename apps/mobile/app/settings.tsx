import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { colors, fonts, radii, spacing } from "../theme/tokens";

export default function Settings() {
  const { profile, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.content}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.description}>
          Autosave-on-blur preferences and account details land here in a later slice.
        </Text>

        {profile ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Timezone</Text>
            <Text style={styles.infoValue}>{profile.timezone ?? "syncing..."}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void signOut()}
        >
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    flex: 1,
    padding: spacing.xxl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  description: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink50,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.ink70,
  },
  infoValue: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink50,
  },
  button: {
    backgroundColor: colors.bad,
    borderRadius: radii.control,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.surface,
  },
});
