-- Extra fictional demo data, so the app looks lived-in for a demo.
-- Run AFTER schema.sql and seed.sql, in the same sitting (dates are relative to today,
-- so running it in a later week would overlap the first seed). Nothing here is real.
-- Adds: 14 more crew, 4 more trucks, 3 weeks of past rostered shifts with clock logs,
-- two weeks of future shifts, truck history and a few notifications.
--
-- Extra crew PINs (demo only): Noa 7001, Ella 7002, Kai 7003, Zara 7004, Ben 7005,
-- Aroha 7006, Liam 7007, Sofia 7008, Manu 7009, Chloe 7010, Ryan 7011, Isla 7012,
-- Hemi 7013, Grace 7014.

insert into public.staff (id, name, email, phone, is_manager, tag_ids, min_hours, pin_hash)
select ('b1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       v.name, v.email, '021 000 ' || lpad((100 + n)::text, 4, '0'), false,
       case v.grp when 'd' then '{a0000000-0000-0000-0000-000000000001}'::uuid[]
                  when 'p' then '{a0000000-0000-0000-0000-000000000002}'::uuid[]
                  else          '{a0000000-0000-0000-0000-000000000002,a0000000-0000-0000-0000-000000000003}'::uuid[] end,
       v.minh, crypt((7000 + n)::text, gen_salt('bf'))
from (values
  (1,  'Noa Parata',    'noa@example.com',    'p', 20),
  (2,  'Ella Brooks',   'ella@example.com',   'p', 15),
  (3,  'Kai Mitchell',  'kai@example.com',    'd', 30),
  (4,  'Zara Ahmed',    'zara@example.com',   'p', 20),
  (5,  'Ben Foster',    'ben@example.com',    'd', 25),
  (6,  'Aroha Ngata',   'aroha@example.com',  'l', 30),
  (7,  'Liam Walker',   'liam@example.com',   'p', null),
  (8,  'Sofia Reyes',   'sofia@example.com',  'p', 15),
  (9,  'Manu Tane',     'manu@example.com',   'd', 30),
  (10, 'Chloe Barnes',  'chloe@example.com',  'p', 20),
  (11, 'Ryan Cole',     'ryan@example.com',   'd', 25),
  (12, 'Isla Grant',    'isla@example.com',   'p', 15),
  (13, 'Hemi Rangi',    'hemi@example.com',   'l', 30),
  (14, 'Grace Lin',     'grace@example.com',  'p', 20)
) as v(n, name, email, grp, minh);

insert into public.trucks (id, name, registration, type, status, notes, color, wof_expiry, rego_expiry) values
  ('c0000000-0000-0000-0000-000000000004', 'Truck 3', 'DEMO04', '8-tonne', 'available', 'Tail lift, long wheelbase', '#7c3aed', current_date + 300, current_date + 250),
  ('c0000000-0000-0000-0000-000000000005', 'Truck 4', 'DEMO05', '4-tonne', 'available', null,                       '#db2777', current_date + 45,  current_date + 160),
  ('c0000000-0000-0000-0000-000000000006', 'Truck 5', 'DEMO06', '6-tonne', 'available', 'Piano trolley fitted',     '#0891b2', current_date + 12,  current_date + 70),
  ('c0000000-0000-0000-0000-000000000007', 'Van 2',   'DEMO07', 'van',     'available', null,                       '#65a30d', current_date + 200, current_date + 30);

insert into public.truck_logs (truck_id, log_date, type, detail, cost) values
  ('c0000000-0000-0000-0000-000000000001', current_date - 60, 'fuel',    'Diesel',                        152.30),
  ('c0000000-0000-0000-0000-000000000001', current_date - 33, 'fuel',    'Diesel',                        147.90),
  ('c0000000-0000-0000-0000-000000000001', current_date - 12, 'repair',  'Replace tail-lift hose',        260.00),
  ('c0000000-0000-0000-0000-000000000002', current_date - 48, 'service', 'Oil and filter',                310.00),
  ('c0000000-0000-0000-0000-000000000002', current_date - 25, 'fuel',    'Diesel',                        133.20),
  ('c0000000-0000-0000-0000-000000000004', current_date - 40, 'service', '10,000 km service',             545.00),
  ('c0000000-0000-0000-0000-000000000004', current_date - 14, 'fuel',    'Diesel',                        171.60),
  ('c0000000-0000-0000-0000-000000000005', current_date - 30, 'repair',  'Replace rear tyres',            720.00),
  ('c0000000-0000-0000-0000-000000000005', current_date - 7,  'fuel',    'Diesel',                        129.40),
  ('c0000000-0000-0000-0000-000000000006', current_date - 55, 'service', 'Brake service',                 480.00),
  ('c0000000-0000-0000-0000-000000000006', current_date - 3,  'fuel',    'Diesel',                        155.00),
  ('c0000000-0000-0000-0000-000000000007', current_date - 19, 'service', 'Routine service',               295.00),
  ('c0000000-0000-0000-0000-000000000003', current_date - 40, 'fuel',    'Petrol',                         96.80);

insert into public.staff_recurring_unavailable (staff_id, weekday, reason)
select ('b1000000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, v.wd, v.reason
from (values (2, 1, 'Class on Mondays'), (4, 4, 'Second job Thursdays'), (8, 2, 'Childcare Tuesdays'),
             (10, 5, 'Uni Fridays'), (12, 3, 'Class on Wednesdays')) as v(n, wd, reason);

insert into public.staff_hr_notes (staff_id, notes, updated_at) values
  ('b1000000-0000-0000-0000-000000000006', 'Demo note: first-aid certified; supervising new starters.', now()),
  ('b1000000-0000-0000-0000-000000000009', 'Demo note: holds a class 2 licence.', now());

-- ── Shifts ──────────────────────────────────────────────────────────────────
-- Window: 3 weeks back to 2 weeks ahead (Mon-Sat). The original seed already
-- covers this week and next for the original crew, so only fill the gaps.

with crew as (
  select id, row_number() over (order by name) as n,
         (id::text like 'b1000000%') as is_new
  from public.staff where not is_manager
),
days as (
  select d::date as day, row_number() over (order by d) as k
  from generate_series(date_trunc('week', current_date)::date - 21,
                       date_trunc('week', current_date)::date + 19, '1 day') d
  where extract(isodow from d) <> 7
),
jobs as (
  select * from (values
    (1, '2-bed house move',         '08:00'::time, 6.0, 'Narrow driveway, park on street.'),
    (2, 'Office relocation',        '07:30'::time, 8.0, 'Lift booking at 8am.'),
    (3, 'Piano move',               '09:00'::time, 4.0, 'Piano trolley and extra straps needed.'),
    (4, 'Apartment, 3rd floor',     '10:00'::time, 5.0, 'No lift. Bring stair trolley.'),
    (5, 'Storage unit clear-out',   '08:30'::time, 5.5, null),
    (6, '3-bed house move',         '07:30'::time, 8.5, 'Packing included.'),
    (7, 'Student flat move',        '12:00'::time, 3.5, null)
  ) as j(slot, job_name, start_time, hours, notes)
),
planned as (
  select c.id as staff_id, d.day, j.*
  from days d
  join crew c on ((d.k + c.n) % 3) <> 0
  join jobs j on j.slot = ((d.k * 3 + c.n) % 7) + 1
  where c.is_new
     or d.day <  date_trunc('week', current_date)::date
     or d.day >= date_trunc('week', current_date)::date + 14
)
insert into public.shifts (staff_id, job_name, date, start_time, duration_hours, shift_type, notes, published)
select staff_id, job_name, day, start_time, hours, 'shift', notes,
       day <= date_trunc('week', current_date)::date + 7
from planned;

-- ── Clock logs for every past shift without one ─────────────────────────────
-- Deterministic jitter: in by -5 to +9 minutes, out by -10 to +25 minutes.

insert into public.clock_logs (staff_id, date, clock_in, clock_out, took_break)
select s.staff_id, s.date,
       ((s.date + s.start_time) + ((abs(hashtext(s.id::text)) % 15 - 5) || ' minutes')::interval)
         at time zone 'Pacific/Auckland',
       ((s.date + s.start_time) + (s.duration_hours || ' hours')::interval
         + ((abs(hashtext(s.id::text || 'o')) % 36 - 10) || ' minutes')::interval)
         at time zone 'Pacific/Auckland',
       s.duration_hours > 5
from public.shifts s
where s.date < current_date and s.published
  and not exists (select 1 from public.clock_logs c where c.staff_id = s.staff_id and c.date = s.date);

-- ── Notifications for staff with upcoming shifts ────────────────────────────

insert into public.notifications (staff_id, type, title, body, shift_date, created_at, read_at)
select s.staff_id, 'shift_added', 'New shift added',
       s.job_name || ' at ' || to_char(s.start_time, 'HH12:MI am'),
       s.date, now() - ((abs(hashtext(s.id::text)) % 48) || ' hours')::interval,
       case when abs(hashtext(s.id::text)) % 3 = 0 then now() else null end
from (
  select distinct on (staff_id) * from public.shifts
  where date >= current_date and published order by staff_id, date
) s;

select (select count(*) from staff) staff, (select count(*) from shifts) shifts,
       (select count(*) from clock_logs) clock_logs, (select count(*) from trucks) trucks,
       (select count(*) from truck_logs) truck_logs, (select count(*) from notifications) notifications;
