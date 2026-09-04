-- One motivation entry per coach per week, enforced rather than assumed.
--
-- useUpsertMotivationEntry read the row, branched on whether it found one,
-- then inserted or updated. Two coach sessions saving the same week both see
-- "no existing row" and both insert, leaving duplicates that the read path
-- then picks between arbitrarily. Check-then-write always has that race;
-- docs/rules/concurrency.md C4 says to make the write itself idempotent
-- instead, which needs a key to conflict on.
--
-- Partial, because both columns are nullable and NULLs do not compare equal —
-- a plain unique constraint would let unlimited (null, null) rows through.
-- Rows missing either column are not "the coach's entry for a week" and are
-- not what the app upserts against.

create unique index motivation_entries_coach_week_key
  on public.motivation_entries (created_by, week_start)
  where created_by is not null and week_start is not null;

comment on index public.motivation_entries_coach_week_key is
  'One entry per coach per week — the conflict target for the motivation upsert. Partial because created_by/week_start are nullable and NULL never conflicts.';
