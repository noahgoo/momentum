import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors, fonts, radii } from "../../theme/tokens";
import { SettingsCard } from "./SettingsCard";

interface AccountCardProps {
  signOut: () => Promise<void>;
}

/** Sign-out action — unchanged behavior from the pre-slice settings.tsx. */
export function AccountCard({ signOut }: AccountCardProps) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SettingsCard label="Account">
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          signingOut && styles.buttonDisabled,
        ]}
        onPress={() => void handleSignOut()}
        disabled={signingOut}
      >
        <Text style={styles.buttonText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.bad,
    borderRadius: radii.control,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.surface,
  },
});
