alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

alter table public.devices
  add column if not exists assigned_staff_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'devices_assigned_staff_fk'
      and conrelid = 'public.devices'::regclass
  ) then
    alter table public.devices
      add constraint devices_assigned_staff_fk
      foreign key (hospital_id, assigned_staff_id)
      references public.staff (hospital_id, id)
      on delete set null (assigned_staff_id);
  end if;
end $$;

create index if not exists devices_staff_status_idx
  on public.devices (hospital_id, assigned_staff_id, status)
  where not is_deleted;

create table if not exists public.device_credentials (
  hospital_id text not null,
  device_id text not null,
  credential_hash text not null unique,
  created_at timestamptz not null default now(),
  primary key (hospital_id, device_id),
  foreign key (hospital_id, device_id)
    references public.devices (hospital_id, id)
    on delete cascade
);

alter table public.device_credentials enable row level security;
revoke all on public.device_credentials from anon, authenticated;
