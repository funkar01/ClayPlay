begin;
-- Bearer links expose only the explicitly shared snapshot, never the library.
create table if not exists public.mask_share_links (
 token uuid primary key default gen_random_uuid(),
 sender_id uuid not null references auth.users(id) on delete cascade,
 source_mask_id uuid not null,
 payload jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.mask_share_links enable row level security;
revoke all on public.mask_share_links from anon, authenticated;

create or replace function public.create_mask_share_link(mask_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.saved_masks%rowtype; result uuid;
begin
 if auth.uid() is null or public.verified_mask_email() is null then
  raise exception 'Confirm your email before sharing.' using errcode='42501';
 end if;
 select * into source from public.saved_masks where id=mask_id and owner_id=auth.uid();
 if not found then raise exception 'Only your own saved masks can be shared.' using errcode='42501'; end if;
 if (select count(*) from public.mask_share_links where sender_id=auth.uid() and created_at>now()-interval '1 day')>=100 then
  raise exception 'Sharing limit reached. Please try tomorrow.';
 end if;
 insert into public.mask_share_links(sender_id,source_mask_id,payload)
 values(auth.uid(),source.id,source.payload) returning token into result;
 return result;
end;
$$;
revoke all on function public.create_mask_share_link(uuid) from public,anon;
grant execute on function public.create_mask_share_link(uuid) to authenticated;

create or replace function public.open_mask_share_link(link_token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select payload from public.mask_share_links where token=link_token;
$$;
revoke all on function public.open_mask_share_link(uuid) from public;
grant execute on function public.open_mask_share_link(uuid) to anon,authenticated;
commit;
