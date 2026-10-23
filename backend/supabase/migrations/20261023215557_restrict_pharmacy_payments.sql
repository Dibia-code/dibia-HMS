delete from public.role_permissions
where (role = 'pharmacy_cashier' and permission in ('billing.collect', 'billing.view', 'queue.view'))
   or (role = 'pharmacist' and permission in ('pharmacy.approve', 'queue.view', 'pos.sell', 'customers.view', 'reports.view'))
   or (role = 'dispenser' and permission = 'pos.sell')
   or (role = 'cashier' and permission in ('pos.sell', 'pos.refund', 'inventory.view', 'queue.view'));

create or replace function private.pharmacy_collection_enabled(target_hospital text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(
    private.current_user_has_role(target_hospital, array['facility_admin','ceo_owner','super_admin']::text[])
    or not private.current_user_has_role(target_hospital, array['pharmacist','superintendent_pharmacist','pharmacy_cashier','dispenser','sales_staff']::text[])
    or coalesce((hs.value ->> 'pharmacyCollectPayments')::boolean, true)
  ), false)
  from public.profiles p
  left join public.hospital_settings hs on hs.hospital_id = p.hospital_id
  where p.id = (select auth.uid())
    and p.active
    and p.hospital_id = target_hospital;
$$;

revoke all on function private.pharmacy_collection_enabled(text) from public, anon;
grant execute on function private.pharmacy_collection_enabled(text) to authenticated;

drop policy if exists sales_access on public.sales;
create policy sales_access on public.sales for all to authenticated
using (
  private.current_user_can(hospital_id, 'pos.sell')
  and (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[]) or private.pharmacy_collection_enabled(hospital_id))
)
with check (
  private.current_user_can(hospital_id, 'pos.sell')
  and (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[]) or private.pharmacy_collection_enabled(hospital_id))
);

drop policy if exists sale_items_access on public.sale_items;
create policy sale_items_access on public.sale_items for all to authenticated
using (
  private.current_user_can(hospital_id, 'pos.sell')
  and (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[]) or private.pharmacy_collection_enabled(hospital_id))
)
with check (
  private.current_user_can(hospital_id, 'pos.sell')
  and (private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[]) or private.pharmacy_collection_enabled(hospital_id))
);

drop policy if exists stock_movements_access on public.stock_movements;
create policy stock_movements_access on public.stock_movements for all to authenticated
using (private.current_user_can(hospital_id, 'inventory.view'))
with check (
  (
    private.current_user_can(hospital_id, 'inventory.manage')
    or private.current_user_can(hospital_id, 'pos.sell')
  )
  and (
    coalesce(attributes ->> 'type', '') <> 'sale'
    or private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[])
    or private.pharmacy_collection_enabled(hospital_id)
  )
);

drop policy if exists refunds_access on public.refunds;
create policy refunds_access on public.refunds for all to authenticated
using (private.current_user_can(hospital_id, 'billing.view') or private.current_user_can(hospital_id, 'pos.sell'))
with check (
  (private.current_user_can(hospital_id, 'billing.refund') or private.current_user_can(hospital_id, 'pos.refund'))
  and (
    private.current_user_has_role(hospital_id, array['facility_admin','ceo_owner','super_admin']::text[])
    or private.pharmacy_collection_enabled(hospital_id)
  )
);

drop policy if exists payments_access on public.payments;
create policy payments_access on public.payments for all to authenticated
using (private.current_user_can(hospital_id, 'billing.view'))
with check (
  private.current_user_can(hospital_id, 'billing.collect')
  and private.pharmacy_collection_enabled(hospital_id)
);
