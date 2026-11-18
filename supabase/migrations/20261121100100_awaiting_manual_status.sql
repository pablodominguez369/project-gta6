-- Phase 4 (T30): manual channels. The worker runs every gate (pauses, rights, frequency) and then
-- leaves the publication waiting for a person to upload it by hand. Separate file because a new
-- enum value cannot be used in the transaction that adds it.

alter type public.publication_status add value if not exists 'awaiting_manual' after 'blocked';
