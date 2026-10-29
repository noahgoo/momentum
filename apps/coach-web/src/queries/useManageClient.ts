import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { qk } from "./keys";

/**
 * Emailed invites send a link into the client app, which the live mobile build
 * cannot open yet (no accept-invite route). Flip to true in the same release as
 * that build, so no coach mails a link that goes nowhere.
 */
export const EMAIL_INVITES_ENABLED = false;

type ManageClientBody =
  | { action: "create"; email: string; display_name: string; password: string }
  | { action: "invite"; email: string; display_name: string }
  | { action: "resend_invite"; client_id: string }
  | { action: "set_password"; client_id: string; password: string }
  | { action: "set_disabled"; client_id: string; disabled: boolean };

/**
 * Calls the manage-client Edge Function, which holds the auth admin key and
 * checks the caller is the client's coach. Surfaces the function's own message
 * (e.g. "That email already has an account.") rather than the generic
 * "non-2xx status code" supabase-js throws.
 */
export async function invokeManageClient<T = Record<string, never>>(body: ManageClientBody): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-client", { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    const detail = await response?.json?.().catch(() => null);
    throw new Error(detail?.error ?? "Couldn’t reach the server. Try again.");
  }
  return data as T;
}

function useInvalidateRoster() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: qk.clientSummaries() });
}

/** Creates a client account with a password the coach sets and hands over. */
export function useCreateClient() {
  const invalidate = useInvalidateRoster();
  return useMutation({
    mutationFn: (input: { email: string; display_name: string; password: string }) =>
      invokeManageClient<{ client_id: string }>({ action: "create", ...input }),
    onSuccess: () => void invalidate(),
  });
}

/** Creates a client account and emails them a link to set their own password. */
export function useInviteClient() {
  const invalidate = useInvalidateRoster();
  return useMutation({
    mutationFn: (input: { email: string; display_name: string }) =>
      invokeManageClient<{ client_id: string }>({ action: "invite", ...input }),
    onSuccess: () => void invalidate(),
  });
}

/** Re-sends the emailed link for an invite the client has not accepted. */
export function useResendInvite(clientId: string) {
  return useMutation({
    mutationFn: () => invokeManageClient({ action: "resend_invite", client_id: clientId }),
  });
}

/** Sets a new password for one of the coach's clients. No cache change: nothing displayed depends on it. */
export function useSetClientPassword(clientId: string) {
  return useMutation({
    mutationFn: (password: string) => invokeManageClient({ action: "set_password", client_id: clientId, password }),
  });
}

/**
 * Ids of this coach's clients whose emailed invite is still unaccepted. Read
 * from `profiles` (RLS already limits a coach to their own clients) rather than
 * `client_summaries`, which does not carry invite state.
 */
export function usePendingInvites() {
  return useQuery({
    queryKey: qk.pendingInvites(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "client")
        .not("invited_at", "is", null)
        .is("invite_accepted_at", null);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.id));
    },
  });
}
