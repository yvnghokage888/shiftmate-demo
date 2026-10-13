-- Fictional jobs and invoices for the Dispatch, Cleaning and Invoices screens.
-- Run after crm-demo.sql, seed.sql and (ideally) seed-more.sql. Nothing here is real.
-- Dates are relative to today, so there is always work in the current week.

insert into public.jobs (customer_name, customer_phone, service_type, job_date, start_time, est_hours,
                         pickup_address, dropoff_address, bedrooms, bathrooms, cleaning_type,
                         truck_id, crew_ids, status, quote_amount, notes)
with names as (
  select * from unnest(array[
    'Hana Whitfield','Oliver Chen','Priyanka Shah','Tom Henare','Mele Taufa','Jack Sorensen',
    'Aisha Rahman','Dylan Murphy','Ruby Tamati','Felix Novak','Sienna Park','Callum Reid',
    'Leilani Faleolo','Mateo Silva','Harper Jones','Rewi Parata','Nina Kowalski','Ethan Gill',
    'Tessa Brown','Arjun Patel','Willow Stewart','Kane Rowe','Maya Lopez','Josh Edwards',
    'Freya Nolan','Samir Khan','Poppy Hughes','Liam O''Connor','Anika Rao','Ben Tuhoe',
    'Zoe Mackay','Ravi Menon','Isla Fraser','Noah Wilson','Tui Ranginui','Evie Carter',
    'Marcus Webb','Lucy Tran','Kiri Walker','Oscar Dunn','Jade Morgan','Sam Clarke',
    'Alice Burns','Rangi Hohepa'
  ]) with ordinality as t(name, i)
),
streets as (
  select * from unnest(array['Kowhai Lane','Pohutukawa Drive','Rimu Street','Totara Avenue','Harbour View Road',
                             'Fernhill Crescent','Manuka Place','Seaview Terrace','Kauri Grove','Tui Road'])
         with ordinality as t(street, k)
),
suburbs as (
  select * from unnest(array['Greenview','Eastbrook','Northfield','Lakeside','Hillcrest','Rivermead'])
         with ordinality as t(suburb, k)
),
crew as (
  select id, row_number() over (order by name) as n from public.staff where not is_manager
),
trucks_n as (
  select id, row_number() over (order by name) as n from public.trucks where status <> 'service'
),
base as (
  select n.i, n.name,
         (case when extract(isodow from d.dd) = 7 then d.dd + 1 else d.dd end)::date as job_date,
         case n.i % 4 when 0 then 'cleaning'
                      when 3 then (case when n.i % 8 = 3 then 'piano' else 'commercial' end)
                      else 'house_move' end as service_type
  from names n
  cross join lateral (select current_date + (case when n.i in (2, 6, 8, 9) then 0 when n.i in (4, 13) then 1 when n.i in (17, 21) then -1 else ((n.i * 5) % 40 - 18)::int end) as dd) d
)
select b.name,
       '021 555 ' || lpad((1000 + b.i * 7)::text, 4, '0'),
       b.service_type, b.job_date,
       (array['07:30','08:00','08:30','09:00','10:00','12:00'])[(b.i % 6) + 1]::time,
       case b.service_type when 'cleaning' then 3 + (b.i % 3) when 'piano' then 2.5
                           when 'commercial' then 7 else 4 + (b.i % 5) end,
       ((10 + b.i * 3) % 90 + 1) || ' ' || (select street from streets where k = (b.i % 10) + 1)
         || ', ' || (select suburb from suburbs where k = (b.i % 6) + 1),
       case when b.service_type = 'cleaning' then null
            else ((20 + b.i * 7) % 120 + 1) || ' ' || (select street from streets where k = ((b.i + 3) % 10) + 1)
                 || ', ' || (select suburb from suburbs where k = ((b.i + 2) % 6) + 1) end,
       case when b.service_type in ('house_move', 'cleaning') then 1 + (b.i % 4) end,
       case when b.service_type = 'cleaning' then 1 + (b.i % 3) end,
       case when b.service_type = 'cleaning'
            then (array['end_of_tenancy','regular','deep'])[(b.i % 3) + 1] end,
       case when b.service_type = 'cleaning' then null
            else (select id from trucks_n where n = (b.i % (select count(*) from trucks_n)) + 1) end,
       case when b.service_type = 'cleaning'
            then array(select id from crew where n in ((b.i % 20) + 1, ((b.i + 7) % 20) + 1))
            else array(select id from crew where n in ((b.i % 20) + 1, ((b.i + 5) % 20) + 1, ((b.i + 11) % 20) + 1)) end,
       case when b.i % 11 = 0 then 'cancelled'
            when b.job_date < current_date then 'completed'
            when b.job_date = current_date then 'in_progress'
            when b.i % 5 = 0 and b.job_date > current_date + 10 then 'quoted'
            else 'scheduled' end,
       round((case b.service_type when 'cleaning' then 140 + (b.i % 4) * 45
                                  when 'piano' then 280 + (b.i % 3) * 60
                                  when 'commercial' then 1100 + (b.i % 5) * 150
                                  else 520 + (b.i % 6) * 95 end)::numeric, 0),
       case b.service_type when 'cleaning' then 'Keys with property manager.'
            when 'piano' then 'Upright piano, two flights of stairs.' else null end
from base b;

-- Invoices for completed jobs. The most recent ones are still drafts; older ones are
-- mostly paid, a few are sent and overdue.
insert into public.invoices (job_id, issued_on, due_on, subtotal, status, paid_on)
select j.id,
       j.job_date + 1,
       j.job_date + 15,
       j.quote_amount,
       case when j.job_date >= current_date - 2 then 'draft'
            when abs(hashtext(j.id::text)) % 4 = 0 then 'sent'
            else 'paid' end,
       case when j.job_date >= current_date - 2 or abs(hashtext(j.id::text)) % 4 = 0 then null
            else j.job_date + 3 + (abs(hashtext(j.id::text)) % 10) end
from public.jobs j
where j.status = 'completed'
order by j.job_date;

-- Tidy the generated data: re-assign trucks and crew so no job is double-booked.
-- (Use the UI to create a deliberate clash and see the warning on the Dispatch screen.)
do $$
declare r record; new_truck uuid; new_crew uuid[];
begin
  for r in
    select distinct b.id from public.jobs a
    join public.jobs b on a.id < b.id and a.job_date = b.job_date and a.truck_id = b.truck_id
     and a.start_time < b.start_time + (coalesce(b.est_hours, 2) || ' hours')::interval
     and b.start_time < a.start_time + (coalesce(a.est_hours, 2) || ' hours')::interval
    where a.status <> 'cancelled' and b.status <> 'cancelled'
  loop
    select t.id into new_truck from public.trucks t
     where t.status <> 'service' and not exists (
       select 1 from public.jobs o, public.jobs me
        where me.id = r.id and o.id <> me.id and o.truck_id = t.id and o.job_date = me.job_date
          and o.status <> 'cancelled'
          and o.start_time < me.start_time + (coalesce(me.est_hours, 2) || ' hours')::interval
          and me.start_time < o.start_time + (coalesce(o.est_hours, 2) || ' hours')::interval)
     order by t.name limit 1;
    update public.jobs set truck_id = new_truck where id = r.id;
  end loop;

  for r in
    select distinct b.id, b.job_date, b.service_type from public.jobs a
    join public.jobs b on a.id < b.id and a.job_date = b.job_date and a.crew_ids && b.crew_ids
     and a.start_time < b.start_time + (coalesce(b.est_hours, 2) || ' hours')::interval
     and b.start_time < a.start_time + (coalesce(a.est_hours, 2) || ' hours')::interval
    where a.status <> 'cancelled' and b.status <> 'cancelled'
  loop
    select array(select s.id from public.staff s
                  where not s.is_manager and not exists (
                    select 1 from public.jobs o where o.job_date = r.job_date and o.status <> 'cancelled'
                      and s.id = any (o.crew_ids))
                  order by s.name desc
                  limit case when r.service_type = 'cleaning' then 2 else 3 end) into new_crew;
    update public.jobs set crew_ids = new_crew where id = r.id;
  end loop;
end $$;

select (select count(*) from jobs) jobs,
       (select count(*) from jobs where service_type = 'cleaning') cleaning,
       (select count(*) from invoices) invoices,
       (select count(*) from invoices where status = 'sent' and due_on < current_date) overdue,
       (select count(*) from jobs where job_date = current_date) today;
