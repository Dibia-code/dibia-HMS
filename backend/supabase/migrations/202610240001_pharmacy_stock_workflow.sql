insert into public.role_permissions (role, permission)
values
  ('pharmacy_cashier', 'pharmacy.dispense'),
  ('pharmacy_cashier', 'inventory.manage'),
  ('dispenser', 'inventory.manage'),
  ('cashier', 'patients.manage'),
  ('cashier', 'queue.view'),
  ('cashier', 'queue.manage')
on conflict (role, permission) do nothing;
