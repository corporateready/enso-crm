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

Phases 0–3 + stage-2 are **live + verified**. **Phase 5 (embedded conversation) is
CODE COMPLETE** on this branch (`claude/adoring-darwin-c13f55`, **not pushed** —
push to `main` needs approval). It's typecheck + lint clean. Pick up by running the
**go-live runbook `docs/PHASE5_GATES.md`**: do the 2 portal gates (Platform-App
token + `crm.enso.ro` domain), set `CHATWOOT_PLATFORM_TOKEN`, push to deploy, add
the Conversation tab via the page-layout API, then verify on-claim push + the embed.

## Remaining work

- **Phase 5 go-live (gates only — code done):** see `docs/PHASE5_GATES.md`.
  (1) **Platform-App token** in Chatwoot super-admin (Platform API 401s with the
  account token — confirmed). (2) **`crm.enso.ro`** custom domain on twenty-server
  + DNS (same-parent cookie, D8; `ENSO_FRAME_ANCESTORS=https://crm.enso.ro` on the
  Chatwoot service). (3) env `CHATWOOT_PLATFORM_TOKEN` (+ confirm
  `CHATWOOT_BASE_URL`/`ACCOUNT_ID`/`API_TOKEN` on twenty-server). The **on-claim
  push** works without (1)/(2). Verify `chatwootConversationId` = Chatwoot
  **display_id**. Built: `packages/twenty-server/src/modules/enso/chatwoot/` +
  `ChatwootConversationEmbed` (front).
- **App Review (deferred):** `pages_messaging` + `instagram_business_manage_messages`
  need **Advanced Access** for **public** DMs. Test-app/tester DMs deliver today.
  Submit later (screencast connect→receive→reply); BM verified, no wait.
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
