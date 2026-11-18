# Runbook: manual publication

Used for every channel in `manual` mode, and the only path for Instagram in Phase 4
([ADR 0005](../adr/0005-live-publishing-gates.md)).

1. A publisher queues the video in **Publicaciones**, choosing a manual channel.
2. The worker runs the same gates as an automatic upload: global and channel pause, frequency
   limits, render QC, current rights of every asset, the voice and its disclosure. If any fails,
   the publication is blocked or fails as usual and nothing is offered for upload.
3. When everything passes, the publication becomes **Lista para subir a mano**
   (`awaiting_manual`) and the audit log records `publications.manual_package_ready`.
4. Open the package: download the MP4 (link valid for 5 minutes), copy the title and the
   description, and follow the checklist (AI label when the voice is synthetic, private
   visibility unless the owner authorized a public post, no watermarks).
5. After uploading, paste the post's link and press **Marcar como publicada**. Only https links on
   the platform's own domain are accepted. The database function
   `complete_manual_publication` re-checks the role and the status and audits
   `publications.manual_completed` with the person as actor.

A manual publication counts towards the channel's frequency limits like any other.
