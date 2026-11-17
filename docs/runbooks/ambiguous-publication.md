# Runbook: ambiguous publication

A publication is `ambiguous` when the platform call timed out (or reconciliation failed) and we do
not know whether the post exists. The worker retries **only through reconciliation**: each retry
first asks the platform for a post with the same idempotency key. If all automatic attempts are
used up and the state is still unknown, the publication stays `ambiguous` and the worker writes
the audit event `publications.reconciliation_required`. It is never re-dispatched automatically
(rule 7: never risk a duplicate because of an ambiguous result).

In Phase 1 the only platform is the simulator, so this runbook is exercised against
`public.simulated_platform_posts`. Real platforms will add their own lookup step (Phase 4).

## 1. Find the cases

```sql
select p.id, p.idempotency_key, p.error_code, p.updated_at, c.display_name
  from public.publications p join public.channels c on c.id = p.channel_id
 where p.status = 'ambiguous'
 order by p.updated_at;

select created_at, safe_details from public.audit_events
 where action = 'publications.reconciliation_required' order by created_at desc;
```

## 2. Check the platform

Look for the post by its idempotency key (simulator) or in the platform's own UI/API (future
connectors). Never trust memory or a screenshot: record what you checked.

```sql
select external_id, permalink, status, created_at
  from public.simulated_platform_posts
 where idempotency_key = '<idempotency_key>'
 order by created_at;
```

## 3. Resolve

Run these with the service role (SQL editor) and write down who did it and why.

- **The post exists** (use the oldest one if, despite everything, there are several, and delete the
  extras on the platform):

  ```sql
  update public.publications
     set status = 'succeeded', external_id = '<external_id>', permalink = '<permalink>',
         published_at = now(), error_code = null
   where id = '<publication_id>' and status = 'ambiguous';
  ```

- **The post does not exist, or the platform is reachable again and you want the worker to
  decide:** hand it back to the dispatcher. `reconcile_required` stays `true`, so the next attempt
  reconciles before publishing.

  ```sql
  update public.publications
     set status = 'blocked', next_attempt_at = now()
   where id = '<publication_id>' and status = 'ambiguous';
  ```

- **It must not be published any more:**

  ```sql
  -- Record the reason in your ticket; the audit trigger records the change itself.
  update public.publications set status = 'failed'
   where id = '<publication_id>' and status = 'ambiguous';
  ```

Every update is recorded by the `publications_audit` trigger.

## 4. Follow up

If ambiguous cases repeat for one platform, pause that channel ([global-pause.md](global-pause.md))
and investigate timeouts before resuming.
