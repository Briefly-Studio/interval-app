## v3.0-dev — Manual QA record: mark-to-wordmark startup animation (2026-08-03)

**Manual iOS Simulator QA — performed 2026-08-03.** Not an automated test; no automated test
suite exists in this repository. Verified via a real native build (`npx expo run:ios`), covering
the animated startup handoff (`BrandStartup`) that replaces the static bridge from the previous
batch: the native teal splash mark translating left into the branded "i" of the "Interval"
wordmark, with the remaining "nterval" letters revealing alongside it.

Founder live QA completed and approved. Confirmed:

- No visible white flash between the native splash and the React Native startup layer
- Native teal splash transitioned smoothly into the React Native startup layer
- The standalone Interval mark remained visually continuous throughout (no swap/disappear)
- The mark moved smoothly and deliberately left, not abruptly
- The remaining "nterval" letters revealed progressively, not all at once
- The movement felt organic and appropriately slow (not rushed, not sluggish)
- Completed wordmark spacing and legibility looked correct
- Final hold and fade into the app felt intentional
- Existing product functionality remained intact: account restoration, sync, Recently Deleted,
  navigation, deck creation, and card creation

Not covered by this pass: Android, multiple device sizes, dark system appearance, reduced-motion
setting. See the corresponding batch report for full scope and known remaining risks.

## v3.0-dev — Manual QA record: native identity + static startup handoff (2026-08-02)

**Manual iOS Simulator QA — performed 2026-08-02.** Not an automated test; no automated test
suite exists in this repository. Verified via a real native build (`npx expo run:ios`), covering
the native release-identity assets (app icon, splash) and the static `BrandStartup` React Native
startup handoff introduced in this batch.

Confirmed working, no functional regression observed:

- Native iOS build completed and launched successfully
- Teal native splash displayed the approved centered white Interval mark
- No Expo project loading screen appeared as the production splash
- Native-splash → React Native handoff appeared visually clean
- App remained responsive and smooth after startup
- Signed-out home screen
- Sign-in flow
- Existing account data synchronized and displayed correctly
- Previously deleted items appeared correctly in Recently Deleted
- Deck creation
- Card creation
- Deck detail and card listing
- Settings screen
- Sync status showed current/up to date
- Sign-out / account functionality

Not covered by this pass: Android, multiple device sizes, dark system appearance, reduced-motion
setting, deep-link cold launch. See the corresponding batch report for the full scope and known
remaining risks.

## v1.5 - In Progress