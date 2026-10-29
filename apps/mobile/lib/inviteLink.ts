/**
 * Pulls the one-time token out of an invite deep link
 * (`momentum://accept-invite?token_hash=…&type=invite`). Returns null for
 * anything else, so a malformed or repurposed link shows the "invalid" state
 * instead of attempting a verify.
 *
 * Needs the invite email template to build this link — see
 * supabase/templates/invite.html.
 */
export function parseInviteParams(params: { token_hash?: unknown; type?: unknown }): string | null {
  const { token_hash: tokenHash, type } = params;
  if (type !== "invite") return null;
  return typeof tokenHash === "string" && tokenHash.length > 0 ? tokenHash : null;
}
