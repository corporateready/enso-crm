# ENSO CRM — Session Handoff

_Last updated: 2026-05-27_

This is the working handoff for continuing development across sessions. It captures the
**live state**, the **operating playbook** (how to talk to the deployed instance), key
**gotchas**, and **what's next**. The next session should re-verify live state by querying
the deployed API — IDs below were accurate at handoff time.

---

## 1. What ENSO CRM is

In-house operational CRM for a Moldovan/Romanian real-estate group (brands: ENSO, ARTIMA,
NEWTON HOUSE, AVRAM IANCU, ENSO LIVING, AVENEW BOTANICA, Vanzari Imobiliare). It is a
**fork of Twenty CRM**, deployed on **Railway**, **production from day 1 (no staging)**,
internal-use only. It replaces Attio + Customer.io + Respond.io + most n8n. The analytical
half (`modern-data-stack`: BigQuery/dbt/Lightdash/PostHog/Fivetran) stays as-is.

Full scope/architecture lives in `content/docs/` (Fumadocs-viewable). Research on the old
stack is in `docs/*.md` (attio_current, n8n_*, data_sample_findings, integrations_api_summary).

---

## 2. Live infrastructure (Railway)

- **Railway project:** `enso-crm` (id `c3d0b708-0ee9-484f-8fb8-bfe8a50eb7cf`)
- **Server URL:** `https://twenty-server-production-2502.up.railway.app`
- **Services:** `twenty-server`, `twenty-worker`, Postgres, Redis
  - `twenty-worker` start command overridden to `yarn worker:prod` (RAILWAY_RUN_COMMAND)
  - `twenty-server` needs `PORT=3000` env var (else Railway 502s)
- **Build:** GitHub-connected source build from `corporateready/enso-crm`, branch `main`.
  Railway builds the **last stage** of `packages/twenty-docker/twenty/Dockerfile`, which we
  truncated to end at the `twenty` stage (Railway rejects `VOLUME`, present in the original
  trailing `twenty-app-dev` stage). **Push to `main` = auto-deploy.** Builds take ~10–15 min;
  expect transient 502s during rollover.
- **Postgres persists across rebuilds** (separate service) — schema + records survive deploys.
- ⚠️ `twenty-worker` may still run the Docker Hub image, not the fork build — verify/migrate
  if worker-side behavior is needed.

### Operating the deployed API

Secrets are in `/.env` (gitignored). Load with `set -a && source .env && set +a`.
- `TWENTY_BASE_URL`, `TWENTY_API_KEY` (ES256 JWT, ~444 chars, on the **Admin** role)
- Data GraphQL: `POST $TWENTY_BASE_URL/graphql`
- Metadata GraphQL: `POST $TWENTY_BASE_URL/metadata`
- Auth header: `Authorization: Bearer $TWENTY_API_KEY`
- Introspection is **disabled in prod** — you can't `__schema` your way around; query known fields.
- ⚠️ The metadata `objects{ fields }` connection **truncates nested fields** across the full
  result — it under-reports fields. To inventory an object, query the **data** API for the
  records' fields, or fetch one object at a time. Don't trust a thin metadata dump.

---

## 3. Live schema (verified at handoff)

### Standard objects extended
- **opportunity**: `stage` (SELECT, locked-down values incl. `ROUTING`), `pipelineState`
  (SELECT, e.g. `ACTIVE`), `routingCount` (NUMBER), `utmSource` / `utmMedium` / `utmCampaign`
  (TEXT), plus standard `amount` (CURRENCY), `closeDate` (DATE_TIME). Name composite TBD.
- **person**: `facebookLink` (LINKS) custom; field groups configured
  (Contact/Work/Personal — phone in General/Contact, location in Personal). `residenceAddress`
  (renamed from reserved `address`).

### Custom objects
- **project** (CUSTOM): `name` (TEXT, label identifier), `code` (TEXT). 6 seeded rows:
  Vanzari Imobiliare, AVENEW BOTANICA, ARTIMA Business & Lifestyle, ENSO LIVING, NEWTON HOUSE,
  AVRAM IANCU. (Brand concept was dropped — brand ≡ project in production.)
- **personProjectAssignment** (CUSTOM, junction person × project × manager):
  `name` (TEXT, **composite**), `personId`, `projectId`, `managerId` (→ workspaceMember),
  `lastContactAt`, `endedAt`, `endReason` (DATE_TIME/TEXT). It is a real entity (not a field)
  because it carries lifecycle metadata: the **responsible manager per project per person** is
  sticky and routes ALL future inquiries for that (person, project) pair, **outliving deals**.
  After 3 months no contact → assignment expires → falls back to general routing.

### Roles
- **Admin** (API key here), **Member**, **Sales Manager** (canRead/UpdateAll = true,
  no soft-delete; has explicit object permissions on 4 objects).

---

## 4. Custom code in the fork (NestJS)

**Composite-name feature for `personProjectAssignment`** — DONE & verified live.
Junction records had no natural label (showed "Untitled"). Twenty has no formula/lookup field
type and relation cards only show scalar fields, so we materialize `project · manager` into the
scalar `name` on write.

- `src/modules/enso/person-project-assignment/services/person-project-assignment-name.service.ts`
  — `computeName(authContext, record)`; reads project + workspaceMember and joins as
  `"<project.name> · <member firstName lastName>"`.
- Pre-query hooks (`@WorkspaceQueryHook`): `…createOne`, `…createMany`, `…updateOne`
  (update only recomputes when `projectId`/`managerId` changed). All under
  `src/modules/enso/person-project-assignment/query-hooks/`.
- `person-project-assignment-query-hook.module.ts` registers them; it's imported into
  `engine/api/graphql/workspace-query-runner/workspace-query-hook/workspace-query-hook.module.ts`
  (that import is **how hooks get discovered** — don't forget it for future hooks).

**⚠️ Key gotcha — permissions in hooks:** when reading reference data inside a hook, you MUST
use a **system auth context** and bypass permission checks, or callers without read perms on
those objects (API keys, restricted Sales Managers) hit `PERMISSION_DENIED` and the whole
write fails. Pattern (mirrors `BlocklistValidationService`):
```ts
const systemAuthContext = buildSystemAuthContext(workspaceId); // from src/engine/twenty-orm/utils/build-system-auth-context.util
await globalWorkspaceOrmManager.executeInWorkspaceContext(async () => {
  const repo = await globalWorkspaceOrmManager.getRepository<any>(
    workspaceId, 'project', { shouldBypassPermissionChecks: true }); // <-- required
  // ...
}, systemAuthContext);
```
Composite name (`FULL_NAME`) is read as `member.name.firstName` / `.lastName` in the workspace
ORM context (not flat `nameFirstName`).

---

## 5. Twenty constraints worth remembering

- Field types: TEXT, NUMBER, BOOLEAN, DATE_TIME, SELECT, MULTI_SELECT, ADDRESS, LINKS, PHONES,
  EMAILS, RELATION, ACTOR, FULL_NAME, CURRENCY, POSITION, TS_VECTOR, ARRAY, RAW_JSON, UUID.
  **No formula / computed / lookup / rollup type** — derive on write via hooks.
- Record-page relation **cards show scalar fields only** and suppress nested relations; a
  junction's label must be a scalar TEXT field → hence the composite-name approach.
- `address` is a reserved field name → use a different name (we used `residenceAddress`).

---

## 6. Stack decisions (for later phases)

- Notifications: **Novu** (external/prospect-facing) + **Knock** (internal/manager in-app).
- Email: **Resend** (`crm@notifications.enso.ro`) via Novu/Knock SMTP.
- SMS: own providers (NOT Twilio). Jobs: **Trigger.dev**. Glue: **n8n** (self-hosted, prod).
  Inbox: **Chatwoot** (self-hosted). Storage: **Backblaze B2**. Stay within free tiers.
- Form intake flow: PostHog → n8n → Twenty (dedup → person → deal). Dedup logic is critical.
- CPQ + 1C exist but are out of scope (1C = payments/contracts). Customer.io/Respond.io/Zapier retired.

---

## 7. Pending / next session

- **#25 — "My People" view filter** via `projectAssignments.manager` (nested-relation filter
  syntax to work out on the data API / view config).
- **#24 — Row-level "edit only own"** for Sales Manager
  (`upsertRowLevelPermissionPredicates`; operand discovery was hard with introspection off).
- Continue building **objects & fields** per scope (interactions/activities, sequences module,
  contacts primary+additional, lostReason, etc. — see `content/docs/`).
- Possibly migrate `twenty-worker` off the Docker Hub image to the fork build.

### Commit history (fork-specific, on `main`)
```
fd2431ff4f fix(person-project-assignment): bypass permissions when computing composite name
34825bc22a feat(enso): composite name for personProjectAssignment
0e651454bb build(railway): end Dockerfile at 'twenty' stage for Railway
1ea03c0d9e Add ENSO CRM scope docs + research findings
```
