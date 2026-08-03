# Theme Lab — manual review status

Internal review record for the Theme Lab exploration (`app/theme-lab.tsx`,
`src/devTools/themeLab/`). Not automated test output — there is no automated test suite for this
feature. Updated as founder review proceeds; do not mark an item passed here without an actual
observed review.

## Founder review — iPhone 17 Simulator

### PASSED

- Light theme feels recognizably Interval.
- Dark theme feels designed, not inverted.
- Warm theme feels calm and warm, not yellow, mustard, sepia, or parchment.
- Text is readable in the reviewed sections.
- Cards remain distinct from the canvas.
- Buttons remain clearly actionable.
- Status colors remain understandable.
- Selected states do not rely only on color.
- Theme picker looks production-worthy in concept.
- Light system appearance resolves correctly.
- iPhone 17 Simulator layout looks solid.
- Top safe-area/header presentation is fixed and approved. Back arrow, title, clock, and Dynamic
  Island no longer overlap. (Previously "IMPLEMENTED — AWAITING FOUNDER VISUAL CONFIRMATION";
  confirmed passed by founder review.)
- No impact to account data observed.
- No impact to sync observed.
- No impact to ordinary production navigation observed.
- No impact to startup animation observed.
- No AWS changes.
- No production appearance preference persisted during the lab.

### PENDING (unverified — do not mark passed)

- Compact iPhone layout.
- Pro Max-class layout.
- Dark system appearance resolving automatically.
- Reduced-motion behavior for any new theme transitions.
- Full visual review of every production screen in every theme.
