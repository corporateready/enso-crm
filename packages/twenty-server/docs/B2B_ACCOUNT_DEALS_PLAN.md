# B2B account deals — implementation plan

Status: in progress (2026-06-08). Builds on the company auto-creation + enrichment
+ merge feature (PR #53/#54). Gated behind `ENSO_COMPANY_AUTOMATION_ENABLED`.

## Goal
Treat a B2B opportunity as an **account deal**: one open deal per (company ×
project), with multiple contacts attaching to it, durable account ownership, and
a rich, consent-style timeline for every automated/manual action.

B2C (80–95% of leads) is **unchanged** — all B2B logic is a branch keyed on the
contact having a linked company (work email).

## Building blocks

### Data model
- **Opportunity.`dealType`** — SELECT `B2B` / `B2C`. Derived at resolution from
  whether the point-of-contact has a `companyId`. (custom field)
- **Opportunity.`companyId`** — set for B2B deals (already exists on the entity).
- **`opportunityContact`** (new custom object) — junction Opportunity ↔ Person,
  `isPrimary` (+ optional `role`). The existing `pointOfContact` = primary; others
  attach here. Mirrors the person-relationship junction pattern.
- **`companyProjectAssignment`** (new custom object, **B2B-only**) — durable
  `(company × project) → accountOwner (workspaceMember)`, `createdByActivity`,
  timestamps. The account-memory that survives closed deals. Mirrors
  `personProjectAssignment`.

### Dedup change (lead-pipeline `OpportunityResolutionService`)
Current: open deal for `pointOfContactId × projectId` (non-closed).
New branch: resolve person → `companyId`; if present (B2B) dedup by
`companyId × projectId` (non-closed); else (B2C) keep current.
- Attach → add `opportunityContact` (non-primary) for the new person + timeline.
- Create (first B2B deal) → set `companyId` + `dealType=B2B`, primary contact,
  write `companyProjectAssignment` on claim + timeline.
- One open deal per (company × project) — manual split allowed later. Forward
  dedup only (no retroactive opportunity merge).

### Post-close stickiness (Phase 3)
No open deal on a new B2B inbound → consult `companyProjectAssignment` → route to
the account owner (sticky), same mechanism as person-level sticky claim.

## Timeline (first-class requirement — consent-style)
Every event records, never as a generic "System/Twenty" author:
- **Actor**: `workspaceMemberId` (human → "by {member}") OR `auto:true`
  (pipeline → "automatically").
- **Reason**: `properties.reason` human string ("same company + project open deal",
  "work-email domain acme.com", "matched on VAT RO123").
- **Cause/linked record**: `linkedObjectMetadataId` + `linkedRecordId` +
  `linkedRecordCachedName` → clickable, like consent rows.
- Targets: person / company / opportunity as applicable (one row per target).

Infra: a reusable `enso-event.*` timeline helper (backend) + a single generic
`EventRowEnsoEvent` renderer (frontend) driven by a name→verb registry +
`reason`/`auto`/linked-record. Mirrors `EventRowEnsoConsent`.

Event catalog:
| action (`enso-event.<action>`) | targets | reads as |
|---|---|---|
| company-linked | person, company | "Linked to **Acme** · work-email acme.com — automatically" |
| activity-logged | person, company | "**Call** from **Bob** · ARTIMA — automatically" |
| deal-activity-attached | opportunity, company, person | "**Bob's inquiry** added to **Acme · ARTIMA** · same company+project open deal — automatically" |
| deal-created | opportunity, company | "Deal **Acme · ARTIMA** opened — automatically" |
| deal-contact-added | opportunity, person | "**Bob** added as contact (non-primary) — automatically" |
| account-assigned | company | "**Ion** set as account owner for **Acme · ARTIMA** — by Ion" |

(Existing `enso-record.merged` row already carries matched-on + by/automatically.)

## Build order
1. **Timeline infra** (backend helper + generic frontend row) + first event
   (`company-linked` from CompanyFromPersonService). Code-only. ← starting here
2. **`dealType` field** + derive on opportunity create + set `companyId` for B2B +
   `deal-created`/`activity-logged` events. (field provision + worker redeploy)
3. **company×project dedup** + **`opportunityContact`** object + multi-contact +
   `deal-activity-attached`/`deal-contact-added` events.
4. **`companyProjectAssignment`** object + write-on-claim + `account-assigned`
   event; then post-close sticky routing.

## Gotchas (carried from the enrichment feature)
- New custom field/object → **redeploy twenty-worker** so its ORM metadata cache
  picks it up (else writes to the new field/object are silently dropped).
- New fields land in the record-page **System** group → regroup via the view API.
- No GitHub Actions CI — verify via Railway build/boot + synthetic test.
- Custom OBJECT creation: prefer Settings UI or metadata API (createOne object +
  RELATION fields via relationCreationPayload); confirm syntax at build time.
