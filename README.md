> This README describes the app's original MVP shape and is not kept fully current. For the
> accurate, up-to-date architecture, platform support, and technical-debt status, see
> [`CLAUDE.md`](./CLAUDE.md) and [`docs/`](./docs) (in particular `docs/platform-scope.md` and
> `docs/sync-invariants.md`). The project was renamed from Briefly to Interval; production UI now
> says Interval throughout, legacy `.briefly` deck files remain fully importable, and a few
> internal-only identifiers (storage keys, filenames, comments) still reference the old name
> intentionally — see `CLAUDE.md`'s "Legacy Briefly identifiers" section before renaming any of
> them.

# Interval — Flashcards + Review + Quiz (Expo Router + AsyncStorage)

Interval is an offline-first mobile flashcard app built with **Expo (React Native)** using
**file-based routing (expo-router)** and **local persistence (AsyncStorage)**, with optional
Cognito-authenticated cloud backup and multi-device sync. Users can create decks, add/edit/delete
cards, review cards in flip mode, and take a multiple-choice quiz with a results screen — fully
usable without an account (see `CLAUDE.md`'s Core Product Rule).

This project focuses on clean, scalable architecture: separation of concerns between UI routes and
storage utilities, and safe (soft-delete/tombstone) deletion behavior to prevent orphaned data.

---

## Features

### Decks
- Create decks
- View all decks
- Delete decks (with cascade deletion for cards)

### Cards
- Add cards to a deck
- View cards inside a deck
- Edit a card
- Delete a card (long-press behavior supported in the deck list)

### Review Mode
- Flip card (front/back)
- Next card navigation
- Progress indicator

### Quiz Mode
- Multiple-choice quiz generated from deck cards
- Progress indicator
- Correct/incorrect feedback
- Quiz results screen
- Retry quiz
- Return back to deck

---

## Tech Stack

- **Expo + React Native** (iOS-first for the current beta; Android buildable — see
  `docs/platform-scope.md`)
- **expo-router** (file-based routing)
- **AsyncStorage** for local persistence, **Expo SecureStore** for tokens/device ID (native only)
- **AWS Cognito** for authentication, **API Gateway + Lambda + DynamoDB** for sync (see `CLAUDE.md`)
- Localization (English/Spanish) and a canonical light/dark/warm appearance system
- TypeScript

---

## Project Structure

This section previously carried an inline file tree that drifted out of date. For the current,
accurate route inventory and module map, see `CLAUDE.md`'s architecture notes and browse `app/`
and `src/` directly — both are organized by feature (deck/card/session screens under `app/`,
storage/sync/auth/theme/i18n under `src/`).
