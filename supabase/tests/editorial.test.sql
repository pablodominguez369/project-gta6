begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Users: an admin, two editors and a read-only member -----------------------
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'ed-admin@example.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000001', 'editor-one@example.test', 'authenticated', 'authenticated'),
  ('e0000000-0000-4000-8000-000000000002', 'editor-two@example.test', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000001', 'ed-reader@example.test', 'authenticated', 'authenticated');

insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', 'admin'),
  ('e0000000-0000-4000-8000-000000000001', 'editor'),
  ('e0000000-0000-4000-8000-000000000002', 'editor'),
  ('c0000000-0000-4000-8000-000000000001', 'read_only');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Fixtures written as the service role ---------------------------------------
insert into public.sources (id, url, canonical_url, publisher, title, source_type, trust_level)
values ('50000000-0000-4000-8000-000000000001', 'https://example.test/news/1',
        'https://example.test/news/1', 'Example Press', 'Announcement', 'press', 2);

insert into public.opportunities (id, topic) values
  ('0a000000-0000-4000-8000-000000000001', 'Trailer analysis');

-- Feeds ----------------------------------------------------------------------
select throws_ok(
  $$insert into public.feed_sources (url, publisher, kind, source_type, enabled)
    values ('https://example.test/feed.xml', 'Example', 'rss', 'press', true)$$,
  '23514', null,
  'a feed cannot be enabled before its terms are recorded'
);

select pg_temp.login('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.feed_sources (url, publisher, kind, source_type)
    values ('https://example.test/other.xml', 'Example', 'rss', 'press')$$,
  '42501', null,
  'editors cannot add feeds (admin only)'
);

-- Sources --------------------------------------------------------------------
select lives_ok(
  $$insert into public.sources (url, canonical_url, publisher, title, source_type, added_by)
    values ('https://example.test/a', 'https://example.test/a', 'Example', 'Manual source', 'press',
            'e0000000-0000-4000-8000-000000000001')$$,
  'an editor can add a source manually'
);

select throws_ok(
  $$insert into public.sources (url, canonical_url, publisher, title, source_type, added_by, excerpt)
    values ('https://example.test/b', 'https://example.test/b', 'Example', 'Long', 'press',
            'e0000000-0000-4000-8000-000000000001', repeat('x', 301))$$,
  '23514', null,
  'an excerpt longer than 300 characters is rejected'
);

select is_empty(
  $$update public.sources set title = 'changed' returning id$$,
  'sources cannot be edited by clients'
);
select pg_temp.logout();

select pg_temp.login('c0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.sources (url, canonical_url, publisher, title, source_type, added_by)
    values ('https://example.test/c', 'https://example.test/c', 'Example', 'Nope', 'press',
            'c0000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'read_only cannot add sources'
);
select pg_temp.logout();

-- Claims ---------------------------------------------------------------------
create function pg_temp.confirmed_claim_without_source() returns void language plpgsql as $$
begin
  insert into public.claims (opportunity_id, text, certainty, created_by)
  values ('0a000000-0000-4000-8000-000000000001', 'Release date announced', 'confirmed',
          'e0000000-0000-4000-8000-000000000001');
  set constraints public.claims_require_source immediate;
end;
$$;

create function pg_temp.reported_claim_with_source() returns void language plpgsql as $$
declare
  new_id uuid;
begin
  insert into public.claims (opportunity_id, text, certainty, created_by)
  values ('0a000000-0000-4000-8000-000000000001', 'A studio said X', 'reported',
          'e0000000-0000-4000-8000-000000000001')
  returning id into new_id;
  insert into public.claim_sources (claim_id, source_id)
  values (new_id, '50000000-0000-4000-8000-000000000001');
  set constraints public.claims_require_source immediate;
end;
$$;

select pg_temp.login('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  'select pg_temp.confirmed_claim_without_source()',
  '23514', 'a confirmed or reported claim needs at least one source',
  'a confirmed claim without a source is rejected'
);
select lives_ok(
  'select pg_temp.reported_claim_with_source()',
  'a reported claim with a source is accepted'
);
select lives_ok(
  $$insert into public.claims (id, opportunity_id, text, certainty, created_by)
    values ('c1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001',
            'People say it will be huge', 'rumor', 'e0000000-0000-4000-8000-000000000001')$$,
  'a rumor can be recorded without sources'
);
select throws_ok(
  $$update public.claims set verified_at = now(), verified_by = 'e0000000-0000-4000-8000-000000000001'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'an author cannot verify their own claim'
);
select lives_ok(
  $$update public.claims set created_by = 'e0000000-0000-4000-8000-000000000002'
     where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'an update that tries to change the author runs'
);
select pg_temp.logout();
select is(
  (select created_by from public.claims where id = 'c1000000-0000-4000-8000-000000000001'),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  '... but the author never changes'
);

-- Scripts and approvals ------------------------------------------------------
select pg_temp.login('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.scripts (opportunity_id, status, created_by)
    values ('0a000000-0000-4000-8000-000000000001', 'approved', 'e0000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'a script cannot be created as approved'
);
select lives_ok(
  $$insert into public.scripts (id, opportunity_id, created_by)
    values ('5c000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000001')$$,
  'an editor creates a draft script'
);
select throws_ok(
  $$update public.scripts set status = 'approved' where id = '5c000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an editor cannot mark a script approved directly'
);
select throws_ok(
  $$insert into public.approvals (target_type, target_id, decision)
    values ('script', '5c000000-0000-4000-8000-000000000001', 'approved')$$,
  '23514', 'only scripts in review can be decided',
  'a draft cannot be approved'
);
select lives_ok(
  $$update public.scripts set status = 'in_review' where id = '5c000000-0000-4000-8000-000000000001'$$,
  'the author sends the script to review'
);
select throws_ok(
  $$insert into public.approvals (target_type, target_id, decision)
    values ('script', '5c000000-0000-4000-8000-000000000001', 'approved')$$,
  '23514', 'authors cannot review their own script',
  'the author cannot approve their own script'
);
select pg_temp.logout();

select pg_temp.login('e0000000-0000-4000-8000-000000000002');
select lives_ok(
  $$insert into public.approvals (target_type, target_id, decision)
    values ('script', '5c000000-0000-4000-8000-000000000001', 'approved')$$,
  'another editor approves the script'
);
select pg_temp.logout();

select is(
  (select status::text from public.scripts where id = '5c000000-0000-4000-8000-000000000001'),
  'approved',
  'the approval sets the script status'
);
select throws_ok(
  $$update public.approvals set decision = 'rejected'$$,
  '42501', 'approvals are append-only',
  'approvals cannot be changed, even by the service role'
);

-- Calendar and LLM usage -----------------------------------------------------
select throws_ok(
  $$insert into public.schedule_rules (channel_id, timezone)
    values ('00000000-0000-4000-8000-000000000001', 'Mars/Olympus')$$,
  '23514', null,
  'a schedule rule needs a valid IANA time zone'
);

select pg_temp.login('e0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.schedule_rules (channel_id) values ('00000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'editors cannot change the calendar rules (admin only)'
);
select pg_temp.logout();

insert into public.llm_usage (provider, model, purpose, input_tokens, output_tokens, cost_eur)
values ('fake', 'fake-1', 'script.generate', 10, 20, 0);
select pg_temp.login('e0000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.llm_usage), 0, 'editors do not see LLM usage');
select pg_temp.logout();

select * from finish();
rollback;
