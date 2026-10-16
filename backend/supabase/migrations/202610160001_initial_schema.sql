create table public.tenants (
  id text primary key,
  slug text not null unique,
  name text not null,
  address text,
  phone text,
  logo_url text,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_main boolean not null default false,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  hospital_id text references public.tenants(id) on delete cascade,
  branch_id text,
  email text unique,
  name text not null default '',
  roles text[] not null default '{}',
  phone text,
  active boolean not null default true,
  perm_grants text[] not null default '{}',
  perm_denies text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id)
);

create table public.roles (
  code text primary key,
  name text not null
);

create table public.profile_roles (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hospital_id text references public.tenants(id) on delete cascade,
  role text not null references public.roles(code),
  created_at timestamptz not null default now(),
  unique (user_id, hospital_id, role)
);

create table public.role_permissions (
  role text not null references public.roles(code) on delete cascade,
  permission text not null,
  primary key (role, permission)
);

create table public.staff (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  auth_user_id uuid references public.profiles(id) on delete set null,
  name text not null default '',
  email text,
  phone text,
  profession text,
  active boolean not null default true,
  pin_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  unique (hospital_id, id)
);

create table public.staff_roles (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  role text not null references public.roles(code),
  created_at timestamptz not null default now(),
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete cascade,
  unique (hospital_id, staff_id, role)
);

create table public.modules (
  code text primary key,
  id text not null unique,
  name text not null,
  description text not null default '',
  category text not null default 'operations',
  version text not null default '1.0.0',
  status text not null default 'draft',
  pricing_model text not null default 'addon',
  price_minor bigint not null default 0 check (price_minor >= 0),
  config_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscription_plans (
  code text primary key,
  id text not null unique,
  name text not null,
  price_minor bigint not null default 0 check (price_minor >= 0),
  currency text not null default 'NGN',
  status text not null default 'active',
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  plan_code text references public.subscription_plans(code),
  plan_name text not null default 'Freemium',
  amount_minor bigint not null default 0,
  status text not null default 'pending',
  payment_method text,
  starts_at timestamptz,
  renews_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hospital_id, id)
);

create table public.module_entitlements (
  hospital_id text not null references public.tenants(id) on delete cascade,
  module_code text not null references public.modules(code),
  source text not null,
  status text not null,
  starts_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (hospital_id, module_code)
);

create table public.tenant_modules (
  hospital_id text not null references public.tenants(id) on delete cascade,
  module_code text not null references public.modules(code),
  status text not null default 'disabled',
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  primary key (hospital_id, module_code)
);

create table public.patients (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  dibia_id text,
  first_name text,
  last_name text,
  date_of_birth date,
  sex text,
  phone text,
  email text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  unique (hospital_id, id),
  unique (hospital_id, dibia_id)
);

create table public.visits (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  patient_id text not null,
  status text not null default 'open',
  clinician_id text,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete restrict,
  foreign key (hospital_id, clinician_id) references public.staff(hospital_id, id) on delete set null (clinician_id),
  unique (hospital_id, id)
);

create table public.appointments (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  patient_id text not null,
  clinician_id text,
  scheduled_at timestamptz,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete restrict,
  foreign key (hospital_id, clinician_id) references public.staff(hospital_id, id) on delete set null (clinician_id),
  unique (hospital_id, id)
);

create table public.products (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  barcode text,
  name text not null default '',
  category text,
  unit text,
  quantity numeric not null default 0,
  reorder_level numeric not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  unique (hospital_id, id)
);

create table public.batches (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  product_id text not null,
  batch_no text,
  quantity numeric not null default 0,
  expiry_date date,
  purchase_price_minor bigint,
  selling_price_minor bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  unique (hospital_id, id)
);

create table public.customers (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  name text not null default '',
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  unique (hospital_id, id)
);

create table public.suppliers (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  name text not null default '',
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  unique (hospital_id, id)
);

create table public.sales (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  customer_id text,
  staff_id text,
  total_minor bigint not null default 0,
  status text not null default 'completed',
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, customer_id) references public.customers(hospital_id, id) on delete set null (customer_id),
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete set null (staff_id),
  unique (hospital_id, id)
);

create table public.sale_items (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  sale_id text not null,
  product_id text not null,
  batch_id text,
  quantity numeric not null default 1,
  unit_price_minor bigint not null default 0,
  line_total_minor bigint not null default 0,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, sale_id) references public.sales(hospital_id, id) on delete cascade,
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  foreign key (hospital_id, batch_id) references public.batches(hospital_id, id) on delete set null (batch_id),
  unique (hospital_id, id)
);

create table public.purchase_orders (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  supplier_id text,
  branch_id text,
  status text not null default 'draft',
  total_minor bigint not null default 0,
  ordered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, supplier_id) references public.suppliers(hospital_id, id) on delete set null (supplier_id),
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  unique (hospital_id, id)
);

create table public.purchase_order_items (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  purchase_order_id text not null,
  product_id text not null,
  quantity numeric not null default 1,
  unit_cost_minor bigint not null default 0,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, purchase_order_id) references public.purchase_orders(hospital_id, id) on delete cascade,
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  unique (hospital_id, id)
);

create table public.stock_movements (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  product_id text not null,
  batch_id text,
  staff_id text,
  quantity_delta numeric not null default 0,
  movement_type text not null default 'adjustment',
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  foreign key (hospital_id, batch_id) references public.batches(hospital_id, id) on delete set null (batch_id),
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete set null (staff_id),
  unique (hospital_id, id)
);

create table public.transfers (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  source_branch_id text,
  destination_branch_id text,
  requested_by text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, source_branch_id) references public.branches(hospital_id, id) on delete set null (source_branch_id),
  foreign key (hospital_id, destination_branch_id) references public.branches(hospital_id, id) on delete set null (destination_branch_id),
  foreign key (hospital_id, requested_by) references public.staff(hospital_id, id) on delete set null (requested_by),
  unique (hospital_id, id)
);

create table public.transfer_items (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  transfer_id text not null,
  product_id text not null,
  batch_id text,
  quantity numeric not null default 1,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, transfer_id) references public.transfers(hospital_id, id) on delete cascade,
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  foreign key (hospital_id, batch_id) references public.batches(hospital_id, id) on delete set null (batch_id),
  unique (hospital_id, id)
);

create table public.stock_counts (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  counted_by text,
  status text not null default 'open',
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, counted_by) references public.staff(hospital_id, id) on delete set null (counted_by),
  unique (hospital_id, id)
);

create table public.stock_count_items (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  stock_count_id text not null,
  product_id text not null,
  expected_quantity numeric not null default 0,
  counted_quantity numeric not null default 0,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, stock_count_id) references public.stock_counts(hospital_id, id) on delete cascade,
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete restrict,
  unique (hospital_id, id)
);

create table public.prescriptions (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  patient_id text,
  visit_id text,
  prescribed_by text,
  status text not null default 'open',
  prescribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete set null (patient_id),
  foreign key (hospital_id, visit_id) references public.visits(hospital_id, id) on delete set null (visit_id),
  foreign key (hospital_id, prescribed_by) references public.staff(hospital_id, id) on delete set null (prescribed_by),
  unique (hospital_id, id)
);

create table public.prescription_items (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  prescription_id text not null,
  product_id text,
  dose text,
  quantity numeric not null default 1,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, prescription_id) references public.prescriptions(hospital_id, id) on delete cascade,
  foreign key (hospital_id, product_id) references public.products(hospital_id, id) on delete set null (product_id),
  unique (hospital_id, id)
);

create table public.dispensings (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  prescription_id text,
  patient_id text,
  dispensed_by text,
  dispensed_at timestamptz,
  status text not null default 'complete',
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, prescription_id) references public.prescriptions(hospital_id, id) on delete set null (prescription_id),
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete set null (patient_id),
  foreign key (hospital_id, dispensed_by) references public.staff(hospital_id, id) on delete set null (dispensed_by),
  unique (hospital_id, id)
);

create table public.payments (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  patient_id text,
  visit_id text,
  collected_by text,
  amount_minor bigint not null default 0,
  method text,
  status text not null default 'completed',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete set null (patient_id),
  foreign key (hospital_id, visit_id) references public.visits(hospital_id, id) on delete set null (visit_id),
  foreign key (hospital_id, collected_by) references public.staff(hospital_id, id) on delete set null (collected_by),
  unique (hospital_id, id)
);

create table public.refunds (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  sale_id text,
  payment_id text,
  refunded_by text,
  amount_minor bigint not null default 0,
  reason text,
  refunded_at timestamptz,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, sale_id) references public.sales(hospital_id, id) on delete set null (sale_id),
  foreign key (hospital_id, payment_id) references public.payments(hospital_id, id) on delete set null (payment_id),
  foreign key (hospital_id, refunded_by) references public.staff(hospital_id, id) on delete set null (refunded_by),
  unique (hospital_id, id)
);

create table public.expenses (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  created_by text,
  amount_minor bigint not null default 0,
  category text,
  incurred_at timestamptz,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, created_by) references public.staff(hospital_id, id) on delete set null (created_by),
  unique (hospital_id, id)
);

create table public.hmo_claims (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  patient_id text,
  visit_id text,
  claim_no text,
  scheme text,
  amount_minor bigint not null default 0,
  status text not null default 'draft',
  submitted_at timestamptz,
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete set null (patient_id),
  foreign key (hospital_id, visit_id) references public.visits(hospital_id, id) on delete set null (visit_id),
  unique (hospital_id, id)
);

create table public.shift_reports (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  branch_id text,
  staff_id text,
  submitted_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete set null (staff_id),
  unique (hospital_id, id)
);

create table public.complaints (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  patient_id text,
  visit_id text,
  status text not null default 'open',
  created_by text,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, patient_id) references public.patients(hospital_id, id) on delete set null (patient_id),
  foreign key (hospital_id, visit_id) references public.visits(hospital_id, id) on delete set null (visit_id),
  foreign key (hospital_id, created_by) references public.staff(hospital_id, id) on delete set null (created_by),
  unique (hospital_id, id)
);

create table public.hr_actions (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  action_type text not null,
  effective_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete cascade,
  foreign key (hospital_id, created_by) references public.staff(hospital_id, id) on delete set null (created_by),
  unique (hospital_id, id)
);

create table public.staff_payments (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  staff_id text not null,
  amount_minor bigint not null default 0,
  payment_status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  foreign key (hospital_id, staff_id) references public.staff(hospital_id, id) on delete restrict,
  unique (hospital_id, id)
);

create table public.devices (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  name text not null default '',
  token_hash text,
  status text not null default 'invited',
  created_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attributes jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  unique (hospital_id, id),
  unique (token_hash)
);

create table public.audit_logs (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  branch_id text,
  action text not null,
  entity text,
  record_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  foreign key (hospital_id, branch_id) references public.branches(hospital_id, id) on delete set null (branch_id),
  unique (hospital_id, id)
);

create table public.sync_operations (
  op_id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table public.sync_changes (
  id bigint generated always as identity primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  sequence bigint not null,
  entity text not null,
  record_id text not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (hospital_id, sequence)
);

create table public.auth_rate_limits (
  id text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  audience text not null check (audience in ('hospital', 'platform')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.platform_audit_logs (
  id text primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text,
  record_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.support_tickets (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  issue text not null,
  priority text not null default 'medium',
  status text not null default 'open',
  reply text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_messages (
  id text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  sent_by uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.hospital_settings (
  hospital_id text primary key references public.tenants(id) on delete cascade,
  id text not null default 'settings',
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.device_invites (
  token_hash text primary key,
  hospital_id text not null references public.tenants(id) on delete cascade,
  device_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (hospital_id, device_id) references public.devices(hospital_id, id) on delete cascade
);

insert into public.roles (code, name) values
  ('platform_super_admin', 'Platform Super Admin'),
  ('facility_admin', 'Facility Admin'),
  ('ceo_owner', 'CEO / Owner'),
  ('super_admin', 'Super Admin'),
  ('branch_manager', 'Branch Manager'),
  ('superintendent_pharmacist', 'Superintendent Pharmacist'),
  ('pharmacist', 'Pharmacist'),
  ('inventory_officer', 'Inventory Officer'),
  ('warehouse_officer', 'Warehouse Officer'),
  ('accountant', 'Accountant'),
  ('sales_staff', 'Sales Staff'),
  ('receptionist', 'Receptionist'),
  ('pharmacy_cashier', 'Pharmacy Cashier'),
  ('dispenser', 'Dispenser'),
  ('cashier', 'Cashier'),
  ('doctor', 'Doctor'),
  ('nurse', 'Nurse'),
  ('laboratory_technician', 'Laboratory Technician');

insert into public.role_permissions (role, permission)
select role_code, permission from (
  values
    ('facility_admin', 'dashboard.view'), ('facility_admin', 'dashboard.admin'), ('facility_admin', 'patients.manage'), ('facility_admin', 'queue.view'), ('facility_admin', 'queue.manage'), ('facility_admin', 'billing.collect'), ('facility_admin', 'billing.view'), ('facility_admin', 'billing.refund'), ('facility_admin', 'pharmacy.dispense'), ('facility_admin', 'pharmacy.approve'), ('facility_admin', 'audit.view'), ('facility_admin', 'hmo.manage'), ('facility_admin', 'pos.sell'), ('facility_admin', 'pos.refund'), ('facility_admin', 'report.submit'), ('facility_admin', 'inventory.view'), ('facility_admin', 'inventory.manage'), ('facility_admin', 'purchasing.manage'), ('facility_admin', 'branches.manage'), ('facility_admin', 'warehouse.manage'), ('facility_admin', 'staff.manage'), ('facility_admin', 'stocktaking.manage'), ('facility_admin', 'stocktaking.approve'), ('facility_admin', 'expenses.manage'), ('facility_admin', 'customers.view'), ('facility_admin', 'customers.manage'), ('facility_admin', 'reports.view'), ('facility_admin', 'settings.devices'), ('facility_admin', 'settings.manage'), ('facility_admin', 'subscription.manage'), ('facility_admin', 'ceo.view'),
    ('ceo_owner', 'dashboard.view'), ('ceo_owner', 'dashboard.admin'), ('ceo_owner', 'patients.manage'), ('ceo_owner', 'queue.view'), ('ceo_owner', 'queue.manage'), ('ceo_owner', 'billing.collect'), ('ceo_owner', 'billing.view'), ('ceo_owner', 'billing.refund'), ('ceo_owner', 'pharmacy.dispense'), ('ceo_owner', 'pharmacy.approve'), ('ceo_owner', 'audit.view'), ('ceo_owner', 'hmo.manage'), ('ceo_owner', 'pos.sell'), ('ceo_owner', 'pos.refund'), ('ceo_owner', 'report.submit'), ('ceo_owner', 'inventory.view'), ('ceo_owner', 'inventory.manage'), ('ceo_owner', 'purchasing.manage'), ('ceo_owner', 'branches.manage'), ('ceo_owner', 'warehouse.manage'), ('ceo_owner', 'staff.manage'), ('ceo_owner', 'stocktaking.manage'), ('ceo_owner', 'stocktaking.approve'), ('ceo_owner', 'expenses.manage'), ('ceo_owner', 'customers.view'), ('ceo_owner', 'customers.manage'), ('ceo_owner', 'reports.view'), ('ceo_owner', 'settings.devices'), ('ceo_owner', 'settings.manage'), ('ceo_owner', 'subscription.manage'), ('ceo_owner', 'ceo.view'),
    ('super_admin', 'dashboard.view'), ('super_admin', 'dashboard.admin'), ('super_admin', 'patients.manage'), ('super_admin', 'queue.view'), ('super_admin', 'queue.manage'), ('super_admin', 'billing.collect'), ('super_admin', 'billing.view'), ('super_admin', 'billing.refund'), ('super_admin', 'pharmacy.dispense'), ('super_admin', 'pharmacy.approve'), ('super_admin', 'audit.view'), ('super_admin', 'hmo.manage'), ('super_admin', 'pos.sell'), ('super_admin', 'pos.refund'), ('super_admin', 'report.submit'), ('super_admin', 'inventory.view'), ('super_admin', 'inventory.manage'), ('super_admin', 'purchasing.manage'), ('super_admin', 'branches.manage'), ('super_admin', 'warehouse.manage'), ('super_admin', 'staff.manage'), ('super_admin', 'stocktaking.manage'), ('super_admin', 'stocktaking.approve'), ('super_admin', 'expenses.manage'), ('super_admin', 'customers.view'), ('super_admin', 'customers.manage'), ('super_admin', 'reports.view'), ('super_admin', 'settings.devices'), ('super_admin', 'settings.manage'), ('super_admin', 'subscription.manage'), ('super_admin', 'ceo.view'),
    ('branch_manager', 'pharmacy.dispense'), ('branch_manager', 'audit.view'), ('branch_manager', 'hmo.manage'), ('branch_manager', 'dashboard.view'), ('branch_manager', 'patients.manage'), ('branch_manager', 'queue.view'), ('branch_manager', 'queue.manage'), ('branch_manager', 'billing.view'), ('branch_manager', 'billing.collect'), ('branch_manager', 'billing.refund'), ('branch_manager', 'pos.sell'), ('branch_manager', 'pos.refund'), ('branch_manager', 'inventory.view'), ('branch_manager', 'inventory.manage'), ('branch_manager', 'purchasing.manage'), ('branch_manager', 'branches.manage'), ('branch_manager', 'stocktaking.manage'), ('branch_manager', 'stocktaking.approve'), ('branch_manager', 'expenses.manage'), ('branch_manager', 'customers.view'), ('branch_manager', 'customers.manage'), ('branch_manager', 'reports.view'), ('branch_manager', 'staff.manage'), ('branch_manager', 'settings.devices'),
    ('superintendent_pharmacist', 'pharmacy.dispense'), ('superintendent_pharmacist', 'pharmacy.approve'), ('superintendent_pharmacist', 'dashboard.view'), ('superintendent_pharmacist', 'queue.view'), ('superintendent_pharmacist', 'pos.sell'), ('superintendent_pharmacist', 'pos.refund'), ('superintendent_pharmacist', 'inventory.view'), ('superintendent_pharmacist', 'inventory.manage'), ('superintendent_pharmacist', 'purchasing.manage'), ('superintendent_pharmacist', 'stocktaking.manage'), ('superintendent_pharmacist', 'stocktaking.approve'), ('superintendent_pharmacist', 'customers.view'), ('superintendent_pharmacist', 'customers.manage'), ('superintendent_pharmacist', 'reports.view'), ('superintendent_pharmacist', 'settings.devices'),
    ('pharmacist', 'pharmacy.dispense'), ('pharmacist', 'pharmacy.approve'), ('pharmacist', 'dashboard.view'), ('pharmacist', 'queue.view'), ('pharmacist', 'pos.sell'), ('pharmacist', 'inventory.view'), ('pharmacist', 'inventory.manage'), ('pharmacist', 'customers.view'), ('pharmacist', 'reports.view'), ('pharmacist', 'settings.devices'),
    ('inventory_officer', 'dashboard.view'), ('inventory_officer', 'inventory.view'), ('inventory_officer', 'inventory.manage'), ('inventory_officer', 'purchasing.manage'), ('inventory_officer', 'stocktaking.manage'), ('inventory_officer', 'settings.devices'),
    ('warehouse_officer', 'dashboard.view'), ('warehouse_officer', 'warehouse.manage'), ('warehouse_officer', 'inventory.view'), ('warehouse_officer', 'stocktaking.manage'), ('warehouse_officer', 'settings.devices'),
    ('accountant', 'audit.view'), ('accountant', 'hmo.manage'), ('accountant', 'dashboard.view'), ('accountant', 'billing.view'), ('accountant', 'expenses.manage'), ('accountant', 'reports.view'), ('accountant', 'customers.view'), ('accountant', 'customers.manage'), ('accountant', 'subscription.manage'), ('accountant', 'settings.devices'),
    ('sales_staff', 'dashboard.view'), ('sales_staff', 'pos.sell'), ('sales_staff', 'inventory.view'), ('sales_staff', 'customers.view'), ('sales_staff', 'settings.devices'),
    ('receptionist', 'dashboard.view'), ('receptionist', 'patients.manage'), ('receptionist', 'queue.view'), ('receptionist', 'queue.manage'), ('receptionist', 'settings.devices'),
    ('pharmacy_cashier', 'dashboard.view'), ('pharmacy_cashier', 'billing.collect'), ('pharmacy_cashier', 'billing.view'), ('pharmacy_cashier', 'queue.view'), ('pharmacy_cashier', 'pos.sell'), ('pharmacy_cashier', 'pos.refund'), ('pharmacy_cashier', 'inventory.view'), ('pharmacy_cashier', 'report.submit'), ('pharmacy_cashier', 'settings.devices'),
    ('dispenser', 'pharmacy.dispense'), ('dispenser', 'dashboard.view'), ('dispenser', 'queue.view'), ('dispenser', 'pos.sell'), ('dispenser', 'inventory.view'), ('dispenser', 'settings.devices'),
    ('cashier', 'dashboard.view'), ('cashier', 'billing.collect'), ('cashier', 'billing.view'), ('cashier', 'billing.refund'), ('cashier', 'queue.view'), ('cashier', 'pos.sell'), ('cashier', 'pos.refund'), ('cashier', 'inventory.view'), ('cashier', 'report.submit'), ('cashier', 'settings.devices'),
    ('doctor', 'dashboard.view'), ('doctor', 'patients.manage'), ('doctor', 'queue.view'), ('doctor', 'queue.manage'), ('doctor', 'pharmacy.dispense'),
    ('nurse', 'dashboard.view'), ('nurse', 'patients.manage'), ('nurse', 'queue.view'), ('nurse', 'queue.manage'),
    ('laboratory_technician', 'dashboard.view'), ('laboratory_technician', 'patients.manage'), ('laboratory_technician', 'queue.view')
) as permissions(role_code, permission);

create schema if not exists private;

create or replace function private.current_user_can(target_hospital text, target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.hospital_id = target_hospital
      and exists (
        select 1
        from unnest(p.roles) as held(role)
        join public.role_permissions rp on rp.role = held.role
        where rp.permission = target_permission
      )
  ) or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.roles @> array['platform_super_admin']::text[]
  );
$$;

create or replace function private.current_user_has_role(target_hospital text, target_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.hospital_id = target_hospital
      and p.roles && target_roles
  ) or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active
      and p.roles @> array['platform_super_admin']::text[]
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.current_user_can(text, text) from public, anon;
revoke all on function private.current_user_has_role(text, text[]) from public, anon;
grant execute on function private.current_user_can(text, text) to authenticated;
grant execute on function private.current_user_has_role(text, text[]) to authenticated;

create index tenants_status_idx on public.tenants(status);
create index profiles_hospital_idx on public.profiles(hospital_id, active);
create index profile_roles_hospital_role_idx on public.profile_roles(hospital_id, role);
create index staff_hospital_branch_idx on public.staff(hospital_id, branch_id);
create index staff_roles_staff_idx on public.staff_roles(hospital_id, staff_id);
create index patients_hospital_name_idx on public.patients(hospital_id, last_name, first_name);
create index visits_hospital_patient_time_idx on public.visits(hospital_id, patient_id, opened_at desc);
create index appointments_hospital_time_idx on public.appointments(hospital_id, scheduled_at);
create index products_hospital_barcode_idx on public.products(hospital_id, barcode);
create index batches_product_expiry_idx on public.batches(hospital_id, product_id, expiry_date);
create index customers_hospital_name_idx on public.customers(hospital_id, name);
create index suppliers_hospital_name_idx on public.suppliers(hospital_id, name);
create index sales_hospital_time_idx on public.sales(hospital_id, sold_at desc);
create index sale_items_hospital_sale_idx on public.sale_items(hospital_id, sale_id);
create index purchase_orders_hospital_time_idx on public.purchase_orders(hospital_id, ordered_at desc);
create index purchase_order_items_hospital_order_idx on public.purchase_order_items(hospital_id, purchase_order_id);
create index stock_movements_hospital_time_idx on public.stock_movements(hospital_id, created_at desc);
create index transfers_hospital_time_idx on public.transfers(hospital_id, created_at desc);
create index transfer_items_hospital_transfer_idx on public.transfer_items(hospital_id, transfer_id);
create index stock_counts_hospital_time_idx on public.stock_counts(hospital_id, counted_at desc);
create index stock_count_items_hospital_count_idx on public.stock_count_items(hospital_id, stock_count_id);
create index prescriptions_hospital_patient_idx on public.prescriptions(hospital_id, patient_id, prescribed_at desc);
create index prescription_items_hospital_prescription_idx on public.prescription_items(hospital_id, prescription_id);
create index dispensings_hospital_time_idx on public.dispensings(hospital_id, dispensed_at desc);
create index payments_hospital_time_idx on public.payments(hospital_id, paid_at desc);
create index refunds_hospital_time_idx on public.refunds(hospital_id, refunded_at desc);
create index expenses_hospital_time_idx on public.expenses(hospital_id, incurred_at desc);
create index hmo_claims_hospital_time_idx on public.hmo_claims(hospital_id, submitted_at desc);
create index shift_reports_hospital_time_idx on public.shift_reports(hospital_id, submitted_at desc);
create index complaints_hospital_time_idx on public.complaints(hospital_id, created_at desc);
create index hr_actions_hospital_time_idx on public.hr_actions(hospital_id, effective_at desc);
create index staff_payments_hospital_time_idx on public.staff_payments(hospital_id, paid_at desc);
create index sync_operations_hospital_idx on public.sync_operations(hospital_id);
create index audit_logs_hospital_time_idx on public.audit_logs(hospital_id, created_at desc);
create index sync_changes_hospital_sequence_idx on public.sync_changes(hospital_id, sequence);
create index support_tickets_hospital_time_idx on public.support_tickets(hospital_id, created_at desc);
create index subscriptions_hospital_time_idx on public.subscriptions(hospital_id, created_at desc);
create index device_invites_hospital_idx on public.device_invites(hospital_id, device_id);

do $$
declare
  item record;
begin
  for item in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', item.tablename);
  end loop;
end;
$$;

create policy tenants_read on public.tenants for select to authenticated using (id = (select p.hospital_id from public.profiles p where p.id = (select auth.uid())) or private.current_user_has_role(id, array['platform_super_admin']::text[]));
create policy tenants_update on public.tenants for update to authenticated using (private.current_user_can(id, 'settings.manage')) with check (private.current_user_can(id, 'settings.manage'));
create policy branches_access on public.branches for all to authenticated using (private.current_user_can(hospital_id, 'branches.manage')) with check (private.current_user_can(hospital_id, 'branches.manage'));
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or private.current_user_can(hospital_id, 'staff.manage'));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid()) or private.current_user_can(hospital_id, 'staff.manage')) with check (id = (select auth.uid()) or private.current_user_can(hospital_id, 'staff.manage'));
create policy profile_roles_read on public.profile_roles for select to authenticated using (user_id = (select auth.uid()) or private.current_user_can(hospital_id, 'staff.manage') or private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy profile_roles_manage on public.profile_roles for all to authenticated using (private.current_user_can(hospital_id, 'staff.manage') or private.current_user_has_role(null, array['platform_super_admin']::text[])) with check (private.current_user_can(hospital_id, 'staff.manage') or private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated using (true);

create policy staff_read on public.staff for select to authenticated using (auth_user_id = (select auth.uid()) or private.current_user_can(hospital_id, 'staff.manage'));
create policy staff_write on public.staff for insert to authenticated with check (private.current_user_can(hospital_id, 'staff.manage'));
create policy staff_update on public.staff for update to authenticated using (private.current_user_can(hospital_id, 'staff.manage')) with check (private.current_user_can(hospital_id, 'staff.manage'));
create policy staff_delete on public.staff for delete to authenticated using (private.current_user_can(hospital_id, 'staff.manage'));
create policy staff_roles_access on public.staff_roles for all to authenticated using (private.current_user_can(hospital_id, 'staff.manage')) with check (private.current_user_can(hospital_id, 'staff.manage'));

create policy modules_read on public.modules for select to authenticated using (true);
create policy subscription_plans_read on public.subscription_plans for select to authenticated using (true);
create policy subscriptions_access on public.subscriptions for all to authenticated using (private.current_user_can(hospital_id, 'subscription.manage') or private.current_user_can(hospital_id, 'billing.view')) with check (private.current_user_can(hospital_id, 'subscription.manage'));
create policy module_entitlements_access on public.module_entitlements for all to authenticated using (private.current_user_can(hospital_id, 'subscription.manage')) with check (private.current_user_can(hospital_id, 'subscription.manage'));
create policy tenant_modules_access on public.tenant_modules for all to authenticated using (private.current_user_can(hospital_id, 'settings.manage') or private.current_user_can(hospital_id, 'dashboard.view')) with check (private.current_user_can(hospital_id, 'settings.manage'));

create policy patients_access on public.patients for all to authenticated using (private.current_user_can(hospital_id, 'patients.manage')) with check (private.current_user_can(hospital_id, 'patients.manage'));
create policy visits_access on public.visits for all to authenticated using (private.current_user_can(hospital_id, 'patients.manage') or private.current_user_can(hospital_id, 'queue.view')) with check (private.current_user_can(hospital_id, 'queue.manage') or private.current_user_can(hospital_id, 'patients.manage'));
create policy appointments_access on public.appointments for all to authenticated using (private.current_user_can(hospital_id, 'patients.manage') or private.current_user_can(hospital_id, 'queue.view')) with check (private.current_user_can(hospital_id, 'queue.manage') or private.current_user_can(hospital_id, 'patients.manage'));
create policy products_access on public.products for all to authenticated using (private.current_user_can(hospital_id, 'inventory.view')) with check (private.current_user_can(hospital_id, 'inventory.manage'));
create policy batches_access on public.batches for all to authenticated using (private.current_user_can(hospital_id, 'inventory.view')) with check (private.current_user_can(hospital_id, 'inventory.manage'));
create policy customers_access on public.customers for all to authenticated using (private.current_user_can(hospital_id, 'customers.view')) with check (private.current_user_can(hospital_id, 'customers.manage'));
create policy suppliers_access on public.suppliers for all to authenticated using (private.current_user_can(hospital_id, 'purchasing.manage')) with check (private.current_user_can(hospital_id, 'purchasing.manage'));
create policy sales_access on public.sales for all to authenticated using (private.current_user_can(hospital_id, 'pos.sell')) with check (private.current_user_can(hospital_id, 'pos.sell'));
create policy sale_items_access on public.sale_items for all to authenticated using (private.current_user_can(hospital_id, 'pos.sell')) with check (private.current_user_can(hospital_id, 'pos.sell'));
create policy purchase_orders_access on public.purchase_orders for all to authenticated using (private.current_user_can(hospital_id, 'purchasing.manage')) with check (private.current_user_can(hospital_id, 'purchasing.manage'));
create policy purchase_order_items_access on public.purchase_order_items for all to authenticated using (private.current_user_can(hospital_id, 'purchasing.manage')) with check (private.current_user_can(hospital_id, 'purchasing.manage'));
create policy stock_movements_access on public.stock_movements for all to authenticated using (private.current_user_can(hospital_id, 'inventory.view')) with check (private.current_user_can(hospital_id, 'inventory.manage') or private.current_user_can(hospital_id, 'pos.sell'));
create policy transfers_access on public.transfers for all to authenticated using (private.current_user_can(hospital_id, 'warehouse.manage') or private.current_user_can(hospital_id, 'inventory.view')) with check (private.current_user_can(hospital_id, 'warehouse.manage'));
create policy transfer_items_access on public.transfer_items for all to authenticated using (private.current_user_can(hospital_id, 'warehouse.manage') or private.current_user_can(hospital_id, 'inventory.view')) with check (private.current_user_can(hospital_id, 'warehouse.manage'));
create policy stock_counts_access on public.stock_counts for all to authenticated using (private.current_user_can(hospital_id, 'stocktaking.manage')) with check (private.current_user_can(hospital_id, 'stocktaking.manage'));
create policy stock_count_items_access on public.stock_count_items for all to authenticated using (private.current_user_can(hospital_id, 'stocktaking.manage')) with check (private.current_user_can(hospital_id, 'stocktaking.manage'));
create policy prescriptions_access on public.prescriptions for all to authenticated using (private.current_user_can(hospital_id, 'pharmacy.dispense') or private.current_user_can(hospital_id, 'patients.manage')) with check (private.current_user_can(hospital_id, 'pharmacy.dispense') or private.current_user_can(hospital_id, 'patients.manage'));
create policy prescription_items_access on public.prescription_items for all to authenticated using (private.current_user_can(hospital_id, 'pharmacy.dispense') or private.current_user_can(hospital_id, 'patients.manage')) with check (private.current_user_can(hospital_id, 'pharmacy.dispense') or private.current_user_can(hospital_id, 'patients.manage'));
create policy dispensings_access on public.dispensings for all to authenticated using (private.current_user_can(hospital_id, 'pharmacy.dispense')) with check (private.current_user_can(hospital_id, 'pharmacy.dispense'));
create policy payments_access on public.payments for all to authenticated using (private.current_user_can(hospital_id, 'billing.view')) with check (private.current_user_can(hospital_id, 'billing.collect'));
create policy refunds_access on public.refunds for all to authenticated using (private.current_user_can(hospital_id, 'billing.view') or private.current_user_can(hospital_id, 'pos.sell')) with check (private.current_user_can(hospital_id, 'billing.refund') or private.current_user_can(hospital_id, 'pos.refund'));
create policy expenses_access on public.expenses for all to authenticated using (private.current_user_can(hospital_id, 'expenses.manage')) with check (private.current_user_can(hospital_id, 'expenses.manage'));
create policy hmo_claims_access on public.hmo_claims for all to authenticated using (private.current_user_can(hospital_id, 'hmo.manage')) with check (private.current_user_can(hospital_id, 'hmo.manage'));
create policy shift_reports_access on public.shift_reports for all to authenticated using (private.current_user_can(hospital_id, 'report.submit') or private.current_user_can(hospital_id, 'reports.view')) with check (private.current_user_can(hospital_id, 'report.submit'));
create policy complaints_access on public.complaints for all to authenticated using (private.current_user_can(hospital_id, 'patients.manage')) with check (private.current_user_can(hospital_id, 'patients.manage'));
create policy hr_actions_access on public.hr_actions for all to authenticated using (private.current_user_can(hospital_id, 'staff.manage')) with check (private.current_user_can(hospital_id, 'staff.manage'));
create policy staff_payments_access on public.staff_payments for all to authenticated using (private.current_user_can(hospital_id, 'staff.manage') or private.current_user_can(hospital_id, 'billing.view')) with check (private.current_user_can(hospital_id, 'staff.manage'));
create policy devices_access on public.devices for all to authenticated using (private.current_user_can(hospital_id, 'settings.devices')) with check (private.current_user_can(hospital_id, 'settings.devices'));
create policy audit_logs_read on public.audit_logs for select to authenticated using (private.current_user_can(hospital_id, 'audit.view'));
create policy audit_logs_insert on public.audit_logs for insert to authenticated with check (actor_id = (select auth.uid()) and private.current_user_can(hospital_id, 'dashboard.view'));
create policy sync_operations_access on public.sync_operations for all to authenticated using (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[])) with check (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy sync_changes_read on public.sync_changes for select to authenticated using (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy sync_changes_insert on public.sync_changes for insert to authenticated with check (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy support_tickets_read on public.support_tickets for select to authenticated using (private.current_user_can(hospital_id, 'staff.manage') or created_by = (select auth.uid()));
create policy support_tickets_insert on public.support_tickets for insert to authenticated with check (created_by = (select auth.uid()) and private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin','branch_manager','doctor','nurse','pharmacist','superintendent_pharmacist','inventory_officer','warehouse_officer','accountant','sales_staff','receptionist','pharmacy_cashier','dispenser','cashier','laboratory_technician']::text[]));
create policy support_tickets_update on public.support_tickets for update to authenticated using (private.current_user_can(hospital_id, 'staff.manage')) with check (private.current_user_can(hospital_id, 'staff.manage'));
create policy support_tickets_platform_read on public.support_tickets for select to authenticated using (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy support_tickets_platform_update on public.support_tickets for update to authenticated using (private.current_user_has_role(null, array['platform_super_admin']::text[])) with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy platform_audit_platform_read on public.platform_audit_logs for select to authenticated using (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy platform_audit_platform_insert on public.platform_audit_logs for insert to authenticated with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy platform_settings_platform_access on public.platform_settings for all to authenticated using (private.current_user_has_role(null, array['platform_super_admin']::text[])) with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy platform_messages_platform_access on public.platform_messages for all to authenticated using (private.current_user_has_role(null, array['platform_super_admin']::text[])) with check (private.current_user_has_role(null, array['platform_super_admin']::text[]));
create policy hospital_settings_access on public.hospital_settings for all to authenticated using (private.current_user_can(hospital_id, 'settings.manage')) with check (private.current_user_can(hospital_id, 'settings.manage'));
create policy device_invites_access on public.device_invites for all to authenticated using (private.current_user_can(hospital_id, 'settings.devices')) with check (private.current_user_can(hospital_id, 'settings.devices'));

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.tenants, public.branches, public.roles, public.profile_roles, public.role_permissions, public.staff, public.staff_roles, public.modules, public.subscription_plans, public.subscriptions, public.module_entitlements, public.tenant_modules, public.patients, public.visits, public.appointments, public.products, public.batches, public.customers, public.suppliers, public.sales, public.sale_items, public.purchase_orders, public.purchase_order_items, public.stock_movements, public.transfers, public.transfer_items, public.stock_counts, public.stock_count_items, public.prescriptions, public.prescription_items, public.dispensings, public.payments, public.refunds, public.expenses, public.hmo_claims, public.shift_reports, public.complaints, public.hr_actions, public.staff_payments, public.devices, public.audit_logs, public.sync_operations, public.sync_changes, public.support_tickets, public.platform_audit_logs, public.platform_settings, public.platform_messages, public.hospital_settings, public.device_invites to authenticated;
grant select on public.profiles to authenticated;
grant update (name, phone) on public.profiles to authenticated;
revoke all on public.auth_rate_limits, public.app_sessions from anon, authenticated;
revoke all on public.role_permissions from anon;
grant select on public.role_permissions, public.roles, public.modules, public.subscription_plans to authenticated;
