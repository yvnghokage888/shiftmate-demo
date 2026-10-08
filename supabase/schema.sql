-- ShiftMate demo schema.
-- Run once in a fresh Supabase project (SQL editor), then run seed.sql.
-- This is a reconstruction for the public demo: it contains no real business data.

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.staff_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  sort_order int
);

create table public.staff (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  email                text,
  phone                text,
  is_manager           boolean not null default false,
  user_id              uuid unique references auth.users(id) on delete set null,
  active               boolean not null default true,
  pin_hash             text,                       -- bcrypt; never readable from the browser
  has_pin              boolean generated always as (pin_hash is not null) stored,
  tag_ids              uuid[] not null default '{}',
  min_hours            numeric,
  must_change_password boolean not null default false
);

create table public.shifts (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff(id) on delete cascade,
  job_name       text,
  date           date not null,
  start_time     time,
  duration_hours numeric,
  shift_type     text not null default 'job',
  notes          text,
  published      boolean not null default false
);
create index shifts_date_idx on public.shifts (date);
create index shifts_staff_date_idx on public.shifts (staff_id, date);

create table public.clock_logs (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  date       date not null,
  clock_in   timestamptz,
  clock_out  timestamptz,
  note       text,
  took_break boolean
);
create index clock_logs_date_idx on public.clock_logs (date);
create index clock_logs_staff_date_idx on public.clock_logs (staff_id, date);

create table public.trucks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  registration text,
  type         text,
  status       text,
  notes        text,
  active       boolean not null default true,
  color        text,
  wof_expiry   date,
  rego_expiry  date
);

create table public.truck_logs (
  id         uuid primary key default gen_random_uuid(),
  truck_id   uuid not null references public.trucks(id) on delete cascade,
  log_date   date not null,
  type       text,
  detail     text,
  cost       numeric,
  created_at timestamptz not null default now()
);

create table public.staff_recurring_unavailable (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  reason     text,
  created_by uuid references public.staff(id) on delete set null,
  unique (staff_id, weekday)
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  shift_date date,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create table public.access_grants (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('staff', 'team')),
  subject_id   uuid not null,                  -- staff.id, or staff_tags.id for a team
  resource     text not null,
  can_read     boolean not null default false,
  can_write    boolean not null default false,
  unique (subject_type, subject_id, resource)
);

create table public.staff_hr_notes (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  notes      text,
  updated_at timestamptz,
  updated_by uuid references public.staff(id) on delete set null
);

create table public.roster_prefs (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  crew_order uuid[] not null default '{}',
  updated_at timestamptz
);

-- One row: the hashed device-setup code for the kiosk tablet.
create table public.kiosk_config (
  id        boolean primary key default true check (id),
  code_hash text not null
);

-- ── Permission helpers ──────────────────────────────────────────────────────
-- Managers pass every check. Everyone else needs a grant, either directly or
-- through a team (staff tag) they belong to.

create function public.auth_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where user_id = auth.uid() and active
$$;

create function public.auth_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_manager from public.staff where user_id = auth.uid() and active), false)
$$;

create function public.auth_can(p_resource text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_is_manager() or exists (
    select 1
    from public.access_grants g
    join public.staff s on s.user_id = auth.uid() and s.active
    where g.resource = p_resource
      and (case when p_write then g.can_write else g.can_read end)
      and ((g.subject_type = 'staff' and g.subject_id = s.id)
        or (g.subject_type = 'team'  and g.subject_id = any (s.tag_ids)))
  )
$$;

create function public.my_permissions()
returns table (resource text, can_read boolean, can_write boolean)
language sql stable security definer set search_path = public as $$
  select r.resource, public.auth_can(r.resource), public.auth_can(r.resource, true)
  from (values ('roster'), ('timesheets'), ('team'), ('fleet'), ('hr')) as r(resource)
$$;

-- ── Row-level security ──────────────────────────────────────────────────────

alter table public.staff                       enable row level security;
alter table public.staff_tags                  enable row level security;
alter table public.shifts                      enable row level security;
alter table public.clock_logs                  enable row level security;
alter table public.trucks                      enable row level security;
alter table public.truck_logs                  enable row level security;
alter table public.staff_recurring_unavailable enable row level security;
alter table public.notifications               enable row level security;
alter table public.access_grants               enable row level security;
alter table public.staff_hr_notes              enable row level security;
alter table public.roster_prefs                enable row level security;
alter table public.kiosk_config                enable row level security;   -- no policies: unreadable

create policy staff_read   on public.staff for select to authenticated using (true);
create policy staff_write  on public.staff for all    to authenticated
  using (public.auth_can('team', true)) with check (public.auth_can('team', true));

-- The kiosk tablet is not signed in: it may list active, non-manager staff by name only.
create policy staff_kiosk_read on public.staff for select to anon using (active and not is_manager);

create policy tags_read  on public.staff_tags for select to authenticated using (true);
create policy tags_write on public.staff_tags for all    to authenticated
  using (public.auth_can('team', true)) with check (public.auth_can('team', true));

create policy shifts_read  on public.shifts for select to authenticated
  using (public.auth_can('roster', true) or (public.auth_can('roster') and published));
create policy shifts_write on public.shifts for all    to authenticated
  using (public.auth_can('roster', true)) with check (public.auth_can('roster', true));

create policy clock_read  on public.clock_logs for select to authenticated
  using (public.auth_can('timesheets') or staff_id = public.auth_staff_id());
create policy clock_write on public.clock_logs for all    to authenticated
  using (public.auth_can('timesheets', true)) with check (public.auth_can('timesheets', true));

create policy trucks_read  on public.trucks for select to authenticated using (public.auth_can('fleet'));
create policy trucks_write on public.trucks for all    to authenticated
  using (public.auth_can('fleet', true)) with check (public.auth_can('fleet', true));
create policy tlogs_read   on public.truck_logs for select to authenticated using (public.auth_can('fleet'));
create policy tlogs_write  on public.truck_logs for all    to authenticated
  using (public.auth_can('fleet', true)) with check (public.auth_can('fleet', true));

create policy recur_read  on public.staff_recurring_unavailable for select to authenticated
  using (public.auth_can('roster'));
create policy recur_write on public.staff_recurring_unavailable for all    to authenticated
  using (public.auth_can('roster', true) or staff_id = public.auth_staff_id())
  with check (public.auth_can('roster', true) or staff_id = public.auth_staff_id());

create policy notif_own on public.notifications for select to authenticated
  using (staff_id = public.auth_staff_id());

create policy grants_read  on public.access_grants for select to authenticated
  using (public.auth_is_manager() or (subject_type = 'staff' and subject_id = public.auth_staff_id()));
create policy grants_write on public.access_grants for all    to authenticated
  using (public.auth_is_manager()) with check (public.auth_is_manager());

create policy hr_read  on public.staff_hr_notes for select to authenticated using (public.auth_can('hr'));
create policy hr_write on public.staff_hr_notes for all    to authenticated
  using (public.auth_can('hr', true)) with check (public.auth_can('hr', true));

create policy prefs_own on public.roster_prefs for all to authenticated
  using (staff_id = public.auth_staff_id()) with check (staff_id = public.auth_staff_id());

-- Column-level grants: the PIN hash is never selectable, and the kiosk (anon)
-- can only ever read id / name / active / is_manager / has_pin.
revoke all on public.staff from anon, authenticated;
grant select (id, name, active, is_manager, has_pin) on public.staff to anon;
grant select (id, name, email, phone, is_manager, user_id, active, has_pin, tag_ids, min_hours, must_change_password)
  on public.staff to authenticated;
grant insert (name, email, phone, is_manager, active, tag_ids, min_hours, must_change_password),
      update (name, email, phone, is_manager, active, tag_ids, min_hours, must_change_password),
      delete on public.staff to authenticated;

grant select, insert, update, delete on
  public.staff_tags, public.shifts, public.clock_logs, public.trucks, public.truck_logs,
  public.staff_recurring_unavailable, public.access_grants, public.staff_hr_notes, public.roster_prefs
  to authenticated;
grant select, update on public.notifications to authenticated;

-- ── PIN management (manager only) ───────────────────────────────────────────

create function public.update_staff_pin(p_staff_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.auth_can('team', true) then raise exception 'not allowed'; end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN must be 4 digits'; end if;
  update public.staff set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_staff_id;
end $$;

create function public.generate_staff_pin(p_staff_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_pin text := lpad((floor(random() * 10000))::int::text, 4, '0');
begin
  if not public.auth_can('team', true) then raise exception 'not allowed'; end if;
  update public.staff set pin_hash = crypt(v_pin, gen_salt('bf')) where id = p_staff_id;
  return v_pin;
end $$;

-- ── Kiosk RPCs (callable by the signed-out tablet) ──────────────────────────
-- SECURITY DEFINER: they validate the PIN server-side and can only clock the
-- staff member whose PIN was entered. Clock-in opens 15 minutes before the
-- rostered start and needs a published shift.

create function public.kiosk_provision(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select code_hash = crypt(p_code, code_hash) from public.kiosk_config), false)
$$;

create function public.kiosk_open_clockins(p_date date)
returns table (staff_id uuid)
language sql stable security definer set search_path = public as $$
  select staff_id from public.clock_logs where date = p_date and clock_out is null
$$;

create function public.kiosk_clock(p_staff_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_staff public.staff;
  v_today date := (now() at time zone 'Pacific/Auckland')::date;
  v_now_local time := (now() at time zone 'Pacific/Auckland')::time;
  v_open public.clock_logs;
  v_shift public.shifts;
  v_id uuid;
begin
  select * into v_staff from public.staff where id = p_staff_id and active and not is_manager;
  if not found or v_staff.pin_hash is null or crypt(p_pin, v_staff.pin_hash) <> v_staff.pin_hash then
    return jsonb_build_object('status', 'bad_pin');
  end if;

  select * into v_open from public.clock_logs
   where staff_id = p_staff_id and date = v_today and clock_out is null
   order by clock_in desc limit 1;
  if found then
    update public.clock_logs set clock_out = now() where id = v_open.id;
    return jsonb_build_object('status', 'out', 'name', v_staff.name, 'log_id', v_open.id);
  end if;

  select * into v_shift from public.shifts
   where staff_id = p_staff_id and date = v_today and published
   order by start_time nulls first limit 1;
  if not found then return jsonb_build_object('status', 'no_shift'); end if;

  if v_shift.start_time is not null and v_now_local < v_shift.start_time - interval '15 minutes' then
    return jsonb_build_object('status', 'early', 'start_time', v_shift.start_time);
  end if;

  insert into public.clock_logs (staff_id, date, clock_in)
  values (p_staff_id, v_today, now()) returning id into v_id;
  return jsonb_build_object('status', 'in', 'name', v_staff.name, 'log_id', v_id, 'note', v_shift.notes);
end $$;

create function public.kiosk_set_break(p_staff_id uuid, p_pin text, p_log_id uuid, p_took boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select pin_hash into v_hash from public.staff where id = p_staff_id and active;
  if v_hash is null or crypt(p_pin, v_hash) <> v_hash then raise exception 'bad pin'; end if;
  update public.clock_logs set took_break = p_took where id = p_log_id and staff_id = p_staff_id;
end $$;

grant execute on function public.kiosk_provision(text), public.kiosk_open_clockins(date),
  public.kiosk_clock(uuid, text), public.kiosk_set_break(uuid, text, uuid, boolean) to anon, authenticated;

-- ── Notifications ───────────────────────────────────────────────────────────

create function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
   where staff_id = public.auth_staff_id() and read_at is null
     and (p_ids is null or id = any (p_ids))
$$;

-- ── Login management: not available in the demo build ───────────────────────
-- The production app creates and resets Supabase Auth logins from the database.
-- In this demo, logins are created with scripts/make-demo-login.mjs instead.

create function public.admin_create_staff_login(p_staff_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('status', 'unavailable_in_demo')
$$;

create function public.admin_set_login_email(p_staff_id uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin raise exception 'Not available in the demo build'; end $$;

create function public.admin_reset_password(p_staff_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin raise exception 'Not available in the demo build'; end $$;

grant execute on function public.my_permissions(), public.mark_notifications_read(uuid[]),
  public.update_staff_pin(uuid, text), public.generate_staff_pin(uuid),
  public.admin_create_staff_login(uuid), public.admin_set_login_email(uuid, text),
  public.admin_reset_password(uuid) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['shifts', 'clock_logs', 'staff', 'trucks', 'truck_logs', 'notifications'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
