create table public.feedback_reports (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  app text not null check (app in ('HMS', 'Console')),
  body text not null check (length(body) between 1 and 5000),
  category text not null check (category in ('Bug', 'Improvement', 'Question', 'Works well')),
  priority text not null check (priority in ('Blocking', 'Normal', 'Minor')),
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Partially addressed', 'Ready to retest', 'Resolved', 'Reopened')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.feedback_updates (
  id text primary key,
  feedback_id text not null references public.feedback_reports(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('developer', 'reviewer_note', 'retest')),
  status text check (status is null or status in ('Open', 'In progress', 'Partially addressed', 'Ready to retest', 'Resolved', 'Reopened')),
  body text not null default '' check (length(body) <= 5000),
  build text not null default '' check (length(build) <= 120),
  created_at timestamptz not null default now()
);

create table public.feedback_messages (
  id text primary key,
  sender_hospital_id text not null references public.tenants(id) on delete cascade,
  recipient_hospital_id text not null references public.tenants(id) on delete cascade,
  sent_by uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(body) between 1 and 3000),
  created_at timestamptz not null default now(),
  check (sender_hospital_id <> recipient_hospital_id)
);

alter table public.feedback_reports enable row level security;
alter table public.feedback_updates enable row level security;
alter table public.feedback_messages enable row level security;

create policy feedback_reports_hospital_read on public.feedback_reports for select to authenticated
  using (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy feedback_reports_hospital_insert on public.feedback_reports for insert to authenticated
  with check (created_by = (select auth.uid()) and private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy feedback_reports_platform_read on public.feedback_reports for select to authenticated
  using (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy feedback_reports_platform_update on public.feedback_reports for update to authenticated
  using (private.current_user_has_role(null, array['platform_super_admin']::text[]))
  with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy feedback_updates_hospital_read on public.feedback_updates for select to authenticated
  using (exists (select 1 from public.feedback_reports f where f.id = feedback_id and private.current_user_has_role(f.hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[])));
create policy feedback_updates_platform_read on public.feedback_updates for select to authenticated
  using (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy feedback_updates_hospital_insert on public.feedback_updates for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from public.feedback_reports f where f.id = feedback_id and private.current_user_has_role(f.hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[])));
create policy feedback_updates_platform_insert on public.feedback_updates for insert to authenticated
  with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy feedback_messages_hospital_read on public.feedback_messages for select to authenticated
  using (private.current_user_has_role(sender_hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]) or private.current_user_has_role(recipient_hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy feedback_messages_hospital_insert on public.feedback_messages for insert to authenticated
  with check (sent_by = (select auth.uid()) and private.current_user_has_role(sender_hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]) and private.current_user_has_role(recipient_hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));

create index feedback_reports_hospital_time_idx on public.feedback_reports(hospital_id, created_at desc);
create index feedback_updates_report_time_idx on public.feedback_updates(feedback_id, created_at desc);
create index feedback_messages_recipient_time_idx on public.feedback_messages(recipient_hospital_id, created_at desc);
create index feedback_messages_sender_time_idx on public.feedback_messages(sender_hospital_id, created_at desc);
grant select, insert on public.feedback_reports to authenticated;
grant update (status, updated_by, updated_at) on public.feedback_reports to authenticated;
grant select, insert on public.feedback_updates to authenticated;
grant select, insert on public.feedback_messages to authenticated;
