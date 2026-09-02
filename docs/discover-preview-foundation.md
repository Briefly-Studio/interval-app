# Discover Preview Foundation

**Status: the preview shell is implemented, founder runtime QA verified, and integrated into
`v3.2-dev`.** It is fixture/local-only — 10 built-in English lessons, a 7-lesson session budget,
local bookmarks and per-workspace progress (`interval.discoverProgress.v1`), no AI, no network,
no content backend, no cost. It is **not wired into sync** (progress is local-only everywhere).
It currently has **no `INTERVAL_ENV` gate**, so it is visible in a Production build — whether it
should ship visible in Production is a **founder product decision that is still pending**.
Generate-from-Discover is deliberately disabled ("coming soon"). Everything below still
describes the intended full product direction, not additional shipped behavior.

Discover is a future Interval product pillar for the moment when a learner says, "I want to learn something new." It complements the existing Library and Deck flows, which begin from material the learner already has.

The intended loop is:

1. Discover
2. Learn
3. Save
4. Study
5. Retain

This foundation is a preview shell only. It demonstrates the shape of bounded microlearning without introducing AI generation, recommendations, server pagination, Atlas, or any backend dependency.

## Bounded Discovery

Discover may use familiar vertical browsing mechanics, but it must not behave like an unlimited entertainment feed. The preview exposes a finite session budget of 7 lessons from a local fixture set of 10 lessons.

When the learner completes the configured budget, the feed stops and shows a calm completion message. There is no infinite scroll, no refresh reward, no countdown urgency, no streak pressure, and no autoplay media.

## Lesson Contract

Discover lessons use a stable local contract:

```ts
type DiscoverLesson = {
  id: string;
  title: string;
  category: DiscoverCategory;
  estimatedMinutes: number;
  hook: string;
  contentLanguage: "en";
  sections: DiscoverLessonSection[];
  keyTakeaway: string;
  relatedTopics?: string[];
  sourceNote?: string;
};
```

`contentLanguage` is explicit because the preview lesson bodies are English-only. UI chrome is localized, but the lesson content is not presented as translated.

## Feed Model

The feed renders `visibleDiscoverLessons(provider.listLessons(), DISCOVER_PREVIEW_BUDGET)`, which slices the provider output to the configured limit. There is no network loading path and no pagination continuation.

Progress records:

- viewed lesson ids
- completed lesson ids
- saved lesson ids

This state is scoped to the active guest or signed-in workspace with the same local partitioning model used elsewhere in Interval.

## Stopping Model

The session is complete when completed lessons reach the configured lesson limit. The UI then replaces the feed with a completion card that summarizes completed lessons, estimated minutes, and saved lessons.

The completion card sends learners back toward study instead of encouraging more scrolling.

## Local Fixture Provider

`LocalDiscoverFixtureProvider` is the only provider today. It serves original, curated preview lessons from repository fixtures.

The app code depends on the `DiscoverContentProvider` interface, so a future backend or AI-assisted content service can replace the fixture provider without rewriting the feed and reader surfaces.

## Save Behavior

Saving a Discover lesson is a local Discover bookmark. It does not create a Library source and does not create a fake file-backed source record.

Future Library integration should introduce a clean knowledge-content entity or an explicit generated/curated lesson source type before saved Discover content appears in Library.

## Study Boundary

The lesson reader includes a disabled "Generate study deck (Coming soon)" action. It is intentionally not functional and does not fake deck generation.

## Future Personalization

The current model leaves room for interests, categories, difficulty, related topics, learning history, and future discovery windows. This preview does not implement recommendation algorithms or upload user interests.

## Atlas Boundary

Atlas remains a future connected-knowledge exploration concept. Discover lessons expose `relatedTopics` so future navigation can grow from the model, but this preview does not implement Atlas.

## Privacy And Backend Boundary

Discover preview is local/static:

- no new network request
- no analytics SDK
- no telemetry backend
- no AWS changes
- no CDK, DynamoDB, S3, API Gateway, or environment mutation
- no AI/model API import

## Intentionally Not Implemented

- AI-generated lessons
- personalized recommendations
- production content backend
- infinite pagination
- embeddings
- knowledge graph
- Atlas
- AI Tutor
- fake deck generation
- cloud sync for Discover progress

