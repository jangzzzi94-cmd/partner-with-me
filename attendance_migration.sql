/* ============================================================================
   Attendance/fine feature port - DB migration
   (Applied to With Partners' existing Supabase project njtibtadrzayerkpevep)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1) attendance_profiles - attendance-only extra fields (1:1 with profiles)
      name/email/points etc. keep using the existing profiles table; only
      attendance-specific grade/gaejik/checklist/birth etc. live here.
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_profiles (
  uid uuid primary key references public.profiles(id) on delete cascade,
  grade text not null default '후보자' check (grade in ('후보자','AP','TL','SM')),
  birth date,
  bday_year int not null default 0,
  gaejik int not null default 0,
  checklist jsonb not null default '[]'::jsonb,
  tl_members jsonb not null default '[]'::jsonb,
  last_grant text,
  disabled boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.attendance_profiles enable row level security;

drop policy if exists attendance_profiles_select_authenticated on public.attendance_profiles;
create policy attendance_profiles_select_authenticated on public.attendance_profiles
  for select to authenticated using (true);

drop policy if exists attendance_profiles_insert_own on public.attendance_profiles;
drop policy if exists attendance_profiles_insert_own_or_admin on public.attendance_profiles;
create policy attendance_profiles_insert_own_or_admin on public.attendance_profiles
  for insert to authenticated with check (auth.uid() = uid or is_admin(auth.uid()));

drop policy if exists attendance_profiles_update_admin on public.attendance_profiles;
create policy attendance_profiles_update_admin on public.attendance_profiles
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   2) attendance_daily - per-day checkin/photo/report/closing record (JSON blob)
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_daily (
  id text primary key,            -- uid__date
  uid uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists attendance_daily_uid_idx on public.attendance_daily(uid);
create index if not exists attendance_daily_date_idx on public.attendance_daily(date);

alter table public.attendance_daily enable row level security;

drop policy if exists attendance_daily_select_authenticated on public.attendance_daily;
create policy attendance_daily_select_authenticated on public.attendance_daily
  for select to authenticated using (true);

drop policy if exists attendance_daily_insert_own_or_admin on public.attendance_daily;
create policy attendance_daily_insert_own_or_admin on public.attendance_daily
  for insert to authenticated with check (auth.uid() = uid or is_admin(auth.uid()));

drop policy if exists attendance_daily_update_own_or_admin on public.attendance_daily;
create policy attendance_daily_update_own_or_admin on public.attendance_daily
  for update to authenticated using (auth.uid() = uid or is_admin(auth.uid()));

drop policy if exists attendance_daily_delete_admin on public.attendance_daily;
create policy attendance_daily_delete_admin on public.attendance_daily
  for delete to authenticated using (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   3) attendance_fines - payment-status overlay for auto fines + manual fines
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_fines (
  id text primary key,            -- auto: uid__date__kind / manual: random id
  uid uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists attendance_fines_uid_idx on public.attendance_fines(uid);

alter table public.attendance_fines enable row level security;

drop policy if exists attendance_fines_select_authenticated on public.attendance_fines;
create policy attendance_fines_select_authenticated on public.attendance_fines
  for select to authenticated using (true);

drop policy if exists attendance_fines_insert_own_or_admin on public.attendance_fines;
create policy attendance_fines_insert_own_or_admin on public.attendance_fines
  for insert to authenticated with check (auth.uid() = uid or is_admin(auth.uid()));

drop policy if exists attendance_fines_update_own_or_admin on public.attendance_fines;
create policy attendance_fines_update_own_or_admin on public.attendance_fines
  for update to authenticated using (auth.uid() = uid or is_admin(auth.uid()));

drop policy if exists attendance_fines_delete_admin on public.attendance_fines;
create policy attendance_fines_delete_admin on public.attendance_fines
  for delete to authenticated using (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   4) attendance_glog - gaejik (leave-day) change log (admin/auto-grant only)
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_glog (
  id text primary key,
  uid uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attendance_glog_uid_idx on public.attendance_glog(uid);

alter table public.attendance_glog enable row level security;

drop policy if exists attendance_glog_select_authenticated on public.attendance_glog;
create policy attendance_glog_select_authenticated on public.attendance_glog
  for select to authenticated using (true);

drop policy if exists attendance_glog_insert_admin on public.attendance_glog;
create policy attendance_glog_insert_admin on public.attendance_glog
  for insert to authenticated with check (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   5) attendance_holidays - holiday/workday designation (admin-managed)
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_holidays (
  id text primary key,            -- date string
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.attendance_holidays enable row level security;

drop policy if exists attendance_holidays_select_authenticated on public.attendance_holidays;
create policy attendance_holidays_select_authenticated on public.attendance_holidays
  for select to authenticated using (true);

drop policy if exists attendance_holidays_write_admin on public.attendance_holidays;
create policy attendance_holidays_write_admin on public.attendance_holidays
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   6) attendance_settings - attendance rule config (single 'global' row, admin-managed)
   --------------------------------------------------------------------------- */
create table if not exists public.attendance_settings (
  id text primary key,            -- 'global'
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.attendance_settings enable row level security;

drop policy if exists attendance_settings_select_authenticated on public.attendance_settings;
create policy attendance_settings_select_authenticated on public.attendance_settings
  for select to authenticated using (true);

drop policy if exists attendance_settings_write_admin on public.attendance_settings;
create policy attendance_settings_write_admin on public.attendance_settings
  for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

/* ---------------------------------------------------------------------------
   7) Fine -> points deduction RPC. When admin marks a fine "paid via points",
      this actually deducts real With Partners points (1 won = 1 point) and
      logs it in point_logs (same audit trail as admin_add_points).
   --------------------------------------------------------------------------- */
create or replace function public.attendance_deduct_points_for_fine(
  p_user_id uuid,
  p_amount int,
  p_note text
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new_points int;
begin
  if not is_admin(auth.uid()) then
    raise exception 'Only an admin can do this';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  update profiles set points = points - p_amount
  where id = p_user_id
  returning points into v_new_points;

  if v_new_points is null then
    raise exception 'Target member not found';
  end if;

  insert into point_logs (user_id, delta, reason, note, actor_id)
  values (p_user_id, -p_amount, 'attendance_fine', p_note, auth.uid());

  return v_new_points;
end;
$$;

revoke all on function public.attendance_deduct_points_for_fine(uuid, int, text) from public;
grant execute on function public.attendance_deduct_points_for_fine(uuid, int, text) to authenticated;

/* ---------------------------------------------------------------------------
   8) Storage bucket - checkin photos / payment-proof screenshots
      (private, accessed via signed URLs)
   --------------------------------------------------------------------------- */
insert into storage.buckets (id, name, public)
values ('attendance-proofs', 'attendance-proofs', false)
on conflict (id) do nothing;

drop policy if exists attendance_proofs_insert_own on storage.objects;
create policy attendance_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attendance-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists attendance_proofs_select_authenticated on storage.objects;
create policy attendance_proofs_select_authenticated on storage.objects
  for select to authenticated
  using (bucket_id = 'attendance-proofs');

/* ---------------------------------------------------------------------------
   9) get_team_names - lets any authenticated member read just {id, name, role}
      for every approved member (needed for fine/gaejik rank lists and
      calendar labels, which show teammates' names to everyone, not just
      admins). Deliberately narrow: no email or other private fields.
   --------------------------------------------------------------------------- */
create or replace function public.get_team_names()
returns table(id uuid, name text, role text, approval_status text)
language sql
security definer
set search_path to 'public'
as $$
  select id, name, role, approval_status from profiles where approval_status = 'approved';
$$;

revoke all on function public.get_team_names() from public;
grant execute on function public.get_team_names() to authenticated;
