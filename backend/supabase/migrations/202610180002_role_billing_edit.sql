insert into public.role_permissions (role, permission)
values ('cashier', 'billing.edit'), ('branch_manager', 'billing.edit'), ('facility_admin', 'billing.edit'), ('ceo_owner', 'billing.edit'), ('super_admin', 'billing.edit')
on conflict (role, permission) do nothing;

delete from public.role_permissions
where role = 'cashier'
  and permission in ('queue.view', 'pos.sell', 'pos.refund', 'inventory.view');

delete from public.role_permissions
where role = 'pharmacist'
  and permission in ('pharmacy.approve', 'pos.sell', 'queue.view', 'customers.view', 'reports.view');

delete from public.role_permissions
where role = 'doctor'
  and permission = 'pharmacy.dispense';
