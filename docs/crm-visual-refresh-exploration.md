# CRM visual refresh — future exploration

A parked exploration, not committed work. Origin: the polished `TASK_ACTIONS`
widget (filled-blue primary actions, soft-colored `Tag` status pills, generous
spacing, hairline borders, sentence case) was well-liked, and the question is what
it would take to bring that look to the **whole** CRM.

## The key realization

The widget is **not a different design system** — it's built entirely from Twenty's
own theme tokens (`themeCssVariables`, the `Tag` component, `Button` variants). The
polish came from using those tokens *deliberately and consistently*, not from a
foreign aesthetic. Twenty already has the ingredients; most of the app just doesn't
apply them with the same discipline. So this is a **theme problem, not a
thousand-component rewrite.**

## Three separate problems

### 1. Global token shifts — high leverage (~70% of the feel)
The design system lives in `packages/twenty-ui/src/theme/` → `themeCssVariables`.
Components reference tokens, not hardcoded values, so changing central tokens
cascades app-wide. The levers, in rough order of impact:

- **Typography** — font family, a tighter size scale, and the "two weights only
  (400/500), sentence case, never ALL-CAPS" discipline. Moves the feel the most.
- **Color** — soften the palette; standardize the *soft-background + darker
  same-hue text* pill pattern everywhere (the `Tag` component already does this —
  lean into it rather than saturated chips).
- **Radius + spacing** — larger default `border-radius` (rounded-lg feel); more
  default card/section padding.
- **Buttons** — make the primary button default to the filled-blue treatment
  (today `variant=primary` is a gray fill; the mockup-feel default is the blue one).
- **Borders / surfaces** — flat white cards, 0.5px hairlines, no shadows.

A single focused PR at this token layer touches every screen at once — the biggest
bang for the buck.

### 2. Component discipline — medium, mechanical
Tokens get the *feel*; consistency gets the *finish*. An audit to find components
that hardcode colors/sizes or use old patterns and route them through the tokens +
shared `Tag`/`Button`. Tedious but parallelizable (a fan-out workflow fits well).

### 3. The density tension — the honest hard part
The mockup aesthetic is tuned for **low-density, explanatory content** (whitespace,
16px body, big breathing room). A CRM is the opposite — high-density operational
data (wide tables, 30-field record pages, kanban). Applying generous whitespace +
large type to a data table *hurts* it. So:

- **Records, cards, side panels, action surfaces** → take the full treatment.
- **Tables, dense lists, the field grid** → take the typography/color/radius polish
  but **keep their density**.

This tension is why no amount of token-tweaking makes the whole CRM look like a
marketing mockup — and why it shouldn't.

## Recommended approach (when pursued)

1. **Spike first** — on a branch, change just typography + radius + button-primary
   tokens, deploy, and judge the whole-app feel before committing further.
2. **One theme-token PR** — typography, color softening, radii, spacing, button/tag
   defaults. Ship, review the whole app, iterate.
3. **Component audit** — fan out across the component tree to unify on tokens.
4. **Leave dense surfaces dense** — polish their color/type/radius, not whitespace.

## Caveat

Global token changes touch *every* screen, including **dark mode** and the
density-sensitive surfaces. This needs a careful before/after review pass, not a
blind swap. The architecture is on our side (token-driven), but the review is not
free.
