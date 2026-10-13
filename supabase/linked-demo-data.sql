-- Linked fictional demo data: jobs, rostered crew, trucks, leave, clock logs and invoices
-- that all line up with each other. Nothing here is real.
--
-- Run AFTER schema.sql, seed.sql, seed-more.sql, crm-demo.sql and crm-demo-seed.sql.
-- This REPLACES the generated jobs, invoices, shifts, clock logs and notifications
-- from those seeds (staff, trucks, tags, grants and truck history are kept).
--
-- What links up:
--   * Every booked job has a truck and crew. Each crew member gets a roster shift on that
--     day (shift_type 'shift', job_name = the truck's name, job_id = the job), so the
--     Roster, Fleet, Dashboard and "My shifts" screens all show the same picture.
--   * Nobody is double-booked, works over 9 hours, is rostered on a day they are on leave,
--     or works a weekday they have blocked out.
--   * Past jobs are completed with clock logs and invoices; today's jobs are in progress
--     or still to start; upcoming jobs are scheduled. Some upcoming jobs are deliberately
--     left unassigned so they appear in the Unassigned lane, and some are only quoted.

alter table public.shifts alter column shift_type set default 'shift';
alter table public.shifts add column if not exists job_id uuid references public.jobs(id) on delete cascade;
create index if not exists shifts_job_idx on public.shifts (job_id);

delete from public.invoices;
delete from public.notifications;
delete from public.clock_logs;
delete from public.shifts;
delete from public.jobs;
alter sequence public.invoice_number_seq restart with 1001;

create temp table _busy (staff_id uuid, day date, s int, e int);
create temp sequence _seq;

-- Daily plan. slot, kind, truck index (by name), start minute, hours, crew size, Saturday too?
create temp table _plan (slot int, kind text, tidx int, s int, hrs numeric, crew int, sat boolean);
insert into _plan values
  (1,  'house_move', 1, 450, 6,   3, true),
  (2,  'house_move', 2, 480, 5,   2, true),
  (3,  'commercial', 3, 450, 8,   3, false),
  (4,  'house_move', 4, 510, 4,   2, true),
  (5,  'piano',      5, 540, 2.5, 3, true),
  (6,  'house_move', 6, 480, 5,   2, false),
  (7,  'house_move', 4, 810, 3,   2, false),
  (8,  'house_move', 5, 780, 3.5, 2, false),
  (9,  'house_move', 2, 840, 2,   2, false),
  (10, 'cleaning',   null, 540, 3, 2, true),
  (11, 'cleaning',   null, 780, 3, 2, false);

-- Choose crew who are free: not on leave, not blocked that weekday, not overlapping,
-- and under 9 hours for the day. Deterministic order per seed.
create function pg_temp.pick_crew(p_day date, p_s int, p_e int, p_n int, p_seed int) returns uuid[]
language plpgsql as $f$
declare r record; res uuid[] := '{}'; cnt int := 0;
begin
  if p_n <= 0 then return res; end if;
  for r in select id from public.staff where not is_manager and active
           order by abs(hashtext(id::text || p_seed::text)) loop
    exit when cnt >= p_n;
    if exists (select 1 from public.staff_recurring_unavailable u
               where u.staff_id = r.id and u.weekday = extract(dow from p_day)::int) then continue; end if;
    if exists (select 1 from public.shifts t
               where t.staff_id = r.id and t.date = p_day and t.shift_type = 'time_off') then continue; end if;
    if exists (select 1 from _busy b where b.staff_id = r.id and b.day = p_day and b.s < p_e and p_s < b.e) then continue; end if;
    if coalesce((select sum(b.e - b.s) from _busy b where b.staff_id = r.id and b.day = p_day), 0) + (p_e - p_s) > 540 then continue; end if;
    res := res || r.id;
    cnt := cnt + 1;
    insert into _busy values (r.id, p_day, p_s, p_e);
  end loop;
  return res;
end $f$;

create function pg_temp.make_job(p_day date, p_kind text, p_tidx int, p_s int, p_hrs numeric,
                                 p_crew int, p_unassigned boolean, p_force text) returns void
language plpgsql as $f$
declare
  seq int := nextval('_seq');
  today date := (now() at time zone 'Pacific/Auckland')::date;
  nz_min int := extract(hour from (now() at time zone 'Pacific/Auckland'))::int * 60
              + extract(minute from (now() at time zone 'Pacific/Auckland'))::int;
  firsts text[] := array['Hana','Oliver','Priyanka','Tom','Mele','Jack','Aisha','Dylan','Ruby','Felix','Sienna','Callum',
    'Leilani','Mateo','Harper','Rewi','Nina','Ethan','Tessa','Arjun','Willow','Kane','Maya','Josh','Freya','Samir','Poppy',
    'Liam','Anika','Ben','Zoe','Ravi','Isla','Noah','Tui','Evie','Marcus','Lucy','Kiri','Oscar'];
  lasts text[] := array['Whitfield','Chen','Shah','Henare','Taufa','Sorensen','Rahman','Murphy','Tamati','Novak','Park',
    'Reid','Faleolo','Silva','Jones','Parata','Kowalski','Gill','Brown','Patel','Stewart','Rowe','Lopez','Edwards','Nolan',
    'Khan','Hughes','Connor','Rao','Tuhoe'];
  streets text[] := array['Kowhai Lane','Pohutukawa Drive','Rimu Street','Totara Avenue','Harbour View Road',
    'Fernhill Crescent','Manuka Place','Seaview Terrace','Kauri Grove','Tui Road'];
  suburbs text[] := array['Greenview','Eastbrook','Northfield','Lakeside','Hillcrest','Rivermead'];
  v_cancel boolean := not p_unassigned and p_force is null and abs(hashtext(seq::text)) % 17 = 0;
  v_tid uuid; v_tname text; v_crew uuid[] := '{}'; v_id uuid; v_status text; v_end int := p_s + (p_hrs * 60)::int;
  v_beds int := 1 + abs(hashtext(seq::text || 'b')) % 4; v_baths int := 1 + abs(hashtext(seq::text || 'c')) % 3;
  v_clean text := (array['end_of_tenancy','regular','deep'])[1 + seq % 3];
  v_title text; v_quote numeric; v_notes text; v_name text;
begin
  v_name := firsts[1 + abs(hashtext(seq::text || 'f')) % 40] || ' ' || lasts[1 + abs(hashtext(seq::text || 'l')) % 30];
  if p_tidx is not null and not v_cancel and not p_unassigned then
    select id, name into v_tid, v_tname from (
      select id, name, row_number() over (order by name) rn from public.trucks where status <> 'maintenance') t where rn = p_tidx;
  end if;
  if not p_unassigned and not v_cancel then
    v_crew := pg_temp.pick_crew(p_day, p_s, v_end, p_crew, seq);
  end if;

  v_status := case
    when p_force is not null then p_force
    when v_cancel then 'cancelled'
    when p_day < today then 'completed'
    when p_day = today then case when v_end <= nz_min then 'completed' when p_s <= nz_min then 'in_progress' else 'scheduled' end
    else 'scheduled' end;

  v_title := case p_kind when 'house_move' then v_beds || '-bed house move' when 'piano' then 'piano move'
                         when 'commercial' then 'office relocation'
                         else replace(initcap(replace(v_clean, '_', ' ')), 'Of ', 'of ') || ' clean' end;
  v_quote := round(case p_kind when 'house_move' then 300 + p_hrs * 95 + (seq % 5) * 20
                               when 'piano' then 260 + (seq % 3) * 60
                               when 'commercial' then 900 + p_hrs * 110
                               else 110 + v_beds * 35 + v_baths * 25
                                    + case v_clean when 'deep' then 60 when 'end_of_tenancy' then 90 else 0 end end);
  v_notes := case p_kind when 'cleaning' then 'Keys with property manager.'
                         when 'piano' then 'Upright piano, two flights of stairs.' else null end;

  insert into public.jobs (customer_name, customer_phone, service_type, job_date, start_time, est_hours,
                           pickup_address, dropoff_address, bedrooms, bathrooms, cleaning_type,
                           truck_id, crew_ids, status, quote_amount, notes)
  values (v_name, '021 555 ' || lpad((1000 + seq * 7 % 9000)::text, 4, '0'), p_kind, p_day,
          make_time(p_s / 60, p_s % 60, 0), p_hrs,
          ((10 + seq * 3) % 90 + 1) || ' ' || streets[1 + seq % 10] || ', ' || suburbs[1 + seq % 6],
          case when p_kind = 'cleaning' then null
               else ((20 + seq * 7) % 120 + 1) || ' ' || streets[1 + (seq + 3) % 10] || ', ' || suburbs[1 + (seq + 2) % 6] end,
          case when p_kind in ('house_move', 'cleaning') then v_beds end,
          case when p_kind = 'cleaning' then v_baths end,
          case when p_kind = 'cleaning' then v_clean end,
          v_tid, v_crew, v_status, v_quote, v_notes)
  returning id into v_id;

  if v_status in ('scheduled', 'in_progress', 'completed') and coalesce(cardinality(v_crew), 0) > 0 then
    insert into public.shifts (staff_id, job_name, date, start_time, duration_hours, shift_type, notes, published, job_id)
    select c, coalesce(v_tname, 'Cleaning'), p_day, make_time(p_s / 60, p_s % 60, 0), p_hrs, 'shift',
           v_name || ': ' || v_title, p_day <= today + 7, v_id
    from unnest(v_crew) c;
  end if;
end $f$;

do $$
declare
  today date := (now() at time zone 'Pacific/Auckland')::date;
  monday date := date_trunc('week', (now() at time zone 'Pacific/Auckland')::date)::date;
  d date; p record; r record; off_day date;
begin
  -- Leave first, so crew are never rostered on those days.
  for r in select id, row_number() over (order by name) rn from public.staff where not is_manager loop
    if r.rn % 4 = 1 then
      off_day := monday + (((r.rn * 5) % 30 - 12)::int);
      if extract(isodow from off_day) = 7 then off_day := off_day + 1; end if;
      insert into public.shifts (staff_id, job_name, date, start_time, duration_hours, shift_type, notes, published)
      values (r.id, null, off_day, null, null, 'time_off',
              (array['Annual leave','Medical appointment','Family event','Study day'])[1 + (r.rn % 4)::int], true);
    end if;
  end loop;

  for d in select g::date from generate_series(monday - 21, monday + 20, interval '1 day') g loop
    continue when extract(isodow from d) = 7;
    for p in select * from _plan where extract(isodow from d) < 6 or sat order by slot loop
      perform pg_temp.make_job(d, p.kind, p.tidx, p.s, p.hrs, p.crew, false, null);
    end loop;
    -- Upcoming work nobody has been assigned yet, to show the Unassigned lane.
    if d > today and d <= today + 10 then
      perform pg_temp.make_job(d, 'house_move', null, 600, 4, 0, true, 'scheduled');
      perform pg_temp.make_job(d, 'house_move', null, 840, 3, 0, true, 'scheduled');
    elsif d > today + 10 then
      perform pg_temp.make_job(d, 'house_move', null, 540, 4, 0, true, 'quoted');
    end if;
  end loop;
end $$;

-- Clock logs for work already started: out for finished jobs, still clocked in for in-progress.
insert into public.clock_logs (staff_id, date, clock_in, clock_out, took_break)
select s.staff_id, s.date,
       ((s.date + s.start_time) + ((abs(hashtext(s.id::text)) % 15 - 5) || ' minutes')::interval) at time zone 'Pacific/Auckland',
       case when j.status = 'in_progress' then null
            else ((s.date + s.start_time) + (s.duration_hours || ' hours')::interval
                  + ((abs(hashtext(s.id::text || 'o')) % 36 - 10) || ' minutes')::interval) at time zone 'Pacific/Auckland' end,
       case when j.status = 'in_progress' then null else s.duration_hours > 5 end
from public.shifts s
join public.jobs j on j.id = s.job_id
where s.shift_type = 'shift' and j.status in ('completed', 'in_progress');

-- Invoices for completed jobs: recent ones are drafts, older ones mostly paid, some sent (some overdue).
insert into public.invoices (job_id, issued_on, due_on, subtotal, status, paid_on)
select j.id, j.job_date + 1, j.job_date + 15, j.quote_amount,
       case when j.job_date >= current_date - 2 then 'draft'
            when abs(hashtext(j.id::text)) % 5 = 0 then 'sent' else 'paid' end,
       case when j.job_date >= current_date - 2 or abs(hashtext(j.id::text)) % 5 = 0 then null
            else j.job_date + 3 + (abs(hashtext(j.id::text)) % 10) end
from public.jobs j
where j.status = 'completed'
order by j.job_date, j.start_time;

-- A notification for each person's next rostered job.
insert into public.notifications (staff_id, type, title, body, shift_date, created_at, read_at)
select s.staff_id, 'shift_added', 'New shift added',
       s.job_name || ' at ' || to_char(s.start_time, 'HH12:MI am'), s.date,
       now() - ((abs(hashtext(s.id::text)) % 48) || ' hours')::interval,
       case when abs(hashtext(s.id::text)) % 3 = 0 then now() else null end
from (select distinct on (staff_id) * from public.shifts
      where date >= current_date and shift_type = 'shift' and published order by staff_id, date, start_time) s;

drop table _busy;
drop table _plan;
drop sequence _seq;

select (select count(*) from jobs) jobs,
       (select count(*) from jobs where truck_id is null and status = 'scheduled') unassigned,
       (select count(*) from jobs where status = 'quoted') quoted,
       (select count(*) from shifts where shift_type = 'shift') rostered_shifts,
       (select count(*) from shifts where shift_type = 'time_off') leave,
       (select count(*) from clock_logs) clock_logs,
       (select count(*) from invoices) invoices;
