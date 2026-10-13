-- Fictional demo data for "Demo Removals Co". Nothing here is real.
-- Run after schema.sql. Safe to re-run on an empty database only.
-- Dates are relative to today, so the roster always has a current week.
--
-- Kiosk device-setup code:  demo-kiosk     (open  /?kiosk-setup=demo-kiosk)
-- Crew PINs (demo only):    Sam 1111, Priya 2222, Tama 3333, Mia 4444, Jordan 5555, Lee 6666

insert into public.kiosk_config (code_hash) values (crypt('demo-kiosk', gen_salt('bf')));

insert into public.staff_tags (id, name, color, sort_order) values
  ('a0000000-0000-0000-0000-000000000001', 'Drivers',    '#2563eb', 1),
  ('a0000000-0000-0000-0000-000000000002', 'Packers',    '#16a34a', 2),
  ('a0000000-0000-0000-0000-000000000003', 'Crew leads', '#d97706', 3);

insert into public.staff (id, name, email, phone, is_manager, tag_ids, min_hours, pin_hash) values
  ('b0000000-0000-0000-0000-000000000001', 'Alex Demo (Manager)', 'manager@example.com', null, true,  '{}', null, null),
  ('b0000000-0000-0000-0000-000000000002', 'Sam Rivers',   'sam@example.com',    '021 000 0001', false, '{a0000000-0000-0000-0000-000000000001,a0000000-0000-0000-0000-000000000003}', 30, crypt('1111', gen_salt('bf'))),
  ('b0000000-0000-0000-0000-000000000003', 'Priya Nair',   'priya@example.com',  '021 000 0002', false, '{a0000000-0000-0000-0000-000000000002}',                                      20, crypt('2222', gen_salt('bf'))),
  ('b0000000-0000-0000-0000-000000000004', 'Tama Wells',   'tama@example.com',   '021 000 0003', false, '{a0000000-0000-0000-0000-000000000001}',                                      25, crypt('3333', gen_salt('bf'))),
  ('b0000000-0000-0000-0000-000000000005', 'Mia Tran',     'mia@example.com',    '021 000 0004', false, '{a0000000-0000-0000-0000-000000000002}',                                      15, crypt('4444', gen_salt('bf'))),
  ('b0000000-0000-0000-0000-000000000006', 'Jordan Hale',  'jordan@example.com', '021 000 0005', false, '{a0000000-0000-0000-0000-000000000002}',                                      null, crypt('5555', gen_salt('bf'))),
  ('b0000000-0000-0000-0000-000000000007', 'Lee Carter',   'lee@example.com',    '021 000 0006', false, '{a0000000-0000-0000-0000-000000000001}',                                      20, crypt('6666', gen_salt('bf')));

-- Crew can see the roster; crew leads can also see timesheets (read only).
insert into public.access_grants (subject_type, subject_id, resource, can_read, can_write) values
  ('team', 'a0000000-0000-0000-0000-000000000001', 'roster',     true, false),
  ('team', 'a0000000-0000-0000-0000-000000000002', 'roster',     true, false),
  ('team', 'a0000000-0000-0000-0000-000000000003', 'roster',     true, false),
  ('team', 'a0000000-0000-0000-0000-000000000003', 'timesheets', true, false);

insert into public.trucks (id, name, registration, type, status, notes, color, wof_expiry, rego_expiry) values
  ('c0000000-0000-0000-0000-000000000001', 'Truck 1', 'DEMO01', '6-tonne', 'available', 'Tail lift', '#2563eb', current_date + 120, current_date + 200),
  ('c0000000-0000-0000-0000-000000000002', 'Truck 2', 'DEMO02', '4-tonne', 'available', null,        '#16a34a', current_date + 20,  current_date + 90),
  ('c0000000-0000-0000-0000-000000000003', 'Van 1',   'DEMO03', 'van',     'service',   'In for brakes', '#d97706', current_date - 5, current_date + 40);

insert into public.truck_logs (truck_id, log_date, type, detail, cost) values
  ('c0000000-0000-0000-0000-000000000001', current_date - 21, 'service', 'Routine service',              420.00),
  ('c0000000-0000-0000-0000-000000000002', current_date - 9,  'fuel',    'Diesel',                       138.50),
  ('c0000000-0000-0000-0000-000000000003', current_date - 2,  'repair',  'Brake pads and discs',         610.00);

insert into public.staff_recurring_unavailable (staff_id, weekday, reason) values
  ('b0000000-0000-0000-0000-000000000003', 3, 'Uni lectures'),
  ('b0000000-0000-0000-0000-000000000005', 0, 'Unavailable Sundays');

insert into public.staff_hr_notes (staff_id, notes, updated_at) values
  ('b0000000-0000-0000-0000-000000000004', 'Demo note: has a heavy-vehicle licence.', now());

-- ── Shifts: this week (Mon-Sat) and next, assigned in rotation ─────────────

with crew as (
  select id, row_number() over (order by name) as n
  from public.staff where not is_manager
),
days as (
  select d::date as day, row_number() over (order by d) as k
  from generate_series(date_trunc('week', current_date)::date,
                       date_trunc('week', current_date)::date + 12, '1 day') d
  where extract(isodow from d) <> 7
),
jobs as (
  select * from (values
    (1, '2-bed house move',        '08:00'::time, 6.0, 'Narrow driveway, park on street.'),
    (2, 'Office relocation',       '07:30'::time, 8.0, 'Lift booking at 8am.'),
    (3, 'Piano move',              '09:00'::time, 4.0, 'Piano trolley and extra straps needed.'),
    (4, 'Apartment, 3rd floor',    '10:00'::time, 5.0, 'No lift. Bring stair trolley.'),
    (5, 'Storage unit clear-out',  '08:30'::time, 5.5, null)
  ) as j(slot, job_name, start_time, hours, notes)
)
insert into public.shifts (staff_id, job_name, date, start_time, duration_hours, shift_type, notes, published)
select c.id, j.job_name, d.day, j.start_time, j.hours, 'shift', j.notes,
       d.day <= date_trunc('week', current_date)::date + 7
from days d
join crew c on ((d.k + c.n) % 3) <> 0
join jobs j on j.slot = ((d.k + c.n) % 5) + 1;

-- ── Clock logs for earlier days this week (so Timesheets has real numbers) ──

insert into public.clock_logs (staff_id, date, clock_in, clock_out, took_break)
select s.staff_id, s.date,
       (s.date + s.start_time) at time zone 'Pacific/Auckland',
       (s.date + s.start_time + (s.duration_hours || ' hours')::interval) at time zone 'Pacific/Auckland',
       s.duration_hours > 5
from public.shifts s
where s.date < current_date and s.date >= date_trunc('week', current_date)::date and s.published;
