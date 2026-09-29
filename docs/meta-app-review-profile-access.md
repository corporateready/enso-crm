# Meta App Review — Business Asset User Profile Access

Draft submission for the **ENSO Chatwoot** app, to stop every Facebook DM contact
arriving as a nameless placeholder. Written 2026-09-29.

Everything in `[FILL]` is something that could not be verified from outside the
Meta dashboard — check it rather than assume it.

## What we are asking for

| | |
|---|---|
| App | **ENSO Chatwoot** — App ID `1372861104654929` |
| Request | **Business Asset User Profile Access** — **Advanced Access** |
| Fields it unlocks | `first_name`, `last_name`, `profile_pic` of a person who messaged one of our Pages |
| Where to request it | App Dashboard → **App Review → Permissions and Features** → search "Business Asset User Profile Access" → **Request advanced access** |

**Why:** without it, Meta returns a profile only for people who hold a role on the
app. Proven 2026-09-29 by calling the profile API with the real page token: an app
admin's PSID returns `first_name`; every member of the public returns
`(#100) … cannot be loaded due to missing permissions` (code 100, subcode 33).
465 of 466 Facebook contacts since go-live were affected. Instagram is not — the
Instagram API returns names without this feature.

Meta's own statement of the requirement:
[Messenger Platform → User Profile API](https://developers.facebook.com/docs/messenger-platform/identity/user-profile).

## Is there a simpler route for an internal app?

**No.** Checked against Meta's own references on 2026-09-29:

- The feature's reference page states it needs **both** App Review **and** Business
  Verification before the app gets live data.
- The access-levels page is explicit that Standard Access covers **only people who
  hold a role on the app**, with no carve-out for an app that only touches its own
  business's data. That is exactly what we observed: an app admin's name loads, the
  public's does not.

The one condition worth designing the submission around: the feature is usable **only
if the app displays at least one user field in its business interface**. Our use —
the customer's name in the inbox and on the CRM record — is precisely that, and the
screencast below exists to show it.

## Before you submit — prerequisites

- [x] **Business Verification** — done. Portfolio **ENSO Development Moldova**
  (`220296539786413`) is **Verified** under *SRL BINA-AGENCY*, originally verified
  **2024-10-16**, for the use case *"App requires access to permissions on Meta for
  Developers"*. ENSO Chatwoot is **owned by** that portfolio (Business Settings →
  Apps), so the verification applies to it. Checked 2026-09-29.
- [x] App is **Live** — public DMs already reach our webhook, which a
  development-mode app would not receive.
- [ ] **Privacy Policy URL** set on the app. `[FILL: URL]`
- [ ] **Data Deletion** instructions URL or callback set. `[FILL: URL]`
- [ ] A **reviewer login** for chat.enso.ro that can see one Facebook inbox, so Meta
  can see where the data is used. Create it yourself; do not reuse a manager's
  account. `[FILL: email + password, pasted only into the review form]`

## 1. "How will your app use this feature?" — paste-ready

> ENSO Development is a real-estate developer in Moldova and Romania. Customers send
> questions about our projects to our Facebook Pages (Artima, Vânzări Imobiliare,
> Avram Iancu, ENSO Development Moldova and ENSO Development România). Our sales
> team reads and answers those messages in a customer-service inbox (Chatwoot,
> self-hosted at chat.enso.ro), and each conversation is linked to a customer record
> in our CRM (crm.enso.ro).
>
> We use Business Asset User Profile Access for one purpose: to show our own agents
> the name and profile picture of the person they are replying to. Without it, every
> customer appears under the same placeholder, so agents cannot address the customer
> by name, cannot tell two conversations apart, and cannot recognise a returning
> customer — which today leads to duplicated work and customers being asked for
> information they already gave.
>
> The name and profile picture are shown only to the business's own sales agents,
> inside the inbox and on the matching customer record. They are not used for
> advertising, not used to send marketing messages, not used to build audiences,
> and not shared with any third party. We only reply to people who wrote to us
> first, within Messenger's standard messaging window.

## 2. Screencast — what to record

Meta wants to see the data being used in the product. Record one continuous video,
1–3 minutes, no editing needed. Use an account that **has a role on the app** (your
own works — its name already loads today), because that is the only way to show the
feature working before approval.

1. **Open the Page on Facebook** (e.g. Vânzări Imobiliare) as the test user and send
   a message: *"Bună ziua, aș dori detalii despre apartamente."*
2. **Switch to chat.enso.ro**, open the Vânzări Imobiliare Facebook inbox, and show
   the new conversation arriving — point at the **customer name and profile picture**
   in the conversation header and contact panel.
3. **Reply** from the inbox, addressing the customer by first name. Show the reply
   arriving on Facebook.
4. **Switch to crm.enso.ro**, open the customer's record, and show the **name** on
   the contact — this is where our sales team works the lead.
5. Narrate (or caption) one line at the end: *"The name is used only so our agents
   know who they are talking to."*

## 3. Reviewer instructions — paste-ready

> 1. Log in to https://chat.enso.ro with the reviewer credentials provided.
> 2. Open Inboxes → "Vânzări Imobiliare Facebook".
> 3. Send a message to the Facebook Page "Vânzări Imobiliare" from any Facebook
>    account. The conversation appears in the inbox within seconds.
> 4. The customer's name and profile picture are displayed in the conversation
>    header and the contact details panel. This is the only place the profile data
>    is used.
>
> Reviewer credentials: `[FILL]`

## 4. Data handling statement — if asked

> Profile data (first name, last name, profile picture URL) is stored with the
> conversation in our self-hosted customer-service system and on the linked customer
> record in our self-hosted CRM. Access is limited to our own authenticated staff. It
> is deleted together with the conversation and customer record, on request or
> under our data deletion procedure `[FILL: link]`. It is never sold, shared or used
> for advertising.

## After approval

Tell Claude. Two things follow, and both are already planned:

1. **New contacts** get real names immediately — the placeholder only appears when
   Meta returns no profile.
2. **Existing contacts get backfilled.** Every placeholder is recognisable by its
   `Facebook lead ·` prefix and keeps its PSID, so a one-off script re-fetches the real
   name for each and updates the Chatwoot contact, the CRM person, and the deal and
   activity names that embed it. Nothing is lost by waiting.

If the review is **rejected**, keep Meta's reason: the usual causes are a screencast
that doesn't show the data on screen, or a missing privacy/deletion URL.
