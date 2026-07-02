# Email leg — outbound email as a first-class `outboundActivity`, mirroring the SMS actions

Make manager email a peer of SMS in the **task/actions surface**: a consent preflight tells the manager whether the send is allowed, the send goes out, and it's logged as an `outboundActivity`. This is a **direct mirror of the built SMS send actions** (`marketing-sync/services/marketing-sms.service.ts` + `TaskActionsWidget`). Nothing is invented.

**Decisions (2026-07-02):**
1. **`outboundActivity` = the timeline** — no separate green-sentence event.
2. **Outbound only** — a manager's inbox does NOT create leads; inbound intake stays strictly corporate/Chatwoot.
3. **Consent is INFORM-only for 1:1 personal email** (differs from SMS): consult the consent engine (`personProjectConsent.emailMarketingConsent` for the deal's project) and **warn** the manager if it's absent, but **do NOT block the send** — a 1:1 personal reply is operational. SMS stays hard-gated; this is a per-channel enforcement policy. `doNotContact` deprecated (unused).

## The SMS template (what we mirror, verbatim structure)

Backend (`marketing-sms.service.ts`):
- `resolveTaskSmsContext(taskId)` / `resolveSmsContextForDeal({opportunityId, personId})` → resolve **recipient**, **sender alias** (`project.smsAlias`), and **consent** (`consent.smsMarketingConsent === true` for the deal's project) → `{to, alias, canSend, reason, personId, opportunityId}`.
- `getTaskSmsContext` / `getRecordSmsContext` → modal preflight `{alias, canSend, reason}`.
- `sendTaskSms` / `sendRecordSms` → if `canSend`: send via the gateway, then `outboundActivity.save({channel:'SMS', loggedVia:'CRM_INITIATED', body, fromIdentity, deliveryStatus:'QUEUED', occurredAt, externalId?, opportunityId?, personId})`.

Frontend (`page-layout/widgets/task-actions/TaskActionsWidget.tsx`):
- Fetches `taskSmsContext` / `personSmsContext`; `smsCanSend` gates the send button, `smsReason` shows why it's blocked.

## Email equivalents to build

### Backend (`enso/marketing-sync` or a sibling `outbound-email` service)
- `resolveTaskEmailContext(taskId)` / `resolveEmailContextForDeal({opportunityId, personId})`:
  - recipient = person's **primary email**;
  - sender = the **manager's connected account** (native 1:1) — *channel difference from SMS's `project.smsAlias`*; see verify #1;
  - consent = **advisory** — read `consent.emailMarketingConsent` for the deal's project and return it as `hasEmailConsent` + a `consentNote`; it does **NOT** set `canSend:false`;
  - `canSend` reflects **technical validity only** (recipient email present + sender/connected account present) — never consent;
  - → `{to, from, canSend, reason, hasEmailConsent, consentNote, personId, opportunityId}`.
- `getTaskEmailContext` / `getRecordEmailContext` → `{from, canSend, reason, hasEmailConsent, consentNote}` preflight.
- `sendTaskEmail` / `sendRecordEmail(subject, body)` → if `canSend` (technical): send via the **messaging outbound service** (`message-outbound-manager` send path — already works over SMTP post-Pro) **regardless of consent**, then `outboundActivity.save({channel:'EMAIL', loggedVia:'CRM_INITIATED', subject, body, fromIdentity:from, toIdentity:to, externalId:<messageId>, externalThreadId, occurredAt, opportunityId?, personId})` (optionally stamp the consent-state-at-send for audit). **This row is the timeline entry.**

### Frontend
- The **Message (email) task widget** consumes `taskEmailContext` / `personEmailContext`. Send is gated only by `canSend` (technical). When `hasEmailConsent` is false, show a **non-blocking warning** (`consentNote`, e.g. *"No email consent on file for this lead"*) while **keeping the send button enabled** — inform, don't block (unlike the SMS widget, which disables send). New GraphQL: `taskEmailContext`/`personEmailContext` queries + `sendTaskEmail`/`sendRecordEmail` mutations.

### Metadata delta (gated, Step-B style)
Add to `outboundActivity`: `subject`, `toIdentity`, `externalThreadId`. (`channel='EMAIL'` already valid.)

## Guardrails
- **Idempotency** on message `externalId` (don't double-log if a Sent-folder sync later re-sees it).
- Log the `outboundActivity` even when person/opportunity don't fully resolve (person-less), as inbound tolerates.

## To verify before coding
1. **Email sender source** — for the task/actions surface, is the sender the **manager's connected account** (personal 1:1) or a **project-scoped email sender** like SMS's `smsAlias`? (Consent is project-scoped either way; this only sets the From.) Product call.
2. **Messaging outbound service call signature** — confirm how to invoke `message-outbound-manager`'s send from an enso service (the `sendEmail` path) to reuse it rather than re-implement SMTP.

## Optional (later) — observed/base-composer sends
Sends made directly from Twenty's base Emails composer (or synced from the Sent folder) bypass the custom action. If you want those captured too, add a `message` post-create hook (`direction=OUTGOING`) writing `outboundActivity(loggedVia:'OBSERVED')` — **no consent gate** (already sent). Not required for the core ask.

## Net
Email becomes a send action in the task/actions surface that logs an `outboundActivity` (= its timeline), mirroring the SMS structure — but with **inform-not-block** consent: the consent engine is consulted and the manager is warned when there's no `emailMarketingConsent`, while the send stays enabled (SMS remains hard-gated).
