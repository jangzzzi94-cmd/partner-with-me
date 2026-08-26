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
   7) Fine -> points deduction RPC. Deducts real With Partners points
      (1 won = 1 point) and logs it in point_logs (same audit trail as
      admin_add_points). Two callers:
        - an admin marking a fine "paid via points" for someone else
          (no daily cap - admin override, matches admin_add_points' trust level)
        - a member paying their OWN fine with their OWN points (self-service),
          capped at 20,000 points/day (KST calendar day), checked here against
          point_logs so the limit can't be bypassed by calling the RPC directly.
      Also refuses to push a balance negative.
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
  v_current_points int;
  v_is_self boolean;
  v_used_today int;
begin
  v_is_self := (auth.uid() = p_user_id);
  if not v_is_self and not is_admin(auth.uid()) then
    raise exception 'Not allowed';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  select points into v_current_points from profiles where id = p_user_id;
  if v_current_points is null then
    raise exception 'Target member not found';
  end if;
  if v_current_points < p_amount then
    raise exception 'Not enough points';
  end if;

  if v_is_self then
    select coalesce(sum(-delta), 0) into v_used_today
    from point_logs
    where user_id = p_user_id
      and reason = 'attendance_fine'
      and (created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
    if v_used_today + p_amount > 20000 then
      raise exception 'Daily point payment limit exceeded';
    end if;
  end if;

  update profiles set points = points - p_amount
  where id = p_user_id
  returning points into v_new_points;

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

/* ---------------------------------------------------------------------------
   10) fee_start - the date fine accrual actually starts for a member.
      Previously fine accrual always started at joined_at, so promoting a
      long-time existing member from 후보자(exempt) to AP/TL(fined) would
      retroactively generate fines for their whole past history. fee_start
      lets the app record "the day this member's grade actually became
      fine-liable" and use max(joined_at, fee_start) as the real start date.
      New members never get this set (stays null), so their fee window is
      still governed purely by joined_at, as before.
   --------------------------------------------------------------------------- */
alter table public.attendance_profiles
  add column if not exists fee_start date;

/* ---------------------------------------------------------------------------
   11) hidden - admin can hide a member from the team-fine ("벌금") page's
      team-wide list without deactivating them (they still check in, still
      get graded/fined normally - only the fines tab's "전체 팀원" list and
      filter dropdown skip them). A hidden member still sees their own fines
      when they open the page themselves.
   --------------------------------------------------------------------------- */
alter table public.attendance_profiles
  add column if not exists hidden boolean not null default false;

/* ---------------------------------------------------------------------------
   12) attendance_update_my_birth - lets a member set/change their OWN
      birthdate from the main site's 프로필(profile.html) screen, not just
      at signup. attendance_profiles' update policy is admin-only (see 1),
      so a normal member writing to it directly would be blocked by RLS -
      this RPC is a narrow, self-only escape hatch (same pattern as
      update_my_name / update_my_nickname): it only ever touches the
      caller's own row's birth column, upserting a row if one doesn't exist
      yet (e.g. they haven't opened the 근태 page before). Because
      attendance_profiles.birth is exactly the field the 근태/팀벌금 page
      already reads for birthday-gaejik logic, saving it here automatically
      shows up there too - no separate sync needed.
   --------------------------------------------------------------------------- */
create or replace function public.attendance_update_my_birth(p_birth date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.attendance_profiles (uid, birth)
  values (auth.uid(), p_birth)
  on conflict (uid) do update set birth = excluded.birth;
end;
$$;

revoke all on function public.attendance_update_my_birth(date) from public;
grant execute on function public.attendance_update_my_birth(date) to authenticated;

/* ---------------------------------------------------------------------------
   13) attendance_use_my_gaejik - lets a member spend/refund their OWN 개직
      (leave day) when submitting their own 다음 근무일 report and picking
      "개직". attendance_profiles' update policy is admin-only (see 1), so a
      member trying to decrement their own gaejik count directly (as the
      report screen used to do via a plain upsert) was rejected by RLS with
      "권한이 없습니다. 관리자만 가능한 작업입니다." - which also meant the
      whole report submission aborted before the work-type itself ("개직")
      ever got saved, so the calendar never showed 개직 for that day either.
      This RPC is a narrow, self-only escape hatch (same pattern as
      attendance_update_my_birth): it only ever adjusts the caller's own
      gaejik count, refuses to push it negative, and writes the same
      attendance_glog row shape the admin-side change_gaejik flow already
      writes (name/delta/after/reason/by/at/date) so the "개직 로그" tab
      keeps working unchanged for self-service entries too.
   --------------------------------------------------------------------------- */
create or replace function public.attendance_use_my_gaejik(p_delta int, p_reason text)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_after int;
  v_name text;
  v_glog_id text;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Invalid delta';
  end if;

  update public.attendance_profiles
  set gaejik = gaejik + p_delta
  where uid = auth.uid()
  returning gaejik into v_after;

  if v_after is null then
    raise exception 'Attendance profile not found';
  end if;
  if v_after < 0 then
    raise exception 'Not enough 개직 remaining';
  end if;

  select name into v_name from public.profiles where id = auth.uid();
  v_glog_id := auth.uid()::text || '_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  insert into public.attendance_glog (id, uid, data)
  values (
    v_glog_id,
    auth.uid(),
    jsonb_build_object(
      'uid', auth.uid(),
      'name', coalesce(v_name, ''),
      'delta', p_delta,
      'after', v_after,
      'reason', p_reason,
      'auto', false,
      'by', coalesce(v_name, ''),
      'at', (extract(epoch from clock_timestamp()) * 1000)::bigint,
      'date', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD')
    )
  );

  return v_after;
end;
$$;

revoke all on function public.attendance_use_my_gaejik(int, text) from public;
grant execute on function public.attendance_use_my_gaejik(int, text) to authenticated;

-- =========================================================================
-- 일마감 체크리스트 "항목 목록" 저장용 RPC (attendance_update_my_checklist)
-- =========================================================================
-- attendance_profiles 테이블은 본인이라도 직접 update 할 수 없다(RLS가 관리자
-- 전용 UPDATE만 허용 - attendance_profiles_update_admin). 그래서 일마감 화면에서
-- 오늘 체크한 "항목 목록"(다음날 체크리스트를 다시 세팅할 때 쓰는 템플릿, 컬럼:
-- attendance_profiles.checklist, jsonb)을 저장하려던 기존 코드(DB.set("users", ...))는
-- 관리자 계정에서만 조용히 성공하고, 나머지 팀원들은 전부 실패(에러가 화면에 표시되지
-- 않고 그냥 삼켜짐)하고 있었다. 그 결과 오늘 체크한 daily.closingItems 자체는 잘
-- 저장되지만, 다음날 새로 뜨는 체크리스트의 "항목 이름 목록"은 텅 빈 채로 나타나는
-- 문제가 있었다 ("일마감 내용이 다음날 사라진다"는 버그의 근본 원인).
--
-- birth(attendance_update_my_birth), gaejik(attendance_use_my_gaejik)과 동일한
-- 패턴으로, auth.uid() 범위로 제한된 security definer RPC를 통해서만 본인이
-- checklist를 쓸 수 있게 한다.
--
-- 이미 라이브 DB(Supabase SQL Editor)에 적용 완료됨.

create or replace function public.attendance_update_my_checklist(p_checklist jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.attendance_profiles
  set checklist = coalesce(p_checklist, '[]'::jsonb)
  where uid = auth.uid();

  if not found then
    insert into public.attendance_profiles (uid, checklist)
    values (auth.uid(), coalesce(p_checklist, '[]'::jsonb));
  end if;
end;
$function$;

revoke all on function public.attendance_update_my_checklist(jsonb) from public;
grant execute on function public.attendance_update_my_checklist(jsonb) to authenticated;
