# Phase 5 — embedded Chatwoot conversation: go-live runbook

_The Phase-5 **code** is built, typechecked, and lint-clean on branch
`claude/adoring-darwin-c13f55` (not yet pushed). This runbook is the set of
**portal/infra steps only you can do** + the verification path. Nothing here is
auto-deployed — push to `main` needs your explicit approval._

## What the code does (already written)

- **`packages/twenty-server/src/modules/enso/chatwoot/`** — a `ChatwootModule`
  (imported by `ModulesModule`) with:
  - `ChatwootClientService` — axios wrapper over Chatwoot's **Application API**
    (account token: agents, conversation assignment, inbox members) and
    **Platform API** (Platform-App token: user create + SSO login mint).
  - `ChatwootAssignmentService` — **on-claim push**: wired into the existing
    `opportunity.updateOne` claim hook. When a deal leaves ROUTING with an
    owner, it finds the linked `inboundActivity.chatwootConversationId`, resolves
    the owner's `workspaceMember.userEmail` → Chatwoot agent, and assigns the
    conversation. **Best-effort, never blocks the claim. Uses the account token —
    no gate.**
  - `ChatwootAgentProvisioningService` — maps managers → Chatwoot agents **by
    email** (D10), idempotent (look up by email, create via Platform API only if
    absent + account/inbox membership). JIT (called by the SSO endpoint) and bulk.
  - `ChatwootSsoService` + `ChatwootController` (`rest/enso/chatwoot`):
    - `POST /rest/enso/chatwoot/sso` `{ opportunityId }` → `{ available, ssoUrl,
      conversationUrl }` (5-min single-use SSO + deep-link). Auth: any logged-in
      member (`NoPermissionGuard`).
    - `POST /rest/enso/chatwoot/provision-agents` → bulk-provision all
      routing-eligible members (admin: `WORKSPACE_MEMBERS` permission).
- **`twenty-front` `ChatwootConversationEmbed`** — the iframe tab. `IframeWidget`
  delegates to it when a widget's `configuration.url` carries the marker
  `__enso_chatwoot_conversation`. It POSTs the SSO endpoint with the record id,
  loads `ssoUrl` (establishes the same-site session), then deep-links to the
  conversation (two-step, D6). No record-level conversation → graceful empty state.

## Gate 1 — Chatwoot Platform-App token ✅ DONE (2026-06-03)

Platform App **`enso-crm`** created on chat.enso.ro (via Rails console:
`PlatformApp.create!(name: 'enso-crm').access_token.token`) and its token **set as
`CHATWOOT_PLATFORM_TOKEN` on twenty-server** (`--skip-deploys`). Verified valid: a
bogus token → `{"error":"Invalid access_token"}`; this token → `{"error":"Non
permissible resource"}` on `/platform/api/v1/users/1` = **authenticated** (it just
can't touch resources it didn't create — expected).

⚠️ **Platform App authorization model (important for SSO):** a Platform App can
only act on **users it created**. So:
- **Provisioned managers** (created via `POST /platform/api/v1/users` by our
  `ChatwootAgentProvisioningService`) are owned by the app → SSO mint
  (`/users/{id}/login`) works.
- **Pre-existing agents** created outside the app (e.g. user 1 / Denis, the
  super-admin) are **not** owned → SSO mint returns "Non permissible resource".
  Such managers must be (re)provisioned through the app, or SSO won't mint for
  them. `ensureAgentForMember` currently reuses an existing agent by email; if
  that agent is non-app-owned, expect SSO to fail for them until provisioned via
  the app. (The on-claim **assignment** push is unaffected — it uses the
  Application API / account token, which works for any agent.)

## Gate 2 — `crm.enso.ro` custom domain (Railway dashboard + DNS)

The embedded session cookie is `SameSite=Lax`, so the iframe only works when the
CRM and Chatwoot are **same-site** (D8): `crm.enso.ro` ⊂ `enso.ro` ⊃
`chat.enso.ro`. Today the CRM is on `*.up.railway.app` — the iframe will not log
in until this is done.

1. Railway → project **`enso-crm`** → **twenty-server** → **Settings → Networking
   → Custom Domain** → add `crm.enso.ro` (target port **3000**). _(CLI token isn't
   scoped for custom-domain creation — use the dashboard.)_
2. Add the Railway-provided **CNAME** at the `enso.ro` DNS host.
3. On the **Chatwoot** service (`enso-chatwoot` → `chatwoot-web`) confirm
   `ENSO_FRAME_ANCESTORS=https://crm.enso.ro` (PATCH 2 reads it for the
   `frame-ancestors` CSP — it was set in the Phase-1 deploy; re-verify):
   ```
   curl -sI https://chat.enso.ro | grep -i 'content-security-policy\|x-frame'
   # expect: content-security-policy: frame-ancestors 'self' https://crm.enso.ro
   #         (and NO x-frame-options)
   ```
4. Point the CRM frontend at the new origin so the SSO `fetch` and ActionCable
   target match: set **`REACT_APP_SERVER_BASE_URL`/`SERVER_URL`/`FRONTEND_URL`**
   (whatever the deploy uses) to `https://crm.enso.ro`, and access the CRM there.

## Gate 3 — CRM server env ✅ DONE (2026-06-03)

All four set on **twenty-server** (production, `--skip-deploys` — they take effect
on the next deploy, i.e. when Phase 5 is pushed):

```
CHATWOOT_BASE_URL=https://chat.enso.ro          ✅ set
CHATWOOT_ACCOUNT_ID=1                            ✅ set
CHATWOOT_API_TOKEN=<account agent token>         ✅ set (stdin)
CHATWOOT_PLATFORM_TOKEN=<platform token>         ✅ set (stdin) — enables SSO + provisioning
# optional, defaults to CHATWOOT_BASE_URL:
# CHATWOOT_FRONTEND_URL=https://chat.enso.ro
```

Not yet mirrored on **twenty-worker** (not needed — the on-claim push + SSO run in
twenty-server; add later only if a worker job needs Chatwoot). Without
`CHATWOOT_PLATFORM_TOKEN` the on-claim push still works (account token); only SSO +
provisioning need it.

## Step 4 — add the "Conversation" tab to the live Opportunity layout

The standard page-layout **seed config can't carry an iframe URL** (the config
type has no `configuration` field), so the tab is created on the live workspace
via the page-layout REST API — like the other live customizations. The live
Opportunity record layout id is **`5d5457be-d9a2-4d4d-b222-3d2b7fa40d9f`**.

Run after deploy (needs a **user** JWT, not the API key — the page-layout write
endpoints require it; grab a bearer from the browser session, or run while logged
in). The marker URL must be a valid https URL (widget config validates `@IsUrl`):

```bash
LAYOUT=5d5457be-d9a2-4d4d-b222-3d2b7fa40d9f
BASE=https://crm.enso.ro            # after Gate 2
JWT=<user access token>

# 1) create the tab
TAB=$(curl -s -X POST "$BASE/rest/metadata/pageLayoutTabs" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Conversation\",\"pageLayoutId\":\"$LAYOUT\",\"position\":35,\"layoutMode\":\"GRID\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "tab=$TAB"

# 2) add a full-width IFRAME widget carrying the marker
curl -s -X POST "$BASE/rest/metadata/pageLayoutWidgets" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"pageLayoutTabId\":\"$TAB\",\"title\":\"Conversation\",\"type\":\"IFRAME\",
       \"gridPosition\":{\"row\":0,\"column\":0,\"rowSpan\":12,\"columnSpan\":12},
       \"configuration\":{\"configurationType\":\"IFRAME\",\"url\":\"https://crm.enso.ro/__enso_chatwoot_conversation\"}}"
```

## Step 5 — provision agents

```bash
curl -s -X POST https://crm.enso.ro/rest/enso/chatwoot/provision-agents \
  -H "Authorization: Bearer $JWT"
# → { results: [{ email, agentId, status }] }
```

(Or skip — the SSO endpoint provisions JIT on first open.)

## Step 6 — verify end-to-end

1. **On-claim push** (no gates): claim a social deal that has a
   `chatwootConversationId` → the Chatwoot conversation shows assigned to that
   manager. Check `twenty-server` logs for `Assigned Chatwoot conversation …`.
2. **Embed**: open that Opportunity at `https://crm.enso.ro` → **Conversation**
   tab → the conversation loads (login round-trip then deep-link). If it shows the
   empty state, the deal has no `chatwootConversationId`; if it stays on the login
   screen, re-check Gate 2 (cookie/CSP/WS origin).

## Known checks / caveats

- **Conversation id = display_id.** The dashboard URL and the assignment API both
  use Chatwoot's per-account `display_id`. Confirm `inboundActivity.chatwootConversationId`
  holds the **display_id** (what the `conversation_created` webhook's `id` carries),
  not the global conversation id — otherwise both the deep-link and the assignment
  target the wrong/none. Quick check: open a known conversation in Chatwoot, note
  the number in the URL, compare to the stored value.
- The SSO token is **single-use, 5-min** — the embed mints fresh on every tab open
  (never cached).
- App Review is **deferred** (test-app only; tester DMs deliver today). Public DMs
  still need `pages_messaging` + `instagram_business_manage_messages` Advanced
  Access — submit later.
