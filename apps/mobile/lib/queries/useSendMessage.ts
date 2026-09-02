import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message, Thread } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface SendMessageInput {
  clientId: string;
  coachId: string;
  /** Existing thread row, if `useThread` already resolved one. */
  thread: Thread | null;
  text: string;
}

/**
 * Sends a message in the client's own thread, creating the thread row first
 * if this is the client's first-ever message (plan finding #7 / RLS policy
 * `threads_client_insert` — client may create their own thread as long as
 * `coach_id` matches their actual `invited_by`).
 *
 * Overwrite semantics on the thread row (constraint #7 — see the plan): every
 * send unconditionally sets `last_message`/`last_message_at`/`last_message_by`
 * and flips both unread booleans (`unread_for_coach = true`,
 * `unread_for_client = false`) rather than merging/conditionally updating —
 * this mirrors the old Firestore `sendMessage` service's `setDoc(..., {merge:
 * true})` of the same four+two fields every time, just as a plain `update`
 * here since the thread row already exists or was just created above.
 *
 * Optimistic: appends a temp message to the `qk.messages(clientId)` cache
 * immediately; `onError` rolls back to the snapshot (failure banner + retry
 * is the screen's job, driven by mutation state); `onSettled` invalidates so
 * the temp-id row is replaced by the real one.
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
        queryClient.setQueryData<Thread>(qk.thread(clientId), createdThread);
      }

      const { data: message, error: messageError } = await supabase
        .from("messages")
        .insert({ thread_id: threadId, sender_id: clientId, text })
        .select("*")
        .single();
      if (messageError) throw messageError;

      const { error: threadUpdateError } = await supabase
        .from("threads")
        .update({
          last_message: text,
          last_message_at: message.sent_at,
          last_message_by: clientId,
          unread_for_coach: true,
          unread_for_client: false,
        })
        .eq("id", threadId);
      if (threadUpdateError) throw threadUpdateError;

      return message;
    },

    onMutate: async ({ clientId, text }) => {
      const key = qk.messages(clientId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<Message[]>(key);
      const optimisticId = `optimistic-${Date.now()}`;

      const optimisticMessage: Message = {
        id: optimisticId,
        thread_id: "optimistic",
        sender_id: clientId,
        text,
        sent_at: new Date().toISOString(),
        read: false,
      };
      queryClient.setQueryData<Message[]>(key, (current = []) => [...current, optimisticMessage]);

      return { previous, key, optimisticId };
    },

    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },

    onSettled: (_data, _error, { clientId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.messages(clientId) });
    },
  });
}
