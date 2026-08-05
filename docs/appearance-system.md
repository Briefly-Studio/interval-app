# Appearance System

Production semantic theming for Interval: System / Light / Dark / Warm. This document is the
single reference for how it's built, why it's built that way, what's verified vs. not, and what's
deliberately out of scope.

## 1. Architecture overview

- `src/theme/types.ts` — `AppearanceMode` (`"system" | "light" | "dark" | "warm"`), `ResolvedTheme`
  (`"light" | "dark" | "warm"`), and the ~40-key `ThemeTokens` contract.
- `src/theme/tokens.ts` — the single source of truth for color. `LIGHT_TOKENS`, `DARK_TOKENS`,
  `WARM_TOKENS`, plus theme-independent `spacing`/`radii`/`iconSizes`/`touchTarget`/`typographySizes`
  (sizing/type-scale never changed by this work, only color).
- `src/theme/resolveAppearance.ts` — pure function: `(mode, systemScheme) -> ResolvedTheme`.
  `"warm"` is never a `system` resolution target; it's only ever chosen explicitly.
- `src/theme/appearancePreference.ts` — AsyncStorage persistence, mirrors
  `src/i18n/languagePreference.ts` exactly (unscoped key, safe fallback to `"system"` on any
  corruption, never throws).
- `src/theme/startupTreatment.ts` — the single typed mapping from a resolved theme to a startup
  animation treatment (`light`/`dark`; Warm → `light`). Called by `BrandStartup.tsx` itself, not
  computed upstream and passed down as a prop.
- `src/theme/index.ts` — the **canonical appearance store**: one atomic state object
  (`{selectedMode, systemScheme, resolvedTheme, isInitialized}`), one module-level pub/sub
  (`Set` of listeners), and one module-level `Appearance.addChangeListener` subscription,
  established at import time. `useAppearanceState()` and `useTheme()` are the only two hooks any
  component needs — both subscribe to this exact same store. No React Context provider: see §2 for
  why, and for the correctness argument this batch required before keeping that choice.
- `src/ui/theme.ts` — a compatibility shim re-exporting `LIGHT_TOKENS` in the old static shape,
  for any screen not yet migrated. Not a source of truth; every production screen and shared
  `src/ui/*` component has been migrated off it except `BrandStartup.tsx` (which now reads the
  canonical store directly via `useTheme()`, not this shim).

**Founder-confirmed bug this batch fixes**: System mode selected, OS appearance changed Dark→Light,
Theme Lab correctly showed Light, but a subsequent cold launch's startup animation still chose
Dark. Root cause and fix are in §2 and the "Startup handoff" sections below (§10–§12).

## 2. Why module-level pub/sub, not Context — and why it was NOT the root cause

The original bug traced to **two independent `useColorScheme()` call sites** — one inside
`useTheme()`, one held separately by `src/devTools/themeLab/ThemeLabScreen.tsx` for its own
"system" comparison note — not to the pub/sub propagation mechanism itself. Both were reactive
once mounted and live (which is why Theme Lab, opened well after the app was fully running,
reliably showed the correct value), but neither was ever *proven* to agree with the other, since
they were two separate hook instances with no shared source. The startup decision, evaluated
during `app/_layout.tsx`'s very first renders — while the native splash still fully covered the
screen and the RN root view was not yet confirmed attached/visible — was the one place this could
actually go wrong, and did.

The fix replaces per-component `useColorScheme()` calls everywhere with **one
`Appearance.addChangeListener` subscription**, established at module evaluation (the earliest
possible moment, before any component ever renders), feeding the one canonical state object every
consumer reads. This is strictly additive to the existing pub/sub pattern, not a replacement of
it: `src/i18n/index.ts` already proved this exact shape (module-level state + listener `Set`) works
correctly in this codebase for "device-scoped preference many unrelated components read
reactively"; the bug was in *what fed the state* (a per-component hook with no ordering guarantee
relative to app startup), not in *how the state propagated* (which was already synchronous and
consistent). A React Context provider would not have fixed this on its own — it would have the
identical risk if it also sourced its value from `useColorScheme()` internally. `useTheme()` and
`useAppearanceState()` still satisfy "provider or equivalent": they subscribe on mount, unsubscribe
on unmount, and every consuming component re-renders when canonical state changes.

## 3. Token contract

`ThemeTokens` (`src/theme/types.ts`) groups tokens by family:

| Family | Keys |
|---|---|
| canvas/surface | `canvas`, `surface`, `surfaceElevated`, `surfaceMuted` |
| text | `textPrimary`, `textSecondary`, `textMuted`, `textInverse` |
| border | `border`, `borderStrong`, `divider` |
| accent | `accent`, `accentPressed`, `accentSubtle`, `onAccent` |
| success/warning/danger | `{success,warning,danger}`, `{...}Pressed`, `{...}Surface`, `on{Success,Warning,Danger}` |
| disabled | `disabledSurface`, `disabledText`, `disabledBorder` |
| input | `inputBackground`, `inputBorder`, `inputBorderFocused`, `placeholder` |
| navigation | `navigationBackground`, `navigationBorder`, `navigationActive`, `navigationInactive` |
| chrome | `overlay`, `shadowColor` |

`typographySizes` (in `tokens.ts`) is deliberately colorless — `{fontSize, fontWeight,
letterSpacing}` only. The old `src/ui/theme.ts` embedded a fixed color per style
(`title: {..., color: "#1B2430"}`), which can't work once the same style name renders under four
different resolved themes. Every call site now pairs a size style with an explicit color:
`[typography.title, { color: colors.textPrimary }]`.

## 4. The four modes

- **System** — resolves live against `useColorScheme()`, React Native's own OS-appearance hook.
  No manual `Appearance.addChangeListener` bookkeeping; the hook re-renders consumers automatically
  when the OS setting changes.
- **Light** — the existing approved beta visual language, with two corrections (see §6): accent
  moved to the branding-approved `#0F6E6A`, and `danger`/`warning`/`borderStrong` corrected to
  values that actually clear their contrast targets.
- **Dark** — not an inversion. Four distinct tonal steps (`canvas < surfaceMuted < surface <
  surfaceElevated`) so cards and modals read as visually separated from the page background, not
  one dark color reused everywhere. Canvas/primary-text reuse the approved brand dark-mode anchors
  verbatim (`#1B2024`, `#FAFAF8`), and accent uses the dark-mode teal (`#3FA39D`), never the
  light-mode teal — the light teal fails contrast on dark slate.
- **Warm** — "paper under warm natural light": a warm-neutral canvas with three progressively
  lighter warm surfaces, not one flat tint. Deliberately not the excluded directions (no bright
  yellow, no mustard, no sepia filter, no parchment texture). Copy for this mode describes it only
  as a calmer visual option — see §8 for the explicit constraint against medical/sensory framing.

## 5. The non-obvious Dark-theme finding: `onAccent` etc. are dark text, not white

White text on Dark's accent teal (`#3FA39D`) measures **2.9:1** — fails AA. Dark text (the canvas
color, `#1B2024`) on the same teal measures **5.43:1** — passes comfortably. The same pattern holds
for `onSuccess`/`onWarning`/`onDanger` in Dark: all four are bright enough colors that dark text
reads better than white. This is the kind of default that's easy to get backwards, so every
`on{X}` token in `DARK_TOKENS` was verified individually rather than assumed to follow Light's
"white text on saturated color" pattern.

## 6. Contrast report

Computed with the standard WCAG relative-luminance formula (sRGB linearize ->
`0.2126R + 0.7152G + 0.0722B` -> `(L1+0.05)/(L2+0.05)`), the same method already used in
`interval-brand-assets/branding/scripts/contrast.py`. AA text target: 4.5:1. AA non-text/UI-component
target (borders, focus rings): 3:1.

| Pair | Light | Dark | Warm | Target | Status |
|---|---|---|---|---|---|
| textPrimary / canvas | 14.73:1 | 15.72:1 | 13.03:1 | 4.5 | PASS all |
| textPrimary / surface | 15.65:1 | 13.92:1 | 13.41:1 | 4.5 | PASS all |
| textSecondary / surface | 5.92:1 | 6.61:1 | 5.90:1 | 4.5 | PASS all |
| onAccent / accent | 6.07:1 | 5.43:1 | 6.07:1 | 4.5 | PASS all |
| onSuccess / success | 5.56:1 | 6.03:1 | 5.56:1 | 4.5 | PASS all |
| onWarning / warning | 5.53:1 | 7.61:1 | 5.53:1 | 4.5 | PASS all |
| onDanger / danger | 6.02:1 | 5.86:1 | 6.68:1 | 4.5 | PASS all |
| danger / dangerSurface | 5.17:1 | 5.37:1 | 5.36:1 | 4.5 | PASS all |
| warning / warningSurface | 4.81:1 | 6.07:1 | 4.51:1 | 4.5 | PASS all |
| success / successSurface | 4.74:1 | 5.18:1 | 4.51:1 | 4.5 | PASS all |
| borderStrong / surface | 3.41:1 | 3.04:1 | 3.60:1 | 3.0 | PASS all |
| accent / canvas (graphical) | 5.71:1 | 5.43:1 | 5.25:1 | 3.0 | PASS all |

**Fixed in this batch** (were failing before, now pass — the "previously-identified gaps" work):
production's `danger`/`warning` previously failed against their own tinted surfaces and `warning`
also failed against plain white; `borderStrong` previously measured 1.62:1 (below the 3:1
non-text minimum). All three are corrected at the source in `LIGHT_TOKENS` — not just documented,
actually shipped as the real production values.

**Fixed in this later pass** (the three marginal near-misses this batch's own contrast report had
previously flagged and left open): `success`-on-`successSurface` (was Light 4.44:1, Warm 4.22:1)
and `warning`-on-`warningSurface` (was Warm 4.44:1). Old → new values:

| Token | Old | New | Change |
|---|---|---|---|
| `success` (Light + Warm) | `#2F7A55` | `#2D7552` | ~4% darker |
| `warning` (Light + Warm) | `#8A6220` | `#896120` | ~1% darker |

Both changes stay firmly in the same hue family (green stays green, ochre stays ochre — neither
was pushed toward danger-red) and are small enough to be visually indistinguishable from the
originals side by side, while every affected pair (including `onSuccess`/`onWarning`, which
improved as a side effect of the darkening) now clears 4.5:1. `successPressed`/`warningPressed`
(the separate pressed-state variants) were not touched. `DARK_TOKENS`' own `success`/`warning`
values were already passing and were left untouched. `src/devTools/themeLab/tokens.ts` picks up
both new values automatically (it imports `LIGHT_TOKENS`/`WARM_TOKENS` directly), so Theme Lab's
own token table and contrast notes reflect the fix with no separate edit required there beyond
correcting its prose to cite the new numbers.

**Intentionally not held to 4.5:1** (WCAG 1.4.3 doesn't require it, or the token is exempt by
design):
- `textMuted` (Light 3.65:1, Dark 3.77:1, Warm 3.38:1) — a tertiary/de-emphasized style, never used
  for primary content.
- `disabledText` (Light 2.15:1, Dark 2.34:1, Warm 2.46:1) — WCAG explicitly exempts inactive UI
  components from the contrast requirement.
- `placeholder` (Light 3.65:1, Dark 3.77:1, Warm 3.60:1) — placeholder text is supplementary, not
  real content; low contrast is a deliberate signal that the field is empty.

## 7. What was migrated

Every shared `src/ui/*.tsx` primitive (18 files) and every production screen under `app/` — signed-out
and signed-in home, all auth screens, account/profile screens, settings, the new appearance
screen, sync status, Recently Deleted, import, create/edit deck, deck detail, create/edit card,
review, quiz, both results screens, history, export, privacy notice, beta notice, help & feedback,
language, and the dev-tools screen — now call `useTheme()` and render zero hardcoded colors.

**Removed, not migrated:**
- `app/import-deck.tsx` — a legacy paste-JSON import flow, off-brand and un-themed. Confirmed dead
  across multiple audits: no route in the app (`app/*.tsx`, `src/**`) ever pushed or replaced to
  `/import-deck`; `app/import.tsx` (the reachable, choose-file flow linked from Settings/Home)
  fully superseded it. Deleted in the V3 Beta Readiness batch, along with its now-unused
  `importDeckLegacy` locale namespace — `app/import.tsx` and the shared
  `src/domain/deckPortability.ts` import/export logic it uses are unaffected.

**Two pre-existing module-scope color bugs found and fixed as part of migration**: `app/index.tsx`'s
`SYNC_STATUS_META` and `app/sync-status.tsx`'s `STATUS_META` both read `colors.*` once at module
load time (dead on import, before any theme could apply). Both are now `statusMetaFor(colors)`
functions called inside the component body, so status colors stay reactive to the resolved theme
like everything else.

## 8. Warm mode: framing constraint

Warm must never be described, in code comments, UI copy, or localized strings, as a medical
treatment or as preventing migraines, autism-related symptoms, eye strain, sensory overload, or any
other medical condition. It is described only as a calmer visual option. This applies to both
`en.ts` and `es.ts` appearance copy and to any future copy touching this feature.

## 9. Persistence

`src/theme/appearancePreference.ts` stores the mode under `"briefly.appearancePreference.v1"` in
AsyncStorage — an unscoped key (not per-workspace via `scopedKey()`), matching that the appearance
preference is a device preference, not account data. Corrupt or unreadable storage falls back
silently to `"system"`; the function never throws. This mirrors `src/i18n/languagePreference.ts`
exactly, the same pattern already proven for language preference in this codebase.

## 10. Cold-start initialization

`initTheme()` (`src/theme/index.ts`) resolves the persisted `selectedMode` and re-confirms
`systemScheme` before marking canonical state `isInitialized`. It is idempotent — concurrent or
repeated calls (Fast Refresh remounting `app/_layout.tsx`) share one in-flight promise, never issue
a redundant AsyncStorage read, and never race each other. It has an explicit, safe, self-healing
800ms backstop: if AsyncStorage hangs past that bound, canonical state initializes to `"system"`
using the systemScheme already known from the module-level `Appearance` listener (never a guessed
Light default) — and the real AsyncStorage read keeps running in the background; if it later
completes with a different value, it still corrects the app's state even though initialization
already unblocked startup. `app/_layout.tsx` mounts `<BrandStartup>` only once `isInitialized` is
true — never with a temporary or guessed treatment — and the native splash (fixed teal, cannot
read AsyncStorage before JS starts) stays visible for that entire gap, since `hideAsync()` is only
ever called from within `BrandStartup` itself, after its own first frame is confirmed laid out.

A user with an explicit non-system preference sees zero flash of the wrong treatment: `BrandStartup`
doesn't mount — and the native splash doesn't hide — until `resolvedTheme` is already the real,
confirmed value.

## 11. Theme transition behavior

Switching modes (in `app/appearance.tsx`) applies immediately — no crossfade. `setAppearanceMode()`
updates canonical state synchronously, every subscribed `useTheme()` consumer re-renders on the
next tick, and React Native repaints. Adding a crossfade would mean either (a) a global overlay
snapshot-and-fade wrapping the entire navigation tree, which risks visual artifacts across
different screen types (scrollable lists, modals, the FlatList-heavy deck-detail screen) that
weren't individually tested against a transition animation, or (b) hooking `Animated`/Reanimated
into every individual color usage, which multiplies the surface area of this already-large batch
for a purely cosmetic effect. Immediate change was chosen as the lower-risk option; report this to
the founder as a candidate for a later, separately-scoped polish pass if desired.

## 12. Startup handoff: the bridge-frame architecture

Founder QA on the previous cut of this batch found visual discontinuities at the native-splash →
BrandStartup handoff: an abrupt teal-to-treatment cut, a possible mark size/position shift, and an
occasional pale/teal strip at the top (status-bar/notch region) while the rest of the surface had
already moved on to the resolved treatment. `BrandStartup.tsx` was rewritten around a **bridge
frame**:

1. **Bridge** (`BRIDGE_HOLD_MS` = 150ms): `BrandStartup`'s first rendered frame is pixel-identical
   to the native splash — same teal (`#0F7A75`), same mark asset (`splash-icon.png`), same size
   (`ORIGINAL_MARK_SIZE` = 180, matching `app.json`'s `expo-splash-screen.imageWidth` exactly), same
   centered position. `onLayout` fires while this frame is showing, so the native-splash → JS
   handoff is a cut between two visually identical frames — imperceptible, regardless of any native
   compositing timing during the dismissal itself.
2. **Bridge → treatment crossfade** (`BRIDGE_CROSSFADE_MS` = 220ms): the whole surface — background
   and mark together, as two full-`StyleSheet.absoluteFillObject` layers with opposing opacity
   animations, not a color interpolation — crossfades uniformly from the bridge into the resolved
   Light or Dark treatment. Not a "dramatic morph": a restrained, linear opacity fade, matching the
   reduced-motion crossfades already used elsewhere in this file.
3. **Mark → wordmark reveal** (unchanged from the previous cut): `REVEAL_MS` = 1000ms.
4. **Hold** (unchanged): `HOLD_LOCKUP_MS` = 750ms.
5. **Fade out** (unchanged): `FADE_OUT_MS` = 400ms.

New standard-motion total: **2520ms** (was 2400ms, +120ms for the bridge beats — the previous
`HOLD_MARK_MS` hold was folded into/replaced by the bridge hold, not simply added on top).
Reduced motion gets the same bridge beats (necessary handoff infrastructure, not decorative motion,
so not skipped), with its own pre-existing hold trimmed (250ms → 100ms) to keep the net addition
modest: new reduced-motion total **1490ms** (was 1270ms, +220ms).

**Mark-alignment correction**: the mark crops used for the Light/Dark treatments
(`interval-lockup-{light,dark}-mark-only.png`, 262×558) are tightly cropped to the lockup's own
mark column, unlike `splash-icon.png` (1024×1024, heavily padded). Rendered naively at the old
square `MARK_SIZE`, they would both distort (262:558 forced into 1:1) and read far larger than the
bridge frame's own glyph. `MARK_DISPLAY_SCALE` derives a non-square display box
(`MARK_BOX_WIDTH`≈39.52 × `MARK_BOX_HEIGHT`≈84.18) from the measured ink height of the new crop
(550px, alpha>10 scan) against the bridge's own known displayed glyph height (branding manifest's
`measured.glyphBBoxHeightPx`=472, scaled by the original 180/1024 ratio ≈ 82.97pt) — so the
bridge→treatment crossfade holds the glyph's on-screen size and position steady, and only its
color changes.

**Full-screen coverage**: `BrandStartup`'s container and both background layers use
`StyleSheet.absoluteFillObject`; nothing in the ancestor chain (`app/_layout.tsx`'s root `View`)
applies a `SafeAreaView` or other inset, and `app.json` sets `android.edgeToEdgeEnabled: true`. No
JS-level cause for a separate status-bar-region strip was found in this audit — implemented and
architecturally sound, but not independently re-verified against a live simulator by this batch
(no simulator access here); flagged for founder re-confirmation, not falsely claimed as verified.

## 13. Native/system integration

- **Status bar** — `app/_layout.tsx` sets `<StatusBar style={resolvedTheme === "dark" ? "light" :
  "dark"} />`, reading the exact same canonical `resolvedTheme` that `BrandStartup` derives its own
  treatment from (via `useTheme()`) — the two can no longer disagree by construction, closing the
  specific "Theme Lab vs. startup" class of bug this batch fixes. Status-bar content stays legible
  against the resolved theme's canvas color in all three themes (Warm and Light both get dark
  status-bar content; Dark gets light content).
- **Stack background** — the root `<Stack>`'s `contentStyle.backgroundColor` and the outer
  container both use `colors.canvas`, so the brief background flash during screen-to-screen
  navigation transitions matches the resolved theme instead of defaulting to white.
- **System mode live updates** — sourced from the canonical store's own module-level
  `Appearance.addChangeListener` subscription (established once, at import time), not a
  per-component `useColorScheme()` call: every `useTheme()`/`useAppearanceState()` consumer
  re-renders when the OS appearance changes while the app is foregrounded, including Theme Lab and
  the new diagnostics panel, since they all read the same store.
- **Backgrounded → foregrounded OS change** — not independently verified against a live simulator
  in this batch (no simulator access here). Architecturally, `Appearance.addChangeListener` is
  documented by React Native to fire for OS appearance changes regardless of foreground state, and
  the canonical store has no separate "was backgrounded" logic that could suppress or stale-cache an
  update — but this specific scenario should still get an explicit founder QA pass, not just be
  assumed correct from the architecture.
- **Explicit modes ignore later system changes** — verified via `resolveAppearance()`'s logic:
  `selectedMode === "light" | "dark" | "warm"` short-circuits and returns that mode directly, never
  consulting `systemScheme` at all — even though `systemScheme` itself keeps updating live in the
  background.
- Keyboard appearance, cursor/selection tint, and modal-presentation background color were not
  individually audited component-by-component in this batch — `TextField.tsx` was migrated to
  theme-aware `inputBackground`/`inputBorder`/`placeholder`, but React Native's native keyboard
  chrome (the keyboard itself, not the input field) does not currently read `keyboardAppearance`
  from theme state. Flagged as a follow-up, not fixed here.

## 14. Out of scope for this batch (explicitly)

- AWS/DynamoDB sync of the appearance preference — device-local only, via AsyncStorage. Syncing it
  cross-device would be a small, separate addition (one more field alongside the existing
  device-scoped preferences) but was explicitly excluded from this batch.
- Any change to Cognito.
- Any change to the branding repository (`interval-brand-assets`).
- A full crossfade/animated theme transition (see §11).
- A large UI-framework conversion — this batch is additive theming on top of the existing
  component set, not a rewrite.

## 15. Founder QA record

Manually verified by the founder on the native iOS Simulator. This is the authoritative record of
what has actually been confirmed working, as distinct from what this batch's own reasoning/code
audit believes should work.

**PASSED — founder-confirmed:**
- Settings → Light changes the production app to Light.
- Settings → Dark changes the production app to Dark.
- Settings → Warm changes the production app to Warm.
- Settings → System follows simulator Light mode.
- Settings → System follows simulator Dark mode.
- Light runtime startup animation works.
- Dark runtime startup animation works.
- Production navigation and screens inherit the selected appearance.
- Dark remains premium and intentionally designed.
- Warm remains calm and not excessively yellow.
- Theme Lab preview-only behavior is now understood and clearly labeled.
- Core app data remains available.
- Previously reviewed sync and Recently Deleted behavior remain intact.

**PENDING — not yet founder-confirmed, do not treat as passed:**
- Reduced-motion Light startup.
- Reduced-motion Dark startup.
- Compact-device startup geometry (e.g. smaller iPhone screens).
- Pro Max-class startup geometry.
- Full sign-in/sign-out regression pass.
- Deep-link regression pass.
- Exhaustive offline regression pass.
- Adaptive native splash behavior (a separate, later enhancement — see the adaptive-native-splash
  work tracked outside this document once it exists).

**Known remaining visual concern, reclassified:** the universal teal native splash (fixed, cannot
read AsyncStorage before JS starts — see §12) can produce a noticeable contrast change or brief
flash before the Light or Dark runtime treatment takes over. This is now categorized as
**launch-polish work**, not an appearance-state correctness failure — the underlying state system
(selected mode, resolved theme, startup treatment selection) is founder-confirmed correct; what
remains is refining the visual handoff itself.
