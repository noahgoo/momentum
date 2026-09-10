-- Per-client motivation override.
--
-- motivation_entries is coach-wide "motivation of the week"; these three
-- columns let a coach pin different content for one client without touching
-- what every other client sees. They live on profiles rather than in a new
-- table because the override is a single current value per client, not a
-- history — replacing it is the whole edit.
--
-- Tier: instance. Each column is scoped to exactly one client row, so a write
-- here can never reach another client. Nothing historical reads these columns
-- (the dashboard card is a live view, not a logged fact), so R8 does not
-- apply — no snapshot is required.

alter table profiles
  add column motivation_override_quote text,
  add column motivation_override_image_url text,
  add column motivation_override_until date;

comment on column profiles.motivation_override_quote is
  'Coach-set motivation text shown to this client instead of the weekly motivation_entries card. Null/empty = no override.';
comment on column profiles.motivation_override_image_url is
  'Optional image shown with the override quote. Ignored when the quote is empty.';
comment on column profiles.motivation_override_until is
  'Last date (client timezone) the override displays, inclusive. Null = no expiry.';
