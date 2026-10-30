begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(11);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','mask-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','mask-b@example.test');
set local role anon;
select throws_ok('select * from public.saved_masks','42501',null,'Guests cannot read masks');
select throws_ok($$select public.save_collection_mask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mask','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}')$$,'42501',null,'Guests cannot save masks');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is((public.save_collection_mask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mask','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}')->>'revision')::bigint,1::bigint,'Owner can save a new mask');
select is((public.save_collection_mask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Mask','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}')->>'revision')::bigint,1::bigint,'Replaying a completed save returns the same revision');
select is((select count(*) from public.saved_masks),1::bigint,'Request replay does not duplicate masks');
select throws_ok($$select public.save_collection_mask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Stale','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}')$$,'40001','Mask changed on another device','A stale save cannot overwrite a mask');
select is((public.save_collection_mask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Updated','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}')->>'revision')::bigint,2::bigint,'Matching revision updates the mask');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.saved_masks),0::bigint,'A different account cannot see saved masks');
with changed as(update public.saved_masks set name='Intruder' returning *)
select is((select count(*) from changed),0::bigint,'A different account cannot change saved masks');
select throws_ok($$insert into public.saved_masks(id,owner_id,name,shape,color,payload,save_request)values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','Foreign','full','#cd6e45','{"version":1,"codec":"gzip","data":"test"}','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')$$,'42501',null,'Another account cannot insert for the owner');
select throws_ok('delete from public.saved_masks','42501',null,'Direct mask deletion is not granted');
reset role;
select * from finish();
rollback;
