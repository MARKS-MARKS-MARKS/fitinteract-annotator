-- FitInteract grants, RLS policies, Storage policies and guarded RPCs.
-- Run after schema.sql.

begin;

-- Trigger/helper functions are internal implementation details, not browser APIs.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_valid_annotation_payload(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.enforce_annotation_consistency() from public, anon, authenticated;
revoke all on function public.protect_assigned_video_from_delete() from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.can_read_video_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.videos v
    join public.annotation_tasks t on t.video_id = v.id
    where v.storage_path = object_name
      and t.annotator_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.query_templates enable row level security;
alter table public.text_templates enable row level security;
alter table public.videos enable row level security;
alter table public.annotation_tasks enable row level security;
alter table public.annotations enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.query_templates from anon, authenticated;
revoke all on table public.text_templates from anon, authenticated;
revoke all on table public.videos from anon, authenticated;
revoke all on table public.annotation_tasks from anon, authenticated;
revoke all on table public.annotations from anon, authenticated;
revoke all on table public.admin_video_overview from anon, authenticated;
revoke all on table public.admin_annotator_progress from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (annotator_code, display_name, role) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.query_templates to authenticated;
grant select, insert, update, delete on table public.text_templates to authenticated;
grant select, insert, update, delete on table public.videos to authenticated;
grant select, insert, delete on table public.annotation_tasks to authenticated;
grant select on table public.annotations to authenticated;
grant select on table public.admin_video_overview to authenticated;
grant select on table public.admin_annotator_progress to authenticated;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists query_templates_read on public.query_templates;
create policy query_templates_read on public.query_templates
for select to authenticated
using (enabled or public.is_admin());
drop policy if exists query_templates_admin_insert on public.query_templates;
create policy query_templates_admin_insert on public.query_templates
for insert to authenticated with check (public.is_admin() and (created_by is null or created_by = auth.uid()));
drop policy if exists query_templates_admin_update on public.query_templates;
create policy query_templates_admin_update on public.query_templates
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists query_templates_admin_delete on public.query_templates;
create policy query_templates_admin_delete on public.query_templates
for delete to authenticated using (public.is_admin());

drop policy if exists text_templates_read on public.text_templates;
create policy text_templates_read on public.text_templates
for select to authenticated
using (enabled or public.is_admin());
drop policy if exists text_templates_admin_insert on public.text_templates;
create policy text_templates_admin_insert on public.text_templates
for insert to authenticated with check (public.is_admin() and (created_by is null or created_by = auth.uid()));
drop policy if exists text_templates_admin_update on public.text_templates;
create policy text_templates_admin_update on public.text_templates
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists text_templates_admin_delete on public.text_templates;
create policy text_templates_admin_delete on public.text_templates
for delete to authenticated using (public.is_admin());

drop policy if exists videos_select_authorized on public.videos;
create policy videos_select_authorized on public.videos
for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.annotation_tasks t
    where t.video_id = videos.id and t.annotator_id = auth.uid()
  )
);
drop policy if exists videos_admin_insert on public.videos;
create policy videos_admin_insert on public.videos
for insert to authenticated with check (public.is_admin() and (created_by is null or created_by = auth.uid()));
drop policy if exists videos_admin_update on public.videos;
create policy videos_admin_update on public.videos
for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists videos_admin_delete on public.videos;
create policy videos_admin_delete on public.videos
for delete to authenticated using (public.is_admin());

drop policy if exists tasks_select_own_or_admin on public.annotation_tasks;
create policy tasks_select_own_or_admin on public.annotation_tasks
for select to authenticated using (annotator_id = auth.uid() or public.is_admin());
drop policy if exists tasks_admin_insert on public.annotation_tasks;
create policy tasks_admin_insert on public.annotation_tasks
for insert to authenticated
with check (public.is_admin() and (assigned_by is null or assigned_by = auth.uid()));
drop policy if exists tasks_admin_delete on public.annotation_tasks;
create policy tasks_admin_delete on public.annotation_tasks
for delete to authenticated using (public.is_admin());

drop policy if exists annotations_select_own_or_admin on public.annotations;
create policy annotations_select_own_or_admin on public.annotations
for select to authenticated using (annotator_id = auth.uid() or public.is_admin());

-- The browser cannot directly INSERT/UPDATE annotations or UPDATE tasks.
-- Guarded SECURITY DEFINER RPCs below derive identity/video fields and enforce state transitions.
create or replace function public.start_annotation_task(p_task_id uuid)
returns public.annotation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.annotation_tasks;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into task_row from public.annotation_tasks where id = p_task_id for update;
  if task_row.id is null then raise exception 'task not found'; end if;
  if task_row.annotator_id <> auth.uid() and not public.is_admin() then raise exception 'not allowed'; end if;
  if task_row.status = 'assigned' then
    update public.annotation_tasks
    set status = 'in_progress', started_at = coalesce(started_at, now())
    where id = p_task_id
    returning * into task_row;
  end if;
  return task_row;
end;
$$;

create or replace function public.save_annotation_payload(
  p_task_id uuid,
  p_payload jsonb,
  p_submit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.annotation_tasks;
  video_row public.videos;
  annotation_row public.annotations;
  annotation_status text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into task_row from public.annotation_tasks where id = p_task_id for update;
  if task_row.id is null then raise exception 'task not found'; end if;
  if task_row.annotator_id <> auth.uid() and not public.is_admin() then raise exception 'not allowed'; end if;
  if task_row.status = 'reviewed' and not public.is_admin() then raise exception 'reviewed task is locked'; end if;

  select * into video_row from public.videos where id = task_row.video_id;
  if video_row.id is null then raise exception 'video not found'; end if;
  if not public.is_valid_annotation_payload(p_payload, video_row.storage_path, p_submit) then
    raise exception 'invalid payload or video_path mismatch';
  end if;

  annotation_status := case
    when p_submit or task_row.status in ('completed', 'reviewed') then 'submitted'
    else 'draft'
  end;

  insert into public.annotations (task_id, video_id, annotator_id, payload, status, submitted_at)
  values (
    task_row.id,
    task_row.video_id,
    task_row.annotator_id,
    p_payload,
    annotation_status,
    case when annotation_status = 'submitted' then now() else null end
  )
  on conflict (task_id) do update
  set payload = excluded.payload,
      status = excluded.status,
      submitted_at = case
        when excluded.status = 'submitted' then coalesce(public.annotations.submitted_at, now())
        else null
      end
  returning * into annotation_row;

  if p_submit then
    update public.annotation_tasks
    set status = 'completed',
        started_at = coalesce(started_at, now()),
        completed_at = now(),
        reviewed_at = null
    where id = task_row.id
    returning * into task_row;
  elsif task_row.status = 'assigned' then
    update public.annotation_tasks
    set status = 'in_progress', started_at = coalesce(started_at, now())
    where id = task_row.id
    returning * into task_row;
  end if;

  return jsonb_build_object('annotation', to_jsonb(annotation_row), 'task', to_jsonb(task_row));
end;
$$;

create or replace function public.reset_annotation_task(p_task_id uuid)
returns public.annotation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.annotation_tasks;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  update public.annotation_tasks
  set status = 'in_progress',
      started_at = coalesce(started_at, now()),
      completed_at = null,
      reviewed_at = null
  where id = p_task_id and status in ('completed', 'reviewed')
  returning * into task_row;
  if task_row.id is null then raise exception 'completed/reviewed task not found'; end if;
  update public.annotations set status = 'draft', submitted_at = null where task_id = p_task_id;
  return task_row;
end;
$$;

create or replace function public.delete_unassigned_video(p_video_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  object_path text;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  select storage_path into object_path from public.videos where id = p_video_id for update;
  if object_path is null then raise exception 'video not found'; end if;
  if exists (select 1 from public.annotation_tasks where video_id = p_video_id) then
    raise exception 'video has annotation tasks; archive it instead';
  end if;
  delete from public.videos where id = p_video_id;
  return object_path;
end;
$$;

create or replace function public.get_admin_dashboard_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  return jsonb_build_object(
    'total_videos', (select count(*) from public.videos),
    'assigned_videos', (select count(distinct video_id) from public.annotation_tasks),
    'total_tasks', (select count(*) from public.annotation_tasks),
    'completed_tasks', (select count(*) from public.annotation_tasks where status in ('completed', 'reviewed')),
    'in_progress_tasks', (select count(*) from public.annotation_tasks where status = 'in_progress'),
    'unassigned_videos', (select count(*) from public.videos v where not exists (select 1 from public.annotation_tasks t where t.video_id = v.id)),
    'submitted_annotations', (select count(*) from public.annotations where status in ('submitted', 'reviewed'))
  );
end;
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_read_video_object(text) from public, anon;
revoke all on function public.start_annotation_task(uuid) from public, anon;
revoke all on function public.save_annotation_payload(uuid, jsonb, boolean) from public, anon;
revoke all on function public.reset_annotation_task(uuid) from public, anon;
revoke all on function public.delete_unassigned_video(uuid) from public, anon;
revoke all on function public.get_admin_dashboard_metrics() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_read_video_object(text) to authenticated;
grant execute on function public.start_annotation_task(uuid) to authenticated;
grant execute on function public.save_annotation_payload(uuid, jsonb, boolean) to authenticated;
grant execute on function public.reset_annotation_task(uuid) to authenticated;
grant execute on function public.delete_unassigned_video(uuid) to authenticated;
grant execute on function public.get_admin_dashboard_metrics() to authenticated;

drop policy if exists fitinteract_video_admin_select on storage.objects;
create policy fitinteract_video_admin_select on storage.objects
for select to authenticated
using (bucket_id = 'fitinteract-videos' and public.is_admin());

drop policy if exists fitinteract_video_assigned_select on storage.objects;
create policy fitinteract_video_assigned_select on storage.objects
for select to authenticated
using (
  bucket_id = 'fitinteract-videos'
  and public.can_read_video_object(name)
);

drop policy if exists fitinteract_video_admin_insert on storage.objects;
create policy fitinteract_video_admin_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'fitinteract-videos' and public.is_admin());

drop policy if exists fitinteract_video_admin_update on storage.objects;
create policy fitinteract_video_admin_update on storage.objects
for update to authenticated
using (bucket_id = 'fitinteract-videos' and public.is_admin())
with check (bucket_id = 'fitinteract-videos' and public.is_admin());

drop policy if exists fitinteract_video_admin_delete on storage.objects;
create policy fitinteract_video_admin_delete on storage.objects
for delete to authenticated
using (bucket_id = 'fitinteract-videos' and public.is_admin());

commit;
