-- Run once in Supabase SQL Editor. Existing mask_libraries data is untouched.
begin;
create table public.saved_masks (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  shape text not null check (char_length(shape) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  payload jsonb not null check (payload @> '{"version":1,"codec":"gzip"}'::jsonb
    and payload ? 'data' and jsonb_typeof(payload->'data')='string' and octet_length(payload::text)<=16778240),
  revision bigint not null default 1 check (revision>0),
  save_request uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_masks_owner_updated on public.saved_masks(owner_id,updated_at desc);
alter table public.saved_masks enable row level security;
revoke all on public.saved_masks from anon,authenticated;
grant select,insert,update on public.saved_masks to authenticated;
create policy "Read own mask collection" on public.saved_masks for select to authenticated using ((select auth.uid())=owner_id);
create policy "Create own collection masks" on public.saved_masks for insert to authenticated with check ((select auth.uid())=owner_id);
create policy "Update own collection masks" on public.saved_masks for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

create function public.save_collection_mask(mask_id uuid,expected_revision bigint,save_request uuid,mask_name text,mask_shape text,mask_color text,mask_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.saved_masks%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if expected_revision is null or expected_revision<0 then raise exception 'Invalid revision'; end if;
  -- Replaying the same completed request is safe after a lost network response.
  select * into result from public.saved_masks where id=mask_id and owner_id=auth.uid() for update;
  if found and result.save_request=save_collection_mask.save_request then
    return jsonb_build_object('id',result.id,'revision',result.revision,'updated_at',result.updated_at);
  end if;
  if expected_revision=0 then
    insert into public.saved_masks(id,owner_id,name,shape,color,payload,save_request)
      values(mask_id,auth.uid(),mask_name,mask_shape,mask_color,mask_payload,save_collection_mask.save_request)
      on conflict(id) do nothing returning * into result;
  else
    update public.saved_masks as masks set name=mask_name,shape=mask_shape,color=mask_color,payload=mask_payload,
      save_request=save_collection_mask.save_request,revision=masks.revision+1,updated_at=now()
      where masks.id=mask_id and masks.owner_id=auth.uid() and masks.revision=expected_revision returning * into result;
  end if;
  if result.id is null then
    select * into result from public.saved_masks where id=mask_id and owner_id=auth.uid() and saved_masks.save_request=save_collection_mask.save_request;
    if not found then raise exception 'Mask changed on another device' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('id',result.id,'revision',result.revision,'updated_at',result.updated_at);
end;
$$;
revoke all on function public.save_collection_mask(uuid,bigint,uuid,text,text,text,jsonb) from public,anon;
grant execute on function public.save_collection_mask(uuid,bigint,uuid,text,text,text,jsonb) to authenticated;
commit;
