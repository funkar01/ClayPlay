begin;
grant delete on public.saved_masks to authenticated;
drop policy if exists "Delete own collection masks" on public.saved_masks;
create policy "Delete own collection masks" on public.saved_masks for delete to authenticated using ((select auth.uid())=owner_id);
create or replace function public.delete_collection_mask(mask_id uuid,expected_revision bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_revision bigint;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select revision into current_revision from public.saved_masks where id=mask_id and owner_id=auth.uid() for update;
  if not found then return false; end if;
  if current_revision is distinct from expected_revision then raise exception 'Mask changed on another device' using errcode='40001'; end if;
  delete from public.saved_masks where id=mask_id and owner_id=auth.uid();
  return true;
end;
$$;
revoke all on function public.delete_collection_mask(uuid,bigint) from public,anon;
grant execute on function public.delete_collection_mask(uuid,bigint) to authenticated;
commit;
