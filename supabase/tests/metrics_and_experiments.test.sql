begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('e9000000-0000-4000-8000-000000000001', 'analyst-metrics@example.test', 'authenticated', 'authenticated'),
  ('e9000000-0000-4000-8000-000000000002', 'editor-metrics@example.test', 'authenticated', 'authenticated');
insert into public.user_roles (user_id, role) values
  ('e9000000-0000-4000-8000-000000000001', 'analyst'),
  ('e9000000-0000-4000-8000-000000000002', 'editor');

insert into public.channels (id, platform, display_name, mode) values
  ('c9000000-0000-4000-8000-000000000001', 'instagram', 'IG metrics', 'manual'),
  ('c9000000-0000-4000-8000-000000000002', 'tiktok', 'TikTok metrics', 'manual');
insert into public.publications (id, channel_id, idempotency_key, status, external_id, published_at) values
  ('9b000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'pgtap-metrics-1',
   'succeeded', 'manual:1', now() - interval '2 days'),
  ('9b000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'pgtap-metrics-2',
   'queued', null, null),
  ('9b000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000002', 'pgtap-metrics-3',
   'succeeded', 'manual:3', now() - interval '2 days');

create function pg_temp.login(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

-- Manual metrics
select pg_temp.login('e9000000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '24h', '{"views": 10}')$$,
  '42501', null, 'an editor cannot record metrics'
);
select throws_ok(
  $$insert into public.metric_snapshots (publication_id, platform, time_window, source, views)
    values ('9b000000-0000-4000-8000-000000000001', 'instagram', '24h', 'manual', 1)$$,
  '42501', null, 'members cannot write snapshots directly'
);

select pg_temp.login('e9000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '24h', '{"followers": 10}')$$,
  '23514', null, 'unknown metric names are refused'
);
select throws_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '24h', '{"views": -1}')$$,
  '23514', null, 'negative counts are refused'
);
select throws_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '7d', '{"views": 10}')$$,
  '23514', null, 'a window that has not ended is refused'
);
select throws_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000002', '1h', '{"views": 10}')$$,
  'P0002', null, 'a publication that is not published is refused'
);
select lives_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '24h',
      '{"views": 120, "likes": 7, "saves": null}')$$,
  'an analyst records metrics by hand'
);
select results_eq(
  $$select platform::text, source::text, views, likes, saves, raw_metric_names
      from public.metric_snapshots where publication_id = '9b000000-0000-4000-8000-000000000001'$$,
  $$values ('instagram', 'manual', 120::bigint, 7::bigint, null::bigint, array['likes', 'views'])$$,
  'the platform comes from the channel, unknown stays null'
);
select lives_ok(
  $$select public.record_manual_metrics('9b000000-0000-4000-8000-000000000001', '24h', '{"views": 130}')$$,
  'a second entry for the same window corrects it'
);
select is(
  (select count(*)::int from public.metric_snapshots where publication_id = '9b000000-0000-4000-8000-000000000001'),
  1, 'still one snapshot per publication and window'
);

reset role;
select throws_ok(
  $$update public.metric_snapshots set source = 'platform_api', views = 1
     where publication_id = '9b000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an automatic read never overwrites a manual snapshot'
);

-- Experiments
insert into public.experiments (id, name, hypothesis, variable, platform, control_label, variant_label, created_by)
values ('ea000000-0000-4000-8000-000000000001', 'Hook test', 'A question hook keeps more viewers.',
        'hook', 'instagram', 'Statement', 'Question', 'e9000000-0000-4000-8000-000000000001');

select pg_temp.login('e9000000-0000-4000-8000-000000000002');
select throws_ok(
  $$insert into public.experiment_publications (experiment_id, publication_id, arm)
    values ('ea000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'control')$$,
  '42501', null, 'an editor cannot assign publications to experiments'
);

select pg_temp.login('e9000000-0000-4000-8000-000000000001');
select throws_ok(
  $$insert into public.experiment_publications (experiment_id, publication_id, arm)
    values ('ea000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000003', 'variant')$$,
  '23514', null, 'a publication from another platform cannot join the experiment'
);
select lives_ok(
  $$insert into public.experiment_publications (experiment_id, publication_id, arm)
    values ('ea000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'control')$$,
  'an analyst assigns a publication of the same platform'
);

select * from finish();
rollback;
