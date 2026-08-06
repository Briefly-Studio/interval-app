# Branch and Release Policy

This document is the current, active policy for how work moves between branches in this
repository. It reflects a real decision the founder made, not a proposal.

## Current state

- **`v3.0-dev` is frozen** at commit `2eab4447e728c990cf450582e73a090841b1bfbc`. This is the
  approved, founder-tested V3 Release Candidate checkpoint.
- **`v3.0-rc1`** is the immutable tag for that exact commit — the known-good reference point if
  anything ever needs to be compared against, or built from, "the last confirmed-stable state."
- **`v3.1-dev`** is the active feature-development branch, created from the same commit
  (`2eab4447e728c990cf450582e73a090841b1bfbc`) so it starts from an identical, already-verified
  base.

## What happens where

- Accessibility work, in-app documentation, the future Library area, document intake, voice/audio
  intake, AI foundations, and additional study modalities all continue on `v3.1-dev`.
- `v3.0-dev` receives no new feature work. It exists to represent "the state that was tested and
  approved," not to keep evolving.

## Hotfixes

If an emergency fix is ever needed against the frozen release candidate (not against whatever
`v3.1-dev` has become by then):

1. Branch from the frozen commit (`2eab4447e728c990cf450582e73a090841b1bfbc`, or the `v3.0-rc1`
   tag) — not from `v3.1-dev`, which may already contain unrelated in-progress work.
2. Make the minimal fix on that dedicated hotfix branch.
3. The fix must later be reconciled into `v3.1-dev` as well, so `v3.1-dev` doesn't silently
   regress past a bug that was already fixed once.

## Merge discipline

No feature is merged into a release branch without founder QA and validation. This applies
regardless of how confident the implementation looks from code review or automated checks alone —
this repository does not yet have an automated test suite, so founder verification is the actual
safety net, not a formality on top of one.

## Backend environments

Backend environment separation (e.g. distinct staging/production AWS resources) is **planned**
before any third-party or persistent-data QA that would need it — it is **not implemented yet**.
Do not treat this repository, its documentation, or any future reference to "staging" or
"production" as evidence that separate environments already exist. As of this document, Interval
has the single AWS environment described in `CLAUDE.md`'s "AWS Resources" section, and nothing
else.
