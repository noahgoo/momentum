-- Wave 2.4: enable realtime replication on exactly the tables that need
-- live client/coach updates.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.messages,
  public.threads,
  public.workout_logs,
  public.goal_logs,
  public.client_summaries;
