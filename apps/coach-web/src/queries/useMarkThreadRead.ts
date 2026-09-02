import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@momentum/shared";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";
import type { ThreadWithClient } from "./useThreads";

interface MarkThreadReadInput {
  coachId: string;
  threadId: string;
}

const READ_MARK_LIMIT = 100;

/**
 * Batch mark-read for the coach side (plan finding #7 / mirrors
 * apps/mobile/lib/queries/useMarkMessagesRead.ts with reader flipped to the
 * coach): flips `read = true` on up to 100 unread messages sent by the
 * *other* party (the client) in this thread, plus
 * `threads.unread_for_coach = false`.
 *
 * Called by MessagesPage whenever a thread is opened/focused (this slice's
 * ACCEPTANCE #3) — a coach viewing the thread is exactly the "reader" here.
 * Skips the network round trip when there's nothing unread, same as the
 * mobile hook's guard.
 */
export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ coachId, threadId }: MarkThreadReadInput) => {
      const { data: unread, error: fetchError } = await supabase
        .from("messages")
        .select("id")
        .eq("thread_id", threadId)
        .eq("read", false)
        .neq("sender_id", coachId)
        .limit(READ_MARK_LIMIT);
      if (fetchError) throw fetchError;

      const ids = (unread ?? []).map((m) => m.id);

      const threadUpdate = supabase
        .from("threads")
        .update({ unread_for_coach: false })
        .eq("id", threadId);

      if (ids.length > 0) {
        const messagesUpdate = supabase.from("messages").update({ read: true }).in("id", ids);
        const [threadResult, messagesResult] = await Promise.all([threadUpdate, messagesUpdate]);
        if (threadResult.error) throw threadResult.error;
        if (messagesResult.error) throw messagesResult.error;
      } else {
        const { error } = await threadUpdate;
        if (error) throw error;
      }

      return ids;
    },

    onMutate: async ({ coachId, threadId }) => {
      const messagesKey = qk.threadMessages(threadId);
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previousMessages = queryClient.getQueryData<Message[]>(messagesKey);

      queryClient.setQueryData<Message[]>(messagesKey, (current = []) =>
        current.map((m) => (m.sender_id !== coachId ? { ...m, read: true } : m))
      );

      const previousThreads = queryClient.getQueryData<ThreadWithClient[]>(qk.threads());
      queryClient.setQueryData<ThreadWithClient[]>(qk.threads(), (current) =>
        current?.map((t) => (t.id === threadId ? { ...t, unread_for_coach: false } : t))
      );

      return { previousMessages, messagesKey, previousThreads };
    },

    onError: (_err, _variables, context) => {
      if (context?.previousMessages !== undefined) {
        queryClient.setQueryData(context.messagesKey, context.previousMessages);
      }
      if (context?.previousThreads !== undefined) {
        queryClient.setQueryData(qk.threads(), context.previousThreads);
      }
    },

    onSettled: (_data, _error, { threadId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.threadMessages(threadId) });
      void queryClient.invalidateQueries({ queryKey: qk.threads() });
    },
  });
}
