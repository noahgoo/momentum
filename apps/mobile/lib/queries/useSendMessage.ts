import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@momentum/shared";
import { supabase } from "../supabase";
import { qk } from "./keys";

interface SendMessageInput {
  clientId: string;
  text: string;
}

/**
 * Sends a message through the `send_message` RPC.
 *
 * Was three sequential writes — create thread, insert message, update the
 * thread's denormalized fields. A failure after the insert stored the message
 * but never flipped unread_for_coach, so the coach was never told about it
 * (violation M-1). The RPC does all of it in one transaction and returns the
 * server `sent_at`, so the optimistic row reconciles against the server clock
 * rather than the device's (M-3).
 *
 * Sender comes from auth.uid(); the RPC sets the unread flag for whichever
 * side did not send, so the same function serves both apps.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, text }: SendMessageInput) => {
      const { data, error } = await supabase.rpc("send_message", {
        p_thread_client_id: clientId,
        p_text: text,
      });
      if (error) throw new Error(error.message);
      return data as { message_id: string; thread_id: string; sent_at: string };
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
