-- Demo CRM-style screens: Dispatch, Cleaning and Invoices.
-- Run AFTER schema.sql (and seed.sql). Then run crm-demo-seed.sql for fictional data.
-- Everything here is generic and fictional.
--
-- Design notes:
--  * One `jobs` table. Dispatch shows moves, Cleaning shows service_type = 'cleaning'.
--    The row-level-security policy gates each by its own permission, enforced in the
--    database, not just hidden in the UI.
--  * `invoices.job_id` is a real foreign key (no fuzzy matching on names or emails).
--  * GST (15%) and the total are generated columns, so they can never drift from the subtotal.

create table public.jobs (
  id             uuid primary key default gen_random_uuid(),
  customer_name  text not null,
  customer_phone text,
  service_type   text not null check (service_type in ('house_move', 'piano', 'commercial', 'cleaning')),
  job_date       date not null,
  start_time     time,
  est_hours      numeric,
  pickup_address text,
  dropoff_address text,                          -- null for cleaning jobs
  bedrooms       int,
  bathrooms      int,
  cleaning_type  text check (cleaning_type in ('end_of_tenancy', 'regular', 'deep')),
  truck_id       uuid references public.trucks(id) on delete set null,
  crew_ids       uuid[] not null default '{}',   -- staff.id values
  status         text not null default 'scheduled'
                 check (status in ('quoted', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  quote_amount   numeric check (quote_amount >= 0),
  notes          text,
  created_at     timestamptz not null default now()
);
create index jobs_date_idx on public.jobs (job_date);

create sequence public.invoice_number_seq start 1001;

create table public.invoices (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.jobs(id) on delete cascade,
  number    text not null unique default ('INV-' || nextval('public.invoice_number_seq')::text),
  issued_on date not null default current_date,
  due_on    date not null,
  subtotal  numeric not null check (subtotal >= 0),
  gst       numeric generated always as (round(subtotal * 0.15, 2)) stored,
  total     numeric generated always as (subtotal + round(subtotal * 0.15, 2)) stored,
  status    text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  paid_on   date
);
create index invoices_job_idx on public.invoices (job_id);

alter table public.jobs     enable row level security;
alter table public.invoices enable row level security;

create policy jobs_read on public.jobs for select to authenticated using (
  (service_type = 'cleaning' and public.auth_can('cleaning'))
  or (service_type <> 'cleaning' and public.auth_can('dispatch'))
);
create policy jobs_write on public.jobs for all to authenticated
  using (
    (service_type = 'cleaning' and public.auth_can('cleaning', true))
    or (service_type <> 'cleaning' and public.auth_can('dispatch', true))
  )
  with check (
    (service_type = 'cleaning' and public.auth_can('cleaning', true))
    or (service_type <> 'cleaning' and public.auth_can('dispatch', true))
  );

create policy invoices_read  on public.invoices for select to authenticated using (public.auth_can('invoicing'));
create policy invoices_write on public.invoices for all    to authenticated
  using (public.auth_can('invoicing', true)) with check (public.auth_can('invoicing', true));

grant select, insert, update, delete on public.jobs, public.invoices to authenticated;
grant usage on sequence public.invoice_number_seq to authenticated;

-- Extend the permission list the app reads (adds three resources).
create or replace function public.my_permissions()
returns table (resource text, can_read boolean, can_write boolean)
language sql stable security definer set search_path = public as $$
  select r.resource, public.auth_can(r.resource), public.auth_can(r.resource, true)
  from (values ('roster'), ('timesheets'), ('team'), ('fleet'), ('hr'),
               ('dispatch'), ('cleaning'), ('invoicing')) as r(resource)
$$;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['jobs', 'invoices'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
