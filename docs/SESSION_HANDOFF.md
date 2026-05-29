# ENSO CRM — Session Handoff

_Last updated: 2026-05-29_

Transient working state for cross-session continuity. **Durable knowledge**
(architecture, data model, decisions, reusable patterns) lives in `content/docs/`
(Fumadocs). This file = what's live now, operating playbook, what's pending.
Re-verify live IDs against the deployed APIs — they were accurate at handoff.

---

## 1. What ENSO CRM is

In-house operational CRM for a Moldovan/Romanian real-estate group. **Fork of
Twenty CRM**, on **Railway**, production from day 1 (no staging). Replaces
Attio + Customer.io + Respond.io + most n8n. Analytical half
(BigQuery/dbt/Lightdash/PostHog/Fivetran) stays as-is. Backend customizations
under `packages/twenty-server/src/modules/enso/`.

---

## 2. Live infrastructure

**CRM** — Railway project `enso-crm` (`c3d0b708-0ee9-484f-8fb8-bfe8a50eb7cf`)
- Server: `https://twenty-server-production-2502.up.railway.app`
- Services: `twenty-server`, `twenty-worker`, Postgres, Redis. `twenty-server`
  needs `PORT=3000`. Build = last `twenty` stage of the docker Dockerfile.
- **Push to `main` = auto-deploy** (~7–10 min build+boot; healthz returns 200
  mid-boot, so verify via logs/behavior, not just health). Postgres persists.
- ⚠️ Each push to `main` needs explicit user approval (classifier blocks it).
- ⚠️ **`twenty-worker` runs background jobs (BullMQ) — it MUST run our fork.**
  It was previously misconfigured to deploy the upstream image
  `twentycrm/twenty:latest` (no fork code), so it silently ran vanilla Twenty
  against our DB and never executed any custom worker job. Fixed this session via
  Railway API (`serviceConnect` + `serviceInstanceUpdate`): source →
  repo `corporateready/enso-crm` @ `main`, `dockerfilePath`
  `packages/twenty-docker/twenty/Dockerfile`, `startCommand` `yarn worker:prod`.
  It now builds our code and auto-deploys on push, same as the server. Any future
  feature with a worker job (jobs, crons, queues) depends on this. Verify both
  services rebuild after a push (worker service id `13ee43eb-…`).

**n8n intake** — Railway project `enso-intake` (`5ac534a3-d231-4394-b349-c42c69af4c53`)
- n8n: `https://n8n-production-d2a9.up.railway.app` (v2.22.5, Docker image) + own Postgres.
- Volume-less (Postgres holds state; mounted volume crashes on perms). `PORT=5678` set.
- Full setup + workflow design: `content/docs/integrations/form-intake.md`.

**n8n legacy (Elestio)** — `https://n8n-svgqc-u17606.vm.elestio.app` — 33 workflows
(READ-only reference; the live Attio intake).

### Operating playbook (secrets in repo `/.env`, gitignored; `set -a && source .env && set +a`)
- CRM data GraphQL: `POST $TWENTY_BASE_URL/graphql` · metadata: `/metadata` ·
  `Authorization: Bearer $TWENTY_API_KEY`. Introspection OFF in prod.
  ⚠️ Data queries **return soft-deleted rows** unless you filter
  `deletedAt: { is: NULL }`.
- n8n REST: `X-N8N-API-KEY` header. `N8N_ELESTIO_*` (read), `N8N_RAILWAY_*` (write).
- Railway CLI authed (`railway` works; the MCP token expired — use CLI).
- Dev env (this worktree): no node_modules by default; `corepack enable` for yarn;
  `node_modules/.bin/nx` runs from the worktree after install. `oxfmt` 0.52 (npx)
  false-positives vs pinned 0.50 — trust `nx typecheck` + style-parity with
  existing enso files.

---

## 3. What's live in the CRM (this session's work)

Durable detail in `content/docs/`; summary + IDs here.

**Custom objects (all junctions use the composite-name + (optional) mirror-write
pattern — see `content/docs/systems/junction-composite-name-pattern.md`):**
- `personRelationship` (`4e04662f-…`) — person↔person "Family" links; composite
  name + **mirror-write** (auto-reciprocal, inverse type CHILD↔PARENT). Has a
  hidden `mirrorOf` self-relation (loop guard). Verified live.
- `personProjectConsent` (`40c511fa-…`) — per-project marketing consent + audit
  (sparse, default-deny). Composite name.
- `inboundActivity` (`cef40992-…`) — inbound-event CDP (41 fields), attribution-
  native; composite name `"{Kind} · {who} · {project} · {ts}"`. Written to by
  the n8n form-intake workflow.
- `personProjectAssignment` (`3f107ab7-…`) — sticky manager routing (prior session).

**Person additions:** `dateOfBirth`; `doNotContact` + `doNotContactSetAt` +
`doNotContactReason` (per-channel marketing consent fields were removed — consent
now lives on `personProjectConsent`). Person↔Family card relabeled.

**Opportunity:** fully built — `stage` (incl. `ROUTING`), `pipelineState`,
`dealType`, `m2Min/m2Max/m2Final`, `lostReason`→SELECT, `routingCount`, `source`,
`firstContact*`, frozen UTM set + `firstTrafficType`/`firstLandingPage`,
`roistatVisitId`, `relatedOpportunity`, `owner`→workspaceMember, `project`,
`pointOfContact`, `inboundActivities` relation. (The earlier "deal fields not yet
added" note was stale — verified live this session.)

**workspaceMember additions (this session, via metadata API):**
`isAvailableForRouting` (BOOLEAN, default false — the routing opt-in pool) +
`lastAssignedAt` (DATE_TIME — round-robin fairness). ⚠️ No viewFields yet — not
visible/editable in the UI; add viewFields so admins can toggle availability.

**Lead pipeline (this session) — LIVE & smoke-tested end-to-end.** `inboundActivity`
→ Opportunity → routing. Code under `src/modules/enso/lead-pipeline/`. A POST hook
on `inboundActivity.createOne` enqueues a decomposed BullMQ pipeline on the new
`ensoLeadPipelineQueue`: **resolve** (dedup person×project over OPEN deals, no
time window → attach or create deal at stage ROUTING with a frozen first-touch
attribution snapshot + m2Min/Max from m2Requested; `firstContact*` left NULL) →
**route** (honor active sticky `personProjectAssignment`, else round-robin over
`isAvailableForRouting` members ordered by `lastAssignedAt`→active-client-count→
random; set owner, bump lastAssignedAt; open a 3-min claim window) → **notify**
(Google Chat, best-effort, env-gated). A delayed **claim-check** job reroutes on
no-claim and escalates (`pipelineState=STALLED` + ops alert) at 5 attempts; it
no-ops once claimed. `opportunity.updateOne` POST hook writes the sticky
assignment **on claim only**. Server hooks live in `LeadPipelineModule`
(WorkspaceQueryHookModule); the four jobs live in `LeadPipelineJobsModule`
(imported by `JobsModule` — the worker's graph, NOT the query-hook graph).
Smoke test passed: create, dedup (3 activities→1 deal), routing, claim→sticky,
claim-check no-op, reroute, escalation→STALLED. All test records cleaned up.

**Routing v2 (this session) — LIVE & smoke-tested.** New object
**`projectRoutingMember`** (`5a9b13c3-…`): manager × project routing pool
(relations `project`/`manager`, `isActive`, composite name, viewFields, inverse
"Routing Team" card on Project). Routing now: candidate pool = `isAvailableForRouting`
**AND** in the deal's `projectRoutingMember` pool; **sticky → auto-claim**
(LEAD_CLAIMED immediately, even if offline); **never hard-stops** — reroutes
forever, parks when the pool is offline and resumes when someone returns; one-time
admin heads-up after 5 unclaimed reroutes (no more STALLED hard stop). Frontend:
always-visible **"Accepting leads"** presence toggle in the nav
(`RoutingPresenceSection`) flipping the current member's `isAvailableForRouting`.
Verified: project-pool routing, project-pool park, sticky auto-claim, park→resume.
Admin assigns the pool via the Project's "Routing Team" card / Routing Members table.

**project records (data):** ARTIMA `4b63d540` ENS2301 · IOANA RADU `d8f29e3b`
ENS1901 (renamed from Newton House) · TRIUMF BOTANICA `1af69943` ENS2101 (was
AVENEW; PostHog name "SARMIZEGETUSA") · AVRAM IANCU `52d75b8d` ENS2402 · ENSO
LIVING `c2fc149f` ENS2501 · ENSO ESTATE `2b0b2f11` ENS2502 (new) · ENSO
Development `82e62d0d` ENS00 (new, umbrella enso.ro) · Vanzari Imobiliare
`153c97f9` ENSVI (general/fallback intake).

Other object IDs: person `1103d2af-…`, company `adf37f19-…`, opportunity `a71b2bcb-…`.

⚠️ **viewField convention:** new fields don't auto-appear in views. When creating
a field, also `createViewField` (visible) on the object's INDEX TABLE + FIELDS_WIDGET
views. Don't touch curated/custom views. Internal fields (`mirrorOf`) stay hidden.

---

## 4. Live n8n form-intake (NOT in git — lives in the Railway n8n)

Workflow **`Form Intake → CRM`** (id `c6tgJmzSkxtsXTwb`), active.
- Webhook: `POST /webhook/form-intake`, header-auth `x-intake-secret`.
  Secret value is in n8n's encrypted "Form Intake Secret" credential
  (`uEHDLwzoKrA4F1De`); also recorded at `/tmp/n8n-export/intake-secret.txt` this
  session (regenerate/rotate as needed).
- CRM auth: n8n encrypted "Twenty CRM API" credential (`NYM0XzeLNTCwTydL`),
  Header Auth Bearer, scoped to the CRM domain.
- Does: PostHog form payload → resolve project (host/path/redirect/Vanzari) →
  E.164 phone (length-based MD/RO) → dedup Person (phone-or-email, enrich-on-match)
  → create `inboundActivity` (full attribution, synthetic flagging).
- Edit via n8n REST API (GET/PUT `/api/v1/workflows/c6tgJmzSkxtsXTwb`). Mapping +
  phone rules live in the **Resolve** Code node.
- Verified end-to-end for ARTIMA / IOANA RADU / ENSO LIVING + dedup + enrich + auth.

---

## 5. Pending / next session

- **PostHog pointing — DONE (dual-send live).** Added "HTTP Webhook → New CRM
  (form-intake)" destination in 5 PostHog projects (ARTIMA 36450, IOANARADU
  128764, SARMIZEGETUSA 126393, ENSO Development 107041, AVENEW Botanica 99901),
  alongside the existing Attio webhooks. `form_submitted` → `…/webhook/form-intake`
  + `x-intake-secret`. Webhook is fast-ack (`onReceived`) to avoid retry-duplicates.
  **Cutover later:** disable the old Attio "HTTP Webhook" destinations once trusted
  (keep for rollback). PostHog creds now in `.env`.
- **Consent — implied/opt-out, DONE at intake.** Form submission (accept
  Terms+Privacy) = consent for email/SMS/WhatsApp/call until unsubscribe. The
  form-intake workflow upserts `personProjectConsent` (3 channels true, source
  FORM_WEBSITE) per person×project on submit. Enforcement: `!doNotContact &&
  consent`. **Opt-out half pending** (email unsubscribe / SMS STOP / manual →
  flip row to false) — build with the senders (Novu/SMS).
- **Error alerting — DONE.** n8n workflow "⚠️ Intake Error Alerts"
  (`OOfJPijdq1s08DQ9`): Error Trigger → Google Chat (ops space). Set as the
  intake workflow's `errorWorkflow`. Catches hard failures AND soft GraphQL
  errors (an "Assert activity" node throws on `.errors`/null). Verified.
  Future: dead-letter/retry queue so failed leads auto-recover.
- **Opportunity creation + routing — DONE this session** (see section 3 + the new
  pipeline). Remaining follow-ups:
  - **Notifications deferred** — set `ENSO_ROUTING_CHAT_WEBHOOK_URL` (Google Chat),
    optionally `ENSO_OPS_CHAT_WEBHOOK_URL` + `ENSO_CRM_APP_URL` (deal deep-links),
    on **both** twenty-server & twenty-worker. Currently best-effort: logs a WARN
    when unset. Then in-app/Knock later.
  - **viewFields** for `workspaceMember.isAvailableForRouting` + `lastAssignedAt`
    so admins can toggle availability in the UI.
  - **Round-robin rotation** across ≥2 managers still not exercised (single-manager
    re-ping path). Re-verify fairness once ≥2 managers are in a project pool and available.
  - **Manager×project eligibility — DONE** (routing v2): `projectRoutingMember`
    pool now filters candidates by project; admins manage it per project.
  - **Dedup race**: 3 concurrent resolve jobs for one person→project correctly
    produced 1 deal in the smoke test, but there's no DB-level guard. If volume
    grows, add a unique partial index / advisory lock on (person, project, open).
  - **`ENSO_CLAIM_WINDOW_MS`** overrides the 3-min claim window (set low to test).
- **Next:** kick the first **sequence / tasks** on claim (deferred this session).
- **Next intake channels:** calls (Roistat/Zadarma), social (Chatwoot), Meta lead
  ads → same pattern into `inboundActivity` → the pipeline routes them for free
  (channel-agnostic; opportunity source derives from activity `kind`).
- **Company / Project field-group passes**; #25 "My People" filter; #24 row-level
  "edit own only" for Sales Manager.
- **Lead source on Person** — derive from earliest inboundActivity (computed via hook).
- **mirror-write edit-from-mirror** limitation: editing a mirror row doesn't
  propagate to canonical. Not urgent.

---

## 6. Commit history (fork-specific, on `main`)

```
27eb91283e feat(enso): routing v2 — project pools, sticky auto-claim, non-stop reroute, presence toggle
5b7608a289 feat(enso): drop deal-dedup time window (match legacy Attio "ever exists")
4a5c615983 docs: lead pipeline as-built + worker-source fix + handoff refresh
8931bf288c fix(enso): register lead-pipeline jobs in the worker (JobsModule)
c7ed36cd28 fix(enso): derive opportunity source from inboundActivity.kind
69009c1117 feat(enso): inboundActivity → opportunity → routing pipeline
2a23bba61a fix(enso): stamp SYSTEM actor on mirror-write raw insert
678c4fee1d feat(enso): composite name for inboundActivity
28ca8474e7 fix(enso): set position on mirror-write raw insert
fbc105a54d fix(enso): mirror-write reads canonical by id, not from hook payload
728b34d487 docs: split durable knowledge into content/docs, slim SESSION_HANDOFF
ff4b1a53a9 feat(enso): mirror-write for personRelationship (Phase 2)
ea11dcebd0 feat(enso): composite name for personProjectConsent junction
91c4482511 feat(enso): composite name for personRelationship junction
fd2431ff4f fix(person-project-assignment): bypass permissions computing composite name
34825bc22a feat(enso): composite name for personProjectAssignment
0e651454bb build(railway): end Dockerfile at 'twenty' stage for Railway
1ea03c0d9e Add ENSO CRM scope docs + research findings
```

Note: the `inboundActivity` object + the n8n workflow + the project-record
renames were done via **live API**, not git — they won't show in commits.
Metadata/data + n8n state are the source of truth for those. This session also
via API/infra (not git): the two `workspaceMember` routing fields (metadata API)
and the **twenty-worker source repoint** (Railway API — see section 2).
