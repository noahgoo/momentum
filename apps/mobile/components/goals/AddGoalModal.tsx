import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, fonts, radii, spacing } from "../../theme/tokens";

interface AddGoalModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}

/** Bottom-sheet modal for adding a new personal goal, ported from the old app's AddGoalModal. */
export function AddGoalModal({ visible, onClose, onSubmit }: AddGoalModalProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setText("");
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [visible]);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.avoider}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.title}>New goal</Text>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              returnKeyType="done"
              placeholder="e.g. Drink 8 glasses of water"
              placeholderTextColor={colors.ink50}
              style={styles.input}
            />
            <Pressable
              onPress={submit}
              disabled={!text.trim()}
              style={[styles.submitButton, !text.trim() && styles.submitButtonDisabled]}
            >
              <Text style={styles.submitLabel}>Add goal</Text>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,28,28,0.36)",
    justifyContent: "flex-end",
  },
  avoider: {
    width: "100%",
  },
  sheet: {
    width: "100%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.creamDeep,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.displayRegular,
    fontStyle: "italic",
    fontSize: 22,
    color: colors.ink,
    marginBottom: spacing.lg,
  },
  input: {
    width: "100%",
    height: 52,
    borderRadius: radii.control,
    borderWidth: 1.5,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    fontSize: 14,
    fontFamily: fonts.body,
    backgroundColor: colors.cream,
    color: colors.ink,
  },
  submitButton: {
    marginTop: spacing.md,
    width: "100%",
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    backgroundColor: colors.creamDeep,
  },
  submitLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.ink,
  },
});
