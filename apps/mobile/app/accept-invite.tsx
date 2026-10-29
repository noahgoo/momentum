import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { parseInviteParams } from "../lib/inviteLink";
import { supabase } from "../lib/supabase";
import { colors, fonts, radii, shadows, spacing } from "../theme/tokens";

export default function AcceptInvite() {
  const params = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const tokenHash = parseInviteParams(params);
  // The invite token is single-use. If setting the password fails after it was
  // spent, the retry must reuse the session it created, not verify again.
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    // Verified here, on the button press, not on arrival: any app or web page
    // can open a momentum:// URL, and signing in on open would put this phone
    // into whatever account the link belongs to without the person asking.
    if (!verified) {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: "invite",
        token_hash: tokenHash as string,
      });
      if (verifyError) {
        setSubmitting(false);
        setFormError("This invite link is invalid or has expired. Ask your coach to resend it.");
        return;
      }
      setVerified(true);
    }

    const { error } = await supabase.auth.updateUser({ password });

    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    router.replace("/(tabs)/dashboard");
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.heading}>Welcome to Momentum</Text>
        <Text style={styles.subheading}>
          {tokenHash
            ? "Choose a password to activate your account."
            : "This invite link is invalid. Ask your coach to resend it."}
        </Text>

        {tokenHash && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>New password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="password-new"
                placeholder="••••••••"
                placeholderTextColor={colors.ink30}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoComplete="password-new"
                placeholder="••••••••"
                placeholderTextColor={colors.ink30}
              />
            </View>

            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.buttonText}>Activate account</Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    ...shadows.card,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  subheading: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink50,
    marginBottom: spacing.xl,
  },
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink70,
    marginBottom: spacing.xs,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.cream,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.bad,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.blueDeep,
    borderRadius: radii.control,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.sm,
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
