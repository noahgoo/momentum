-- Migrations ran under the CLI login role, whose default privileges don't
-- grant table access to the API roles. Without these grants PostgREST returns
-- 42501 before RLS is even evaluated. RLS policies (0005-0009) remain the
-- row-level authority; anon deliberately gets NO table grants (auth-only app).

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Future tables created by the migration role inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Tables with no policies for an operation (client_summaries writes,
-- change_requests updates, notification_outbox everything) are still fully
-- blocked: RLS denies by default even with the table-level grant.
