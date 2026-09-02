-- FitInteract collaborative annotation schema.
-- Run first in a new Supabase project's SQL Editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  annotator_code text not null unique,
  display_name text,
  role text not null default 'annotator' check (role in ('admin', 'annotator')),
  created_at timestamptz not null default now()
);

create table if not exists public.query_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  category text,
  name text not null,
  text text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> ''),
  check (btrim(text) <> '')
);

create table if not exists public.text_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  category text,
  name text not null,
  text text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> ''),
  check (btrim(text) <> '')
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  dataset text not null,
  category text,
  original_filename text not null,
  storage_path text not null unique,
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  mime_type text,
  status text not null default 'ready' check (status in ('uploading', 'ready', 'archived', 'error')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(dataset) <> '' and dataset !~ '[\\/[:cntrl:]]' and dataset not like '%..%'),
  check (category is null or (btrim(category) <> '' and category !~ '[\\/[:cntrl:]]' and category not like '%..%')),
  check (btrim(original_filename) <> ''),
  check (
    btrim(storage_path) <> ''
    and storage_path !~ '(^/|\\|:|[[:cntrl:]])'
    and storage_path not like '%..%'
    and storage_path not like '%//%'
    and split_part(storage_path, '/', 1) = dataset
    and (category is null or split_part(storage_path, '/', 2) = category)
  )
);

create table if not exists public.annotation_tasks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  annotator_id uuid not null references public.profiles(id),
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed', 'reviewed')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (video_id, annotator_id)
);

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.annotation_tasks(id) on delete cascade,
  video_id uuid not null references public.videos(id),
  annotator_id uuid not null references public.profiles(id),
  payload jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index if not exists idx_query_templates_enabled_sort on public.query_templates(enabled, sort_order);
create index if not exists idx_text_templates_enabled_sort on public.text_templates(enabled, sort_order);
create index if not exists idx_videos_dataset on public.videos(dataset);
create index if not exists idx_videos_category on public.videos(category);
create index if not exists idx_videos_status on public.videos(status);
create index if not exists idx_annotation_tasks_annotator on public.annotation_tasks(annotator_id);
create index if not exists idx_annotation_tasks_video on public.annotation_tasks(video_id);
create index if not exists idx_annotation_tasks_status on public.annotation_tasks(status);
create index if not exists idx_annotation_tasks_annotator_status on public.annotation_tasks(annotator_id, status);
create index if not exists idx_annotations_task on public.annotations(task_id);
create index if not exists idx_annotations_annotator on public.annotations(annotator_id);
create index if not exists idx_annotations_status on public.annotations(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists query_templates_set_updated_at on public.query_templates;
create trigger query_templates_set_updated_at before update on public.query_templates
for each row execute function public.set_updated_at();

drop trigger if exists text_templates_set_updated_at on public.text_templates;
create trigger text_templates_set_updated_at before update on public.text_templates
for each row execute function public.set_updated_at();

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos
for each row execute function public.set_updated_at();

drop trigger if exists annotations_set_updated_at on public.annotations;
create trigger annotations_set_updated_at before update on public.annotations
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, annotator_code, display_name, role)
  values (
    new.id,
    'U-' || upper(substr(new.id::text, 1, 8)),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    'annotator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_valid_annotation_payload(
  candidate jsonb,
  expected_video_path text,
  require_complete boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  time_window jsonb;
  start_value numeric;
  end_value numeric;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then return false; end if;
  if not (candidate ?& array['video_path', 'query', 'annotation']) then return false; end if;
  if candidate - array['video_path', 'query', 'annotation'] <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(candidate -> 'video_path') <> 'string' then return false; end if;
  if candidate ->> 'video_path' <> expected_video_path then return false; end if;
  if jsonb_typeof(candidate -> 'query') <> 'string' then return false; end if;
  if require_complete and btrim(candidate ->> 'query') = '' then return false; end if;
  if jsonb_typeof(candidate -> 'annotation') <> 'array' then return false; end if;
  if require_complete and jsonb_array_length(candidate -> 'annotation') = 0 then return false; end if;

  for item in select value from jsonb_array_elements(candidate -> 'annotation') loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    if not (item ?& array['time_window_sec', 'text']) then return false; end if;
    if item - array['time_window_sec', 'text'] <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(item -> 'text') <> 'string' or btrim(item ->> 'text') = '' then return false; end if;
    time_window := item -> 'time_window_sec';
    if jsonb_typeof(time_window) <> 'object' then return false; end if;
    if not (time_window ?& array['start', 'end']) then return false; end if;
    if time_window - array['start', 'end'] <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(time_window -> 'start') <> 'number' or jsonb_typeof(time_window -> 'end') <> 'number' then return false; end if;
    start_value := (time_window ->> 'start')::numeric;
    end_value := (time_window ->> 'end')::numeric;
    if start_value < 0 or end_value <= start_value then return false; end if;
    if scale(start_value) > 2 or scale(end_value) > 2 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.enforce_annotation_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_video_id uuid;
  task_annotator_id uuid;
  expected_path text;
begin
  select t.video_id, t.annotator_id, v.storage_path
    into task_video_id, task_annotator_id, expected_path
  from public.annotation_tasks t
  join public.videos v on v.id = t.video_id
  where t.id = new.task_id;

  if task_video_id is null then raise exception 'annotation task does not exist'; end if;
  if new.video_id <> task_video_id or new.annotator_id <> task_annotator_id then
    raise exception 'annotation identity must match its task';
  end if;
  if not public.is_valid_annotation_payload(new.payload, expected_path, new.status in ('submitted', 'reviewed')) then
    raise exception 'annotation payload is invalid or video_path does not match videos.storage_path';
  end if;
  if new.status = 'submitted' and new.submitted_at is null then new.submitted_at = now(); end if;
  return new;
end;
$$;

drop trigger if exists annotations_enforce_consistency on public.annotations;
create trigger annotations_enforce_consistency
before insert or update on public.annotations
for each row execute function public.enforce_annotation_consistency();

-- Physical deletion is forbidden after assignment. Admins should archive instead.
-- This intentionally takes precedence over annotation_tasks.video_id ON DELETE CASCADE.
create or replace function public.protect_assigned_video_from_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.annotation_tasks where video_id = old.id) then
    raise exception 'video has annotation tasks; archive it instead of deleting it';
  end if;
  return old;
end;
$$;

drop trigger if exists videos_protect_assigned_delete on public.videos;
create trigger videos_protect_assigned_delete
before delete on public.videos
for each row execute function public.protect_assigned_video_from_delete();

-- Security-invoker views remain subject to underlying table RLS.
create or replace view public.admin_video_overview
with (security_invoker = true)
as
select
  v.*,
  count(t.id)::bigint as assigned_count,
  count(t.id) filter (where t.status in ('completed', 'reviewed'))::bigint as completed_count
from public.videos v
left join public.annotation_tasks t on t.video_id = v.id
group by v.id;

create or replace view public.admin_annotator_progress
with (security_invoker = true)
as
select
  p.id,
  p.annotator_code,
  p.display_name,
  count(t.id)::bigint as assigned_count,
  count(t.id) filter (where t.status = 'in_progress')::bigint as in_progress_count,
  count(t.id) filter (where t.status in ('completed', 'reviewed'))::bigint as completed_count
from public.profiles p
left join public.annotation_tasks t on t.annotator_id = p.id
where p.role = 'annotator'
group by p.id, p.annotator_code, p.display_name;

-- Private video bucket. Re-running this file also corrects an accidentally public bucket.
insert into storage.buckets (id, name, public)
values ('fitinteract-videos', 'fitinteract-videos', false)
on conflict (id) do update set public = false;

commit;
