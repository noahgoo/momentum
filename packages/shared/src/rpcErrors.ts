/**
 * RPC error translation.
 *
 * SQL functions raise bare snake_case codes (`raise exception 'not_found_or_forbidden'`)
 * rather than prose, so the app owns the wording. Each caller supplies a map
 * from code to a message its users will understand; anything unrecognized
 * falls through to the raw message rather than being swallowed.
 *
 * See docs/rules/data-model.md R4 ("report in domain terms") and the
 * convention established in supabase/migrations/0013.
 */

export type RpcErrorMessages = Record<string, string>;

/** Codes raised by more than one RPC — callers get these without opting in. */
export const COMMON_RPC_ERRORS: RpcErrorMessages = {
  not_found_or_forbidden: "This item is no longer available.",
  forbidden: "You don't have access to do that.",
  not_your_client: "That client isn't yours.",
};

/**
 * Human-readable message for an error thrown by a `.rpc()` call.
 * Codes shared by more than one RPC live in COMMON_RPC_ERRORS.
 */
export function describeRpcError(error: unknown, messages: RpcErrorMessages = {}): string {
  const raw = error instanceof Error ? error.message : String(error);
  return messages[raw] ?? COMMON_RPC_ERRORS[raw] ?? raw;
}
