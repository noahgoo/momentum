import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import type { Message } from "@momentum/shared";
import { useAuth } from "../../lib/auth";
import { useMyCoach } from "../../lib/queries/useMyCoach";
import { useThread } from "../../lib/queries/useThread";
import { useMessages } from "../../lib/queries/useMessages";
import { useSendMessage } from "../../lib/queries/useSendMessage";
import { useMarkMessagesRead } from "../../lib/queries/useMarkMessagesRead";
import { MessagesHeader } from "../../components/messages/MessagesHeader";
import { MessageBubble } from "../../components/messages/MessageBubble";
import { DateSeparator } from "../../components/messages/DateSeparator";
import { EmptyState } from "../../components/messages/EmptyState";
import { colors, fonts, radii, spacing } from "../../theme/tokens";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/** Row union fed to the inverted FlatList: either a message or a date
 * separator inserted ahead of the first message of a new day. */
type Row = { kind: "message"; message: Message; grouped: boolean } | { kind: "separator"; label: string };

/**
 * Ports mindful-miya/src/app/messages/page.tsx to RN (slice 8.5). Header
 * ("Coach" + coach display_name via `useMyCoach`), scrollable bubble list
 * (inverted FlatList — newest at the bottom, list itself renders
 * newest-first internally), input bar pinned above the tab bar via
 * KeyboardAvoidingView.
 *
 * Data flow: `useThread` resolves the client's thread row (may be null —
 * created lazily on first send); `useMessages` loads the latest 50 + wires
 * realtime; `useSendMessage` is the optimistic-append mutation;
 * `useMarkMessagesRead` batches read-receipts on screen focus.
 */
export default function Messages() {
  const { session, profile } = useAuth();
  const uid = session?.user.id;
  const coachId = profile?.invited_by ?? null;

  const { data: coach } = useMyCoach(coachId);
  const { data: thread } = useThread(uid);
  const threadId = thread?.id ?? null;

  const {
    messages,
    isPending,
    hasMoreEarlier,
    loadingEarlier,
    loadEarlier,
  } = useMessages(uid, threadId);

  const sendMessage = useSendMessage();
  const markRead = useMarkMessagesRead();

  const [text, setText] = useState("");
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const markReadOnceRef = useRef<string | null>(null);

  // Mark-read on focus (non-goal: no unread badge on the tab bar itself,
  // see slice non-goals — this only clears the underlying thread/message
  // read state). Guarded per thread id so refocusing without new messages
  // doesn't refire the mutation on every tab switch.
  useFocusEffect(
    useCallback(() => {
      if (!uid || !threadId) return;
      if (markReadOnceRef.current === threadId) return;
      const hasUnread = messages.some((m) => !m.read && m.sender_id !== uid);
      if (!hasUnread) return;
      markReadOnceRef.current = threadId;
      markRead.mutate({ clientId: uid, threadId });
    }, [uid, threadId, messages, markRead])
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay: string | null = null;
    let lastSender: string | null = null;
    for (const message of messages) {
      const day = dayLabel(message.sent_at);
      if (day !== lastDay) {
        out.push({ kind: "separator", label: day });
        lastDay = day;
        lastSender = null;
      }
      out.push({
        kind: "message",
        message,
        grouped: lastSender === message.sender_id,
      });
      lastSender = message.sender_id;
    }
    // Inverted FlatList renders index 0 at the bottom — reverse so the
    // newest message/row is first.
    return out.slice().reverse();
  }, [messages]);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || !uid || !coachId || sendMessage.isPending) return;
    setText("");
    setLastFailedText(null);
    sendMessage.mutate(
      { clientId: uid, text: trimmed },
      {
        onError: () => setLastFailedText(trimmed),
      }
    );
  }

  function handleRetry() {
    if (!lastFailedText) return;
    setText(lastFailedText);
    setLastFailedText(null);
  }

  if (!uid || !profile) return null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <MessagesHeader coachName={coach?.display_name ?? null} />

      <View style={styles.listArea}>
        {isPending ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.blueDeep} />
          </View>
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={rows}
            inverted
            keyExtractor={(row, i) => (row.kind === "message" ? row.message.id : `sep-${i}`)}
            renderItem={({ item }) =>
              item.kind === "separator" ? (
                <DateSeparator label={item.label} />
              ) : (
                <MessageBubble
                  text={item.message.text}
                  time={formatTime(item.message.sent_at)}
                  isOwn={item.message.sender_id === uid}
                  grouped={item.grouped}
                />
              )
            }
            contentContainerStyle={styles.listContent}
            onEndReached={hasMoreEarlier ? () => void loadEarlier() : undefined}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingEarlier ? (
                <View style={styles.loadEarlier}>
                  <ActivityIndicator size="small" color={colors.ink30} />
                </View>
              ) : null
            }
          />
        )}
      </View>

      {lastFailedText && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Message didn&apos;t send.</Text>
          <Pressable onPress={handleRetry} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.inputBar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message your coach…"
          placeholderTextColor={colors.ink30}
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sendMessage.isPending}
          style={[
            styles.sendButton,
            { backgroundColor: text.trim() ? colors.blueDeep : colors.ink08 },
          ]}
        >
          <Text style={[styles.sendGlyph, { color: text.trim() ? "#FFFFFF" : colors.ink30 }]}>
            ↑
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  listArea: {
    flex: 1,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: spacing.lg,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  loadEarlier: {
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(242, 237, 232, 0.95)",
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.bad,
  },
  retryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.blueDeep,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.ink08,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.ink08,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: radii.control + 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sendGlyph: {
    fontSize: 20,
    fontFamily: fonts.bodySemiBold,
  },
});
