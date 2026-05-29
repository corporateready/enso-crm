# ENSO CRM — Session Handoff

_Last updated: 2026-05-29_

This file is the **transient working state** for cross-session continuity. Durable knowledge
(architecture, data model, decisions, reusable patterns) lives in `content/docs/`
(Fumadocs-viewable). When in doubt about *what the system does or why*, go there. This file is
for *what just happened*, *what's broken or pending*, and *operational shortcuts*.

---

## Current state at a glance

**Deployed (production, on `main`):** Fork of Twenty CRM on Railway. Backend customizations
live under `packages/twenty-server/src/modules/enso/`. Push to `main` = auto-deploy.

**Custom objects built and live:**
- `project` (CUSTOM) — 6 seeded rows: Vanzari Imobiliare, AVENEW BOTANICA, ARTIMA, ENSO LIVING,
  NEWTON HOUSE, AVRAM IANCU.
- `personProjectAssignment` (CUSTOM, junction person × project × manager) — sticky routing.
  Composite-name hook deployed.
- `personRelationship` (CUSTOM, junction person × person, labeled **Family** in UI) — family
  graph. Composite-name + mirror-write (Phase 2) deployed.
- `personProjectConsent` (CUSTOM, junction person × project) — per-project marketing consent
  with audit. Composite-name hook deployed.

**Person object additions:**
- `dateOfBirth` (DATE)
- `doNotContact` (BOOLEAN) + `doNotContactSetAt` (DATE_TIME) + `doNotContactReason` (SELECT)
  — global hard-stop with audit.
- `residenceAddress` (ADDRESS, custom; renamed from reserved `address`).
- `currentLocation`, `languages`, `nationality`, `facebookLink` — earlier custom additions.

**Opportunity object additions:**
- `stage` SELECT (with `ROUTING`), `pipelineState` SELECT, `routingCount` NUMBER, full UTM set,
  `lostReason` TEXT, `firstContactChannel` / `firstContactAt`, `project` → project.

For the *why* of all of the above — schema rationale, design tradeoffs, the consent model,
the junction-with-composite-name + mirror-write pattern — see:
- `content/docs/domains/people-and-companies.md` — Person / Family / consent / company
- `content/docs/systems/junction-composite-name-pattern.md` — the reusable hook recipe
- `content/docs/domains/deals.md` — opportunity model
- `content/docs/architecture.md` — overall

---

## Live infrastructure (Railway)

- **Project:** `enso-crm` (id `c3d0b708-0ee9-484f-8fb8-bfe8a50eb7cf`)
- **Server URL:** `https://twenty-server-production-2502.up.railway.app`
- **Services:** `twenty-server`, `twenty-worker`, Postgres, Redis
  - `twenty-worker` start command overridden to `yarn worker:prod` (RAILWAY_RUN_COMMAND)
  - `twenty-server` requires `PORT=3000` env var (else Railway 502s)
- **Build:** GitHub-sourced from `corporateready/enso-crm` `main` → Dockerfile at
  `packages/twenty-docker/twenty/Dockerfile`, **truncated to end at the `twenty` stage**
  (Railway rejects `VOLUME` in the original trailing `twenty-app-dev` stage). Push to `main` =
  auto-deploy, ~7–10 min total. Expect transient 502s during boot rollover (~2 min after
  migrate completes).
- **Postgres persists across rebuilds.** Schema + records survive deploys.
- ⚠️ `twenty-worker` may still run the Docker Hub image, not the fork build. Verify if any
  worker-side behavior matters.

### Operating the deployed API

Secrets in `/.env` (gitignored). Load with `set -a && source .env && set +a`.
- `TWENTY_BASE_URL`, `TWENTY_API_KEY` (ES256 JWT, ~444 chars, on the **Admin** role)
- Data GraphQL: `POST $TWENTY_BASE_URL/graphql`
- Metadata GraphQL: `POST $TWENTY_BASE_URL/metadata` (objects, fields, **views**, viewFields)
- Auth header: `Authorization: Bearer $TWENTY_API_KEY`
- Introspection is **disabled in prod** — query known shapes; do not rely on `__schema`.
- ⚠️ The metadata `objects{ fields }` connection **truncates nested fields** across the full
  result. To inventory an object, fetch it singly via `object(id:"...") { fields(...) }`,
  or query the data API for a record's fields.

---

## Conventions to follow this session (and future sessions)

These are working agreements with the project owner. Don't drop them silently.

1. **When creating a new field, auto-enable it in the relevant views.** Call
   `createViewField` on the object's INDEX TABLE view AND its FIELDS_WIDGET view with
   `isVisible: true, position: <next>`. Do NOT touch non-INDEX table views (custom views are
   the user's to curate). Internal bookkeeping fields (description prefix `Internal:`,
   e.g. `mirrorOf`) should NOT be added to views.
2. **Composite-name + mirror-write pattern** is documented in
   `content/docs/systems/junction-composite-name-pattern.md`. Follow the checklist there for
   any new junction.
3. **System auth context with `shouldBypassPermissionChecks`** for any hook reading reference
   data — otherwise restricted callers (API keys, Sales Managers) hit `PERMISSION_DENIED` and
   the whole write fails.
4. **Don't direct-push to `main` without user approval.** Auto-mode classifier blocks it;
   user must explicitly authorize each push to production.

---

## Dev-env gotchas (this machine)

- Worktree at `.claude/worktrees/strange-wu-6e947d` had no `node_modules` initially; root also
  empty. `yarn` is not on PATH in non-login shells — run `corepack enable` (gives `yarn`
  4.13.0), or invoke `node .yarn/releases/yarn-4.13.0.cjs install`.
- Full `yarn install` needs lots of disk; hit ENOSPC at ~3 GiB free. Clear space first.
- `.nvmrc` wants Node `^24.5.0`; only 24.4.1 was installed → a postinstall guard fails, but
  `nx typecheck`/build still run fine on 24.4.1.
- Pinned `oxfmt@0.50.0` binary may not be installed (postinstall blocked); `npx oxfmt` pulls
  **0.52.0**, which false-positives on the multi-line `implements …` style that 0.50.0 (CI)
  produces. Trust `nx typecheck` + style-identity with committed hook files; don't let local
  0.52 reformat your hooks.

---

## Live IDs reference (quick lookup)

| Object | UUID |
|---|---|
| `person` | `1103d2af-d96a-4ee7-95f3-364f433d2b55` |
| `company` | `adf37f19-46e1-419b-a27d-29ef4f11ae36` |
| `opportunity` | `a71b2bcb-9380-4b84-9f94-b6ddc19b103b` |
| `project` (CUSTOM) | `0b6820aa-9926-437a-b877-047ed916525c` |
| `personProjectAssignment` (CUSTOM) | `3f107ab7-d4bb-48c4-92d2-af9a50641fda` |
| `personRelationship` (CUSTOM) | `4e04662f-88d8-4816-9824-370b2afe4ae2` |
| `personProjectConsent` (CUSTOM) | `40c511fa-1464-4584-a43b-980d816a29a8` |

Sample fixture people for smoke tests (existed at handoff time, may have changed):
- Ivan Zhao — `7a93d1e5-3f74-4945-8a65-d7f996083f72`
- Dario Amodei — `93c72d2e-e65c-44c4-99ad-f87f50349dcf`

Sample project for smoke tests:
- Vanzari Imobiliare — `153c97f9-f274-4453-bffb-73b15e0b299a`

---

## Pending / next session

- **Opportunity (Deal) field-group pass** — organise the record-page layout (similar to what
  was done for Person: Contact / Personal / Work / Social / System with Family / Date of
  Birth / Consent). Plus likely new fields per `content/docs/domains/deals.md`.
- **Company field pass** — same exercise.
- **Project field pass** — likely lightest; project currently has just `name` + `code`.
- **#25 — "My People" view filter** via `projectAssignments.manager` (nested-relation filter
  syntax to work out on the data API / view config).
- **#24 — Row-level "edit only own"** for Sales Manager
  (`upsertRowLevelPermissionPredicates`; operand discovery was hard with introspection off).
- **Lead source on Person** — deferred design. Intent: derived from intake activity + UTM
  trio, exposed as read-only computed via a hook. Revisit when intake flow lands.
- **Phase 2 mirror-write edit-from-mirror** — known limitation: editing a mirror row directly
  doesn't propagate to canonical. Either block mirror edits or re-route them. Not urgent.

---

## Recent commits (fork-specific, on `main`)

```
ff4b1a53a9 feat(enso): mirror-write for personRelationship (Phase 2)
ea11dcebd0 feat(enso): composite name for personProjectConsent junction
4bfbc668a4 docs: handoff update for personRelationship junction + dev-env gotchas
91c4482511 feat(enso): composite name for personRelationship junction
fd2431ff4f fix(person-project-assignment): bypass permissions when computing composite name
34825bc22a feat(enso): composite name for personProjectAssignment
0e651454bb build(railway): end Dockerfile at 'twenty' stage for Railway
1ea03c0d9e Add ENSO CRM scope docs + research findings
```
