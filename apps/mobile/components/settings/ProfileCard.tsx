import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { Profile } from "@momentum/shared";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { useUpdateProfileSettings } from "../../lib/queries/useUpdateProfileSettings";
import { SavedLabel } from "./SavedLabel";
import { SettingsCard } from "./SettingsCard";

const MAX_NAME_LENGTH = 80;
const SAVED_FLASH_MS = 2000;

interface ProfileCardProps {
  profile: Profile;
}

/**
 * Avatar initial + display_name (autosave on blur, zod-bounded via the
 * mutation's `profileSettingsUpdateSchema.shape.displayName` rule
 * mirrored here as a plain trim/length guard) + read-only email.
 */
export function ProfileCard({ profile }: ProfileCardProps) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [saved, setSaved] = useState(false);
  const updateSettings = useUpdateProfileSettings();

  useEffect(() => {
    setName(profile.display_name ?? "");
  }, [profile.display_name]);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), SAVED_FLASH_MS);
  }

  function handleBlur() {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) {
      setName(profile.display_name ?? "");
      return;
    }
    if (trimmed === profile.display_name) return;
    setName(trimmed);
    updateSettings.mutate(
      { uid: profile.id, patch: { display_name: trimmed } },
      { onSuccess: flashSaved }
    );
  }

  const initial = (name[0] ?? profile.email?.[0] ?? "?").toUpperCase();

  return (
    <SettingsCard label="Profile">
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      </View>

      <TextInput
        value={name}
        onChangeText={setName}
        onBlur={handleBlur}
        placeholder="Your name"
        placeholderTextColor={colors.ink30}
        style={styles.input}
        maxLength={MAX_NAME_LENGTH}
        autoCapitalize="words"
      />

      <SavedLabel visible={saved} />

      <Text style={styles.email}>{profile.email}</Text>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  avatarWrap: {
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.displayRegular,
    fontSize: 30,
    color: colors.ink,
  },
  input: {
    height: 48,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  email: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink50,
    marginTop: 2,
    paddingLeft: 4,
  },
});
