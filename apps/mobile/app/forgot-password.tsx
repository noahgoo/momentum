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
import { Link } from "expo-router";
import { supabase } from "../lib/supabase";
import { colors, fonts, radii, shadows, spacing } from "../theme/tokens";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) {
      setFormError("Enter your email.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "momentum://reset-password",
    });

    setSubmitting(false);

    // Always show the same success state, whether or not the email exists,
    // so this screen can't be used to probe for registered accounts.
    if (error) {
      setFormError("Something went wrong. Try again in a moment.");
      return;
    }
    setSent(true);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.heading}>Reset password</Text>
        <Text style={styles.subheading}>
          {sent
            ? `If an account exists for ${email.trim()}, a reset link is on its way.`
            : "Enter your email and we'll send you a reset link."}
        </Text>

        {!sent && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
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
                <Text style={styles.buttonText}>Send reset link</Text>
              )}
            </Pressable>
          </>
        )}

        <Link href="/login" style={styles.backLink}>
          Back to sign in
        </Link>
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
  backLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.ink50,
    textAlign: "center",
    marginTop: spacing.xl,
    textDecorationLine: "underline",
  },
});
