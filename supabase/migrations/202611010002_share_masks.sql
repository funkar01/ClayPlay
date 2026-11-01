begin;
create table if not exists public.mask_shares (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references auth.users(id) on delete cascade,
 source_mask_id uuid not null, recipient_email text not null,
 name text not null, shape text not null, color text not null, payload jsonb not null,
 revision bigint not null default 1, updated_at timestamptz not null default now(),
 unique(sender_id,source_mask_id,recipient_email)
);
alter table public.mask_shares enable row level security;
revoke all on public.mask_shares from anon,authenticated;
grant select on public.mask_shares to authenticated;
create or replace function public.verified_mask_email() returns text
language sql stable security definer set search_path='' as $$
 select lower(trim(email)) from auth.users where id=auth.uid() and email_confirmed_at is not null;
$$;
revoke all on function public.verified_mask_email() from public,anon;
grant execute on function public.verified_mask_email() to authenticated;
drop policy if exists "Read received masks" on public.mask_shares;
create policy "Read received masks" on public.mask_shares for select to authenticated
 using (recipient_email=(select public.verified_mask_email()));
create or replace function public.share_collection_mask(mask_id uuid,friend_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.saved_masks%rowtype; recipient text:=lower(trim(friend_email)); result uuid;
begin
 if auth.uid() is null or public.verified_mask_email() is null then raise exception 'Confirm your email before sharing.' using errcode='42501'; end if;
 if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid friend email address.'; end if;
 if recipient=public.verified_mask_email() then raise exception 'Enter your friend’s email, rather than your own.'; end if;
 select * into source from public.saved_masks where id=mask_id and owner_id=auth.uid();
 if not found then raise exception 'Save this mask in your own collection before sharing it.' using errcode='42501'; end if;
 if (select count(*) from public.mask_shares where sender_id=auth.uid() and updated_at>now()-interval '1 day')>=100 then raise exception 'Sharing limit reached. Please try tomorrow.'; end if;
 insert into public.mask_shares(sender_id,source_mask_id,recipient_email,name,shape,color,payload)
 values(auth.uid(),source.id,recipient,source.name,source.shape,source.color,source.payload)
 on conflict(sender_id,source_mask_id,recipient_email) do update set name=excluded.name,shape=excluded.shape,color=excluded.color,payload=excluded.payload,revision=mask_shares.revision+1,updated_at=now()
 returning id into result;
 return result;
end;
$$;
revoke all on function public.share_collection_mask(uuid,text) from public,anon;
grant execute on function public.share_collection_mask(uuid,text) to authenticated;
commit;
