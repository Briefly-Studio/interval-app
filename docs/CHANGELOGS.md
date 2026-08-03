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