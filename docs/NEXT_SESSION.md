# Next session — Chatwoot social channel (resume point)

_The Chatwoot social-messaging channel is **built and live end-to-end**. **Read
`content/docs/integrations/social-intake.md` first** (full as-built: infra, fork
patches, Meta setup, inbox map, n8n workflow, stage-2). Then `docs/SESSION_HANDOFF.md`
(live state + operating playbook), and `content/docs/systems/lead-pipeline.md`
(the downstream pipeline this feeds)._

## What's live (built last session)

- **Self-hosted Chatwoot** on Railway (our fork) at **https://chat.enso.ro** —
  project **`enso-chatwoot`** (`6f2f50fd-1f6e-4a45-ad34-a8a5f9141b1b`):
  `chatwoot-web` (`4295ecaa…`) + `chatwoot-worker` (`b6a992fa…`) + Postgres + Redis.
  Built from fork **`corporateready/chatwoot@enso-production`** (v4.14.1 + patches:
  ad-referral capture, X-Frame/CSP for iframe, `.git_sha` build fix, FB-scope fix);
  push to that branch auto-deploys.
- **All 5 brands connected — 10 inboxes** (FB + IG): auto-assign OFF, mapped to
  projects. (map below).
- **n8n "Social Intake → CRM"** (`4cJGl1W55UFDBGTw`, active): Chatwoot
  `conversation_created` webhook → resolve (platform/project/PSID/referral) →
  one `inboundActivity` per conversation (idempotent) → the live pipeline →
  **Opportunity (`SOCIAL_DM`) → routing**. **Verified FB + IG + full pipeline.**
- **Stage-2 Person-merge** (phone/email dedup) — **deployed + verified live**
  (oldest kept, dup soft-deleted, FKs reassigned).

## ⚠️ Immediate next action

Phases 0–3 + stage-2 + **Phase 5 are LIVE + verified end-to-end** (2026-06-04).
The social channel is complete: DM → pipeline → Opportunity → routing → claim →
**conversation assigned in Chatwoot + a NATIVE chat panel in the deal (read +
reply in-CRM, no Chatwoot UI)**. The view is `ChatwootConversationEmbed` (front) +
`ChatwootMessagingService` / `rest/enso/chatwoot/{conversations,messages,reply}`
(server proxies Chatwoot's API, token server-side; 3s poll; replies attributed to
the manager). The iframe/SSO approach was tried then replaced — see
`docs/PHASE5_GATES.md`. Only deliberately-open item: **App Review** for public DMs.

## Remaining work

- **App Review (go-live for PUBLIC DMs — deferred):** `pages_messaging` +
  `instagram_business_manage_messages` need **Advanced Access**. Test-app/tester
  DMs deliver today; public DMs don't until reviewed. Submit (screencast
  connect→receive→reply); BM verified, no business-verification wait.
- **Phase 5 polish (optional):** hide the Conversation tab when a deal has no chat
  (needs a `hasChatwootConversation` field the pipeline sets + a conditional tab —
  today it shows a calm "No conversation linked yet" empty state); true websocket
  push instead of the 3s poll (the agent `pubsub_token` is already available from
  `GET /platform/api/v1/users/{id}` — wire Chatwoot's ActionCable); attachments /
  images in the panel (text-only today); typing/read receipts.
- **Minor (pre-existing):** DB-level dedup guard; consent upsert in n8n; phone/email
  dedup in stage-1 (WhatsApp); CRM triage view for project-less SOCIAL_MESSAGE.
- **Later channels:** WhatsApp (same Meta app → Cloud API/360dialog), Telegram
  (bot token). Pipeline + embed are channel-agnostic.

**Phase 5 as-built + the boot/deep-link lessons: `docs/PHASE5_GATES.md`.**
- **Minor:** DB-level dedup guard (idempotency is currently webhook-side =
  `conversation_created`-only); consent upsert in the n8n flow; phone/email dedup
  in stage-1 (for WhatsApp); a CRM view for project-less (Vanzari-organic)
  `SOCIAL_MESSAGE` activities (triage).
- **Later channels:** WhatsApp (same Meta app → Cloud API, or 360dialog), Telegram
  (bot token). Pipeline is channel-agnostic.

## Inbox → project map (n8n Resolve `INBOX_PROJECT`, by inbox_id)

| inbox | brand | project |
|---|---|---|
| 1 / 2 | Artima FB/IG | ARTIMA `4b63d540-…` |
| 3 / 6 | ENSO Dev Moldova FB/IG | ENSO ESTATE `2b0b2f11-…` |
| 8 / 10 | ENSO Dev România FB/IG | ENSO LIVING `c2fc149f-…` |
| 7 / 9 | Avram Iancu FB/IG | AVRAM IANCU `52d75b8d-…` |
| 4 / 5 | Vânzări Imobiliare FB/IG | **null** (unknown bucket; project set in conversation / by ad `ref.proj`) |

## Operating playbook (additions for Chatwoot)

- **Chatwoot creds in repo `.env`:** `CHATWOOT_BASE_URL=https://chat.enso.ro`,
  `CHATWOOT_ACCOUNT_ID=1`, `CHATWOOT_API_TOKEN` (works). Chatwoot REST:
  `…/api/v1/accounts/1/…` with `api_access_token` header.
- **Meta config lives in Chatwoot super-admin, NOT Railway ENV** —
  `GlobalConfigService` reads the DB `InstallationConfig` first and the seed
  pre-creates blank rows that shadow ENV. Set at
  `/super_admin/app_config?config=facebook` & `?config=instagram`.
- **Meta app:** "ENSO Chatwoot", App ID `1372861104654929`, BM **ENSO Development
  Moldova** (verified). Verify tokens `enso-fb-7a8406d3c5b9b94668e61962` /
  `enso-ig-d6cfc0f5d58aeaf4feb52254`. IG needs the app **Published** to deliver
  webhooks; senders must be app **testers** until App Review.
- **n8n (write):** `N8N_RAILWAY_*`. Social workflow `4cJGl1W55UFDBGTw`; Chatwoot
  account **webhook id 1** → `…/webhook/chatwoot-intake-9a992cbe851c48ac`
  (`conversation_created` only — `message_created` raced → duplicate activities).
- **Railway:** CLI authed (token auto-refresh); GraphQL API works with the CLI
  token + a `User-Agent` header; **GitHub-repo connect + custom-domain creation
  need the dashboard** (CLI token not scoped). Push to `main` = auto-deploy, **needs
  per-push approval**. Always clean up CRM test records.
