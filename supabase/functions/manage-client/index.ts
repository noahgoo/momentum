/**
 * Coach-side client account management: create, invite, set password, disable.
 *
 * These need the auth admin API, so they cannot run from the browser. The
 * caller is authenticated from their JWT, must be a coach, and may only touch
 * profiles they invited (`invited_by = caller`) — the same rule as is_coach_of.
 *
 * Disabling writes two things that must agree: profiles.disabled and the auth
 * ban. Migration 0045 makes this function the only writer of the flag. We never
 * delete an auth user: profiles.id cascades from auth.users, which would take
 * the client's event history with it (data-model.md, C7).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MIN_PASSWORD_LENGTH = 8;
/** ~100 years. Supabase has no "forever" ban; this is what the dashboard uses. */
const BAN_FOREVER = "876000h";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** A message the coach can act on, as opposed to an unexpected failure. */
class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireCoach(req: Request): Promise<string> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new DomainError("Sign in again.", 401);

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) throw new DomainError("Sign in again.", 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("role, disabled")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profile?.role !== "coach" || profile.disabled) {
    throw new DomainError("Only an active coach can manage clients.", 403);
  }
  return userData.user.id;
}

/** The client must be this coach's own. Same error either way, so ids don't leak. */
async function requireOwnClient(coachId: string, clientId: unknown) {
  if (typeof clientId !== "string") throw new DomainError("Missing client.");
  const { data } = await admin
    .from("profiles")
    .select("id, email, role, invited_by, invited_at, invite_accepted_at")
    .eq("id", clientId)
    .maybeSingle();

  if (!data || data.role !== "client" || data.invited_by !== coachId) {
    throw new DomainError("Client not found.", 404);
  }
  return data;
}

function cleanEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("Enter a valid email address.");
  return email;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new DomainError("Enter the client's name.");
  return name;
}

function cleanPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

function isDuplicateEmail(message: string): boolean {
  return /already (been )?registered|already exists|email_exists/i.test(message);
}

async function create(coachId: string, body: Record<string, unknown>) {
  const email = cleanEmail(body.email);
  const displayName = cleanName(body.display_name);
  const password = cleanPassword(body.password);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role: "client", invited_by: coachId, display_name: displayName },
  });
  if (error) {
    if (isDuplicateEmail(error.message)) throw new DomainError("That email already has an account.", 409);
    throw error;
  }
  return { client_id: data.user.id };
}

async function invite(coachId: string, body: Record<string, unknown>) {
  const email = cleanEmail(body.email);
  const displayName = cleanName(body.display_name);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { role: "client", invited_by: coachId, display_name: displayName },
    redirectTo: Deno.env.get("INVITE_REDIRECT_URL") ?? undefined,
  });
  if (error) {
    if (isDuplicateEmail(error.message)) throw new DomainError("That email already has an account.", 409);
    throw error;
  }
  return { client_id: data.user.id };
}

async function resendInvite(coachId: string, body: Record<string, unknown>) {
  const client = await requireOwnClient(coachId, body.client_id);
  // Safe to apply twice (C4): an accepted invite is not re-sent, and a repeat
  // for a pending one just mails a fresh link.
  if (!client.invited_at || client.invite_accepted_at || !client.email) {
    throw new DomainError("This client has already accepted their invite.", 409);
  }

  // For a user who has not confirmed yet, inviting the same address again
  // re-sends the link instead of failing.
  const { error } = await admin.auth.admin.inviteUserByEmail(client.email, {
    redirectTo: Deno.env.get("INVITE_REDIRECT_URL") ?? undefined,
  });
  if (error) throw error;
  return {};
}

async function setPassword(coachId: string, body: Record<string, unknown>) {
  const client = await requireOwnClient(coachId, body.client_id);
  const password = cleanPassword(body.password);
  const { error } = await admin.auth.admin.updateUserById(client.id, { password });
  if (error) throw error;
  return {};
}

async function setDisabled(coachId: string, body: Record<string, unknown>) {
  const client = await requireOwnClient(coachId, body.client_id);
  if (typeof body.disabled !== "boolean") throw new DomainError("Missing disabled flag.");

  // Ban first: if the flag write then fails, the client is locked out and the
  // coach can retry, rather than shown as disabled while still able to log in.
  const { error: banError } = await admin.auth.admin.updateUserById(client.id, {
    ban_duration: body.disabled ? BAN_FOREVER : "none",
  });
  if (banError) throw banError;

  const { error } = await admin.from("profiles").update({ disabled: body.disabled }).eq("id", client.id);
  if (error) throw error;
  return {};
}

const actions: Record<string, (coachId: string, body: Record<string, unknown>) => Promise<unknown>> = {
  create,
  invite,
  resend_invite: resendInvite,
  set_password: setPassword,
  set_disabled: setDisabled,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const coachId = await requireCoach(req);
    const body = (await req.json()) as Record<string, unknown>;
    const handler = typeof body.action === "string" ? actions[body.action] : undefined;
    if (!handler) throw new DomainError("Unknown action.");
    return json(await handler(coachId, body));
  } catch (err) {
    if (err instanceof DomainError) return json({ error: err.message }, err.status);
    // Never echo internals (or anything that might carry a password) to the browser.
    console.error("manage-client failed:", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
