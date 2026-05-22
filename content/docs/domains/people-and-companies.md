---
title: People and Companies
description: The customer object model. Phone-keyed, multi-channel, dedup-friendly.
---

# People and Companies

## People — the central object

```text
people
├── id (uuid)
├── phone_e164 (text, unique, indexed)
├── phone_alt (text[]) — additional numbers
├── email_normalized (text, indexed, nullable)
├── email_alt (text[])
├── name_first, name_last, name_display
├── nickname (text, nullable) — social handles
├── language (enum: ro, ru, en)
├── company_id (fk → companies, nullable)
├── residence_country, residence_city
├── current_country, current_city — last-known location
├── birth_country
├── facebook_url, instagram_url, linkedin_url
├── created_at, created_by, updated_at
└── merged_into_id (fk → people, nullable) — soft-delete via merge
```

### Why phone is primary

- 70% of inbound today is phone-only (data sample). Email is sparse.
- All four intake channels (call, form, social, lead ad) carry phone reliably; only some carry email.
- Roistat / Zadarma webhooks key by phone.
- Dedup decision tree at intake is: phone match → email match → no match. Phone is the dominant identifier.

E.164 normalization runs at intake; the column is `UNIQUE`. Soft alternates live in `phone_alt[]` for "this person sometimes uses their work line."

### Project interest — many-to-many

Replaces the 5 hardcoded per-project text columns on Attio People:

```text
person_projects
├── person_id (fk)
├── project_id (fk)
├── interest_level (enum: cold, warm, hot)
├── owner_user_id (fk → users) — manager closest to this person+project pair
├── first_touch_at, last_touch_at
└── PRIMARY KEY (person_id, project_id)
```

Computed mostly from Activities + Deals; agents can also pin manually.

### Merge model

Two contacts collide → keep oldest, point newer's `merged_into_id` to the older, copy unique multi-value fields up. See [systems/identity-resolution](../systems/identity-resolution) for the field-by-field rules. UI shows merged contacts as a single object; queries auto-resolve via `merged_into_id`.

## Companies — second-class for B2C, first-class for investors

The current Attio `Companies` object is B2B-shaped (ARR ranges, AngelList, employee count, funding raised) and 99% empty for real estate buyers. We strip the B2B-Enrich fields and keep Companies for the legitimate cases:

- **Investor accounts** — high-volume buyers, fund vehicles, family offices
- **Partner / agency accounts** — brokers we work with
- **Corporate accounts** — companies buying offices

```text
companies
├── id (uuid)
├── name
├── legal_name, vat_id (nullable)
├── domain (text, indexed, nullable)
├── kind (enum: investor, partner, corporate, other)
├── primary_contact_person_id (fk)
├── notes (text)
└── created_at, updated_at
```

People can belong to a Company via `people.company_id`. Most Person records have `company_id IS NULL`.

## What we drop from Attio's Companies object

- Estimated ARR (B2B SaaS shape)
- Funding raised
- Foundation date
- Employee range
- AngelList
- Twitter follower count
- Connection strength / Strongest connection (Attio Enrich features)
- The 9 ARR bucket select options
- The 20 Categories select options
- B2B "Team" multi-reference (we use `people.company_id` 1:N instead)

## What we add

- `interest_level` per project (instead of "did this person trigger an activity for that project?")
- `merged_into_id` for proper soft-delete via merge
- `phone_alt` / `email_alt` as proper arrays (instead of multi-select fields with single values)
- `residence` vs `current` location preserved from Attio's "relocation tracking" concept

## What we keep

- Multi-channel identifiers (phone + email + social)
- Language (ro / ru / en)
- Geographic profile (birth / residence / current country+city) — useful for international real estate
- The Person ↔ Company link (when relevant)

## Open questions

- Whether to keep "connection strength" (Attio Enrich) — see [open-questions](../open-questions). My pick: drop. The team doesn't use Gmail/Calendar integration today.
- Whether Person dedup window is permanent or time-bounded. Current behavior: always merge by phone. Proposal: merge only if both records active within 90 days; otherwise keep both with cross-reference.
