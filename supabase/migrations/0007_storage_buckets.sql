-- Wave 2.3: storage buckets + storage.objects policies.
-- exercise-demos, motivation-images: coach writes own uploads, any
-- authenticated user reads. progress-photos: client owns {client_id}/... path
-- prefix, coach reads own clients' prefixes.

insert into storage.buckets (id, name, public)
values
  ('exercise-demos', 'exercise-demos', false),
  ('motivation-images', 'motivation-images', false),
  ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- exercise-demos
-- ---------------------------------------------------------------------------

create policy exercise_demos_coach_insert
  on storage.objects for insert
  with check (
    bucket_id = 'exercise-demos'
    and owner = auth.uid()
    and public.is_coach()
  );

comment on policy exercise_demos_coach_insert on storage.objects is 'Coach can upload into exercise-demos as long as they own the resulting object.';

create policy exercise_demos_coach_update
  on storage.objects for update
  using (bucket_id = 'exercise-demos' and owner = auth.uid() and public.is_coach())
  with check (bucket_id = 'exercise-demos' and owner = auth.uid() and public.is_coach());

comment on policy exercise_demos_coach_update on storage.objects is 'Coach can update their own exercise-demos uploads.';

create policy exercise_demos_coach_delete
  on storage.objects for delete
  using (bucket_id = 'exercise-demos' and owner = auth.uid() and public.is_coach());

comment on policy exercise_demos_coach_delete on storage.objects is 'Coach can delete their own exercise-demos uploads.';

create policy exercise_demos_authenticated_select
  on storage.objects for select
  using (bucket_id = 'exercise-demos' and auth.role() = 'authenticated');

comment on policy exercise_demos_authenticated_select on storage.objects is 'Any authenticated user (coach or client) can view exercise demo media.';

-- ---------------------------------------------------------------------------
-- motivation-images
-- ---------------------------------------------------------------------------

create policy motivation_images_coach_insert
  on storage.objects for insert
  with check (
    bucket_id = 'motivation-images'
    and owner = auth.uid()
    and public.is_coach()
  );

comment on policy motivation_images_coach_insert on storage.objects is 'Coach can upload into motivation-images as long as they own the resulting object.';

create policy motivation_images_coach_update
  on storage.objects for update
  using (bucket_id = 'motivation-images' and owner = auth.uid() and public.is_coach())
  with check (bucket_id = 'motivation-images' and owner = auth.uid() and public.is_coach());

comment on policy motivation_images_coach_update on storage.objects is 'Coach can update their own motivation-images uploads.';

create policy motivation_images_coach_delete
  on storage.objects for delete
  using (bucket_id = 'motivation-images' and owner = auth.uid() and public.is_coach());

comment on policy motivation_images_coach_delete on storage.objects is 'Coach can delete their own motivation-images uploads.';

create policy motivation_images_authenticated_select
  on storage.objects for select
  using (bucket_id = 'motivation-images' and auth.role() = 'authenticated');

comment on policy motivation_images_authenticated_select on storage.objects is 'Any authenticated user (coach or client) can view motivation images.';

-- ---------------------------------------------------------------------------
-- progress-photos (path convention: {client_id}/...)
-- ---------------------------------------------------------------------------

create policy progress_photos_client_insert
  on storage.objects for insert
  with check (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on policy progress_photos_client_insert on storage.objects is 'Client can upload only under their own {client_id}/ prefix.';

create policy progress_photos_client_select
  on storage.objects for select
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on policy progress_photos_client_select on storage.objects is 'Client can view only their own {client_id}/ prefix.';

create policy progress_photos_client_delete
  on storage.objects for delete
  using (
    bucket_id = 'progress-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

comment on policy progress_photos_client_delete on storage.objects is 'Client can delete only their own {client_id}/ prefix.';

create policy progress_photos_coach_select
  on storage.objects for select
  using (
    bucket_id = 'progress-photos'
    and public.is_coach_of(((storage.foldername(name))[1])::uuid)
  );

comment on policy progress_photos_coach_select on storage.objects is 'Coach can view progress photos under the {client_id}/ prefix of their own clients.';
