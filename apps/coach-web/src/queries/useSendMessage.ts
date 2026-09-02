import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message, Thread } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import type { ThreadWithClient } from "./useThreads";

interface SendMessageInput {
  clientId: string;
  coachId: string;
  /** Existing thread row, or `null` if none exists yet for this client
   * (the `?client=` preselect case — see useThreadMessages). */
  thread: Thread | null;
  text: string;
}

/**
 * Sends a coach message, creating the thread row first if this client has
 * never been messaged (RLS policy `threads_coach_insert` — a coach may
 * create a thread paired with one of their own clients). Mirrors
 * apps/mobile/lib/queries/useSendMessage.ts with sender flipped to the coach.
 *
 * Overwrite semantics on the thread row (plan constraint #7): every send
 * unconditionally sets `last_message`/`last_message_at`/`last_message_by`
 * and flips both unread booleans — but with roles reversed from the client
 * app: `unread_for_client = true`, `unread_for_coach = false` (the coach
 * just read/sent, so their own unread flag clears; the client now has an
 * unread message).
 *
 * Optimistic: appends a temp message to `qk.threadMessages(threadId)`
 * immediately (falling back to a `"pending"` placeholder key when no thread
 * exists yet). `onError` rolls back to the snapshot; `onSuccess` patches the
 * left-pane `qk.threads()` cache directly (same live-dashboard pattern as
 * useThreads' realtime handler) so the inbox reorders instantly; `onSettled`
 * invalidates both `qk.threads()` and the real thread's message key so the
 * temp-id row is replaced by the real one and a lazily-created thread's id
 * flows back into the UI.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, coachId, thread, text }: SendMessageInput) => {
      let threadId = thread?.id;

      if (!threadId) {
        const { data: createdThread, error: threadError } = await supabase
          .from("threads")
          .insert({ client_id: clientId, coach_id: coachId })
          .select("*")
          .single();
        if (threadError) throw threadError;
        threadId = createdThread.id;
      }

      const { data: message, error: messageError } = await supabase
        .from("messages")
        .insert({ thread_id: threadId, sender_id: coachId, text })
        .select("*")
        .single();
      if (messageError) throw messageError;

      const { error: threadUpdateError } = await supabase
        .from("threads")
        .update({
          last_message: text,
          last_message_at: message.sent_at,
          last_message_by: coachId,
          unread_for_client: true,
          unread_for_coach: false,
        })
        .eq("id", threadId);
      if (threadUpdateError) throw threadUpdateError;

      return { message, threadId };
    },

    onMutate: async ({ thread, text, coachId }) => {
      const key = qk.threadMessages(thread?.id ?? "pending");
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Message[]>(key);
      const optimisticId = `optimistic-${Date.now()}`;

      const optimisticMessage: Message = {
        id: optimisticId,
        thread_id: thread?.id ?? "optimistic",
        sender_id: coachId,
        text,
        sent_at: new Date().toISOString(),
        read: false,
      };
      queryClient.setQueryData<Message[]>(key, (current = []) => [...current, optimisticMessage]);

      return { previous, key };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSuccess: ({ threadId }, { clientId, text }) => {
      queryClient.setQueryData<ThreadWithClient[]>(qk.threads(), (current) => {
        if (!current) return current;
        const existing = current.find((row) => row.client_id === clientId);
        if (!existing) return current;
        const updated: ThreadWithClient = {
          ...existing,
          id: threadId,
          last_message: text,
        };
        return [...current.filter((row) => row.id !== existing.id), updated].sort((a, b) => {
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return bTime - aTime;
        });
      });
    },

    onSettled: (data, _error, { thread }) => {
      void queryClient.invalidateQueries({ queryKey: qk.threads() });
      const threadId = data?.threadId ?? thread?.id;
      if (threadId) {
        void queryClient.invalidateQueries({ queryKey: qk.threadMessages(threadId) });
      }
    },
  });
}
