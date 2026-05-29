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

**Opportunity:** stage/pipelineState/UTMs/lostReason/etc. (prior). Deal-level
fields (dealType, m2*, relatedOpportunity, closedAt, lostReason→SELECT) NOT yet added.

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
- **Error alerting — DONE.** n8n workflow "⚠️ Intake Error Alerts"
  (`OOfJPijdq1s08DQ9`): Error Trigger → Google Chat (ops space). Set as the
  intake workflow's `errorWorkflow`. Catches hard failures AND soft GraphQL
  errors (an "Assert activity" node throws on `.errors`/null). Verified.
  Future: dead-letter/retry queue so failed leads auto-recover.
- **Next intake channels:** calls (Roistat/Zadarma), social (Chatwoot), Meta lead
  ads → same pattern into `inboundActivity`. Then Opportunity creation + routing.
- **Opportunity deal-level fields** (dealType, m2Min/Max/Final, relatedOpportunity,
  closedAt, lostReason→SELECT) — designed, not built. Attribution belongs on
  `inboundActivity`, not Opportunity (decided).
- **Company / Project field-group passes**; #25 "My People" filter; #24 row-level
  "edit own only" for Sales Manager.
- **Lead source on Person** — derive from earliest inboundActivity (computed via hook).
- **mirror-write edit-from-mirror** limitation: editing a mirror row doesn't
  propagate to canonical. Not urgent.

---

## 6. Commit history (fork-specific, on `main`)

```
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
Metadata/data + n8n state are the source of truth for those.
