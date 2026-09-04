import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface MarkMessagesReadInput {
  clientId: string;
  threadId: string;
}

const READ_MARK_LIMIT = 100;

/**
 * Batch mark-read (plan finding #7 / old-app `markMessagesRead`): flips
 * `read = true` on up to 100 unread messages sent by the *other* party
 * (the coach) in this thread, plus `threads.unread_for_client = false`.
 * Called from the messages screen on focus (see messages.tsx) — a client
 * viewing the thread is exactly the "reader" here, so `readerUid` from the
 * old service is always `clientId` on this app.
 *
 * Skips the network round trip entirely when there's nothing unread, same
 * as the old service's `Object.keys(threadPatch).length` / `toMark.length`
 * guards collapsed into one check up front.
 */
export function useMarkMessagesRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, threadId }: MarkMessagesReadInput) => {
      const { data: unread, error: fetchError } = await supabase
        .from("messages")
        .select("id")
        .eq("thread_id", threadId)
        .eq("read", false)
        .neq("sender_id", clientId)
        .limit(READ_MARK_LIMIT);
      if (fetchError) throw fetchError;

      const ids = (unread ?? []).map((m) => m.id);

      // The fetch is capped, so a backlog larger than the cap is only
      // partly marked. Clearing the unread flag anyway left the badge off
      // while messages stayed unread forever — the flag and its rows
      // disagreeing permanently (violation M-2). Keep it set and let the
      // next focus drain the next batch.
      const drained = ids.length < READ_MARK_LIMIT;

      const threadUpdate = supabase
        .from("threads")
        .update({ unread_for_client: drained ? false : true })
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

    onMutate: async ({ clientId }) => {
      const key = qk.messages(clientId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Message[]>(key);

      queryClient.setQueryData<Message[]>(key, (current = []) =>
        current.map((m) => (m.sender_id !== clientId ? { ...m, read: true } : m))
      );

      return { previous, key };
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
