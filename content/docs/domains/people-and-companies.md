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

## Family relationships (live)

Person-to-person family links (spouse, child, parent, sibling, partner) are
modeled via a junction object `personRelationship`, surfaced on each
Person's record page as a card labeled **Family**.

```text
personRelationship
├── id (uuid)
├── name (text, composite) — e.g. "Spouse · Maria Popescu"
├── person (fk → person)         — the SUBJECT side of the link
├── relatedPerson (fk → person)  — the OTHER side
├── relationType (select: SPOUSE | PARTNER | CHILD | PARENT | SIBLING | OTHER)
├── notes (text)
├── mirrorOf (fk → personRelationship, self-relation, nullable, hidden)
│       null on canonical rows; points back to canonical on mirror rows.
└── created_at, updated_at, etc.
```

**Why a junction and not direct `spouse` / `children` fields:** Twenty
deliberately removed `ONE_TO_ONE` and `MANY_TO_MANY` relation types in
upstream PR #12482. Family graphs are symmetric (spouse) and many-to-many
(two parents, shared kids), which the surviving `MANY_TO_ONE` /
`ONE_TO_MANY` types cannot model directly. The junction is Twenty's
intended pattern for these.

### Mirror-write (bidirectional symmetry)

Adding a relationship from Ivan's page (person=Ivan, relatedPerson=Maria,
type=SPOUSE) auto-creates a mirror row from Maria's perspective
(person=Maria, relatedPerson=Ivan, type=SPOUSE). Both people then see each
other in their respective Family cards, without double entry.

The mapping inverts asymmetric kinships:

| Canonical type | Mirror type |
|---|---|
| SPOUSE | SPOUSE |
| PARTNER | PARTNER |
| SIBLING | SIBLING |
| OTHER | OTHER |
| CHILD | PARENT |
| PARENT | CHILD |

Updates and deletes on the canonical row cascade to the mirror.

The pattern (composite-name + mirror-write) is documented as a reusable
recipe in [systems/junction-composite-name-pattern](../systems/junction-composite-name-pattern).

### Hidden complement on Person

Person has two inverse collections from `personRelationship`:

- **`relationships`** (relabeled to **"Family"** in the UI) — rows where this
  person is the SUBJECT. The visible card.
- **`relatedInRelationships`** — rows where this person is referenced as the
  OTHER side. Hidden from the record page; with mirror-write in place, every
  link is represented on both sides via subject-side rows, so this card is
  redundant scaffolding.

## Consent (live)

Two layers, intentionally separated:

### Person-level: hard stop

A global kill switch that overrides everything. If `doNotContact = true`,
no channel from ENSO Group contacts this person — including operational
1:1 calls from a manager about a deal they initiated.

| Field | Type | Purpose |
|---|---|---|
| `doNotContact` | BOOLEAN, default false | The hard stop |
| `doNotContactSetAt` | DATE_TIME | When the hard stop was applied (audit) |
| `doNotContactReason` | SELECT (User Request / GDPR Objection / Hard Bounce / Suspected Fraud / Internal Decision / Other) | Why (audit) |

### Per-project: marketing consent (sparse, default-deny)

Marketing consent lives on a separate junction `personProjectConsent` — one
row per (person × project) pair, present only when consent has been
explicitly decided.

```text
personProjectConsent
├── id (uuid)
├── name (composite) — "Maria Popescu · ARTIMA"
├── person (fk → person)
├── project (fk → project)
├── emailMarketingConsent     (boolean, default false)
├── smsMarketingConsent       (boolean, default false)
├── whatsappMarketingConsent  (boolean, default false)
├── emailMarketingConsentedAt    (datetime)
├── smsMarketingConsentedAt      (datetime)
├── whatsappMarketingConsentedAt (datetime)
├── emailMarketingConsentSource    (select)
├── smsMarketingConsentSource      (select)
├── whatsappMarketingConsentSource (select)
└── created_at, updated_at, etc.
```

Source select options (uniform across channels): Website Form / Lead Ad /
Verbal (sales call) / Double Opt-In / Migration / Other.

### Sparse-table semantics

- **No row** for (person × project) = no consent decided. Default-deny: do
  not send.
- A row with `emailMarketingConsent = true` means **explicit opt-in**, with
  timestamp + source recorded for audit.
- A row with `emailMarketingConsent = false` means **explicit opt-out**, also
  recorded — important for proving "we did stop sending after they asked."

A `false` row is meaningfully different from no row at all: both mean "don't
send," but the row records the audit trail.

### Read-side enforcement

Every outbound sender (Novu / SMS provider / WhatsApp / n8n broadcast)
MUST gate sends through these checks. Never trust callers to filter.

```ts
canEmail(person, project)    = !person.doNotContact && row(person,project)?.emailMarketingConsent === true
canSMS(person, project)      = !person.doNotContact && row(person,project)?.smsMarketingConsent === true
canWhatsApp(person, project) = !person.doNotContact && row(person,project)?.whatsappMarketingConsent === true
canOperational1to1(person)   = !person.doNotContact   // for managers calling about a deal in flight
```

### Write-side discipline

When flipping a consent to `true`, write all three of that channel's fields
atomically (boolean + consentedAt + consentSource). Skipping the audit
fields defeats the purpose.

### Migration default

On Attio import, set all consents to `false` regardless of any Attio data.
You don't have audit-grade proof of prior consent — re-consent at next
touch.

### Why not also store per-channel consent at the person level?

Earlier design had email / sms / whatsapp marketing consent BOOLEANs on
Person itself, intending to act as a "person agreed to marketing from ENSO
Group at all" umbrella gate above per-project filtering. We dropped that
layer because:

- All ENSO marketing goes out under specific brand names (ARTIMA newsletter,
  AVRAM IANCU updates, etc.) — there is no "ENSO Group umbrella newsletter."
- The umbrella booleans would be permanent `true` placeholders gating
  nothing; they'd just be noise.
- Per-project consent IS the marketing consent.

If a real "from ENSO Group" umbrella program ever appears, the umbrella
booleans can be re-added — but we won't pre-build that.

## Open questions

- Whether to keep "connection strength" (Attio Enrich) — see [open-questions](../open-questions). My pick: drop. The team doesn't use Gmail/Calendar integration today.
- Whether Person dedup window is permanent or time-bounded. Current behavior: always merge by phone. Proposal: merge only if both records active within 90 days; otherwise keep both with cross-reference.
- Lead source field on Person — deferred. Intent: derived (not directly entered) from the intake activity (form / call / social / lead ad) plus UTM trio on that intake. Likely a read-only computed field via a hook reading the earliest related Activity.
