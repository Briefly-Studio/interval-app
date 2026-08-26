import { MAX_TITLE_LENGTH } from "./responseValidation";
import type { ModelProvider } from "./aiService";

// Development/test-only deterministic provider — requires no network, no credentials, no
// provider SDK. Every card it produces is prefixed "[MOCK]" specifically so nothing downstream
// could ever mistake this for real generated content; this is a pipeline-exercise fixture, not a
// cheap AI feature. See docs/ai-generation-foundation.md's "Mock adapter" section.
//
// Deterministic: for identical (request, context) input, always produces the identical raw
// response — one card per included context chunk (capped at the requested count), each citing
// exactly that chunk's real id, with card front/back derived directly from the chunk's own text
// (never fabricated content unrelated to the supplied source).

export const MOCK_PROVIDER_ID = "mock-v1";

export function createMockProvider(): ModelProvider {
  return {
    id: MOCK_PROVIDER_ID,
    async generate({ request, context }) {
      if (context.chunks.length === 0) {
        return { status: "error", error: { code: "source-empty", message: "No context chunks were supplied to generate from." } };
      }

      const targetCount = Math.min(request.requestedCardCount, context.chunks.length);
      const cards = context.chunks.slice(0, targetCount).map((chunk, index) => {
        const snippet = chunk.text.trim().replace(/\s+/g, " ").slice(0, 160);
        return {
          front: `[MOCK] Card ${index + 1} — what does this excerpt describe?`,
          back: snippet.length > 0 ? snippet : "[MOCK] (this chunk had no extractable text)",
          sourceChunkIds: [chunk.id],
        };
      });

      return {
        status: "ok",
        raw: {
          title: `[MOCK] ${request.sourceTitle}`.slice(0, MAX_TITLE_LENGTH),
          cards,
        },
      };
    },
  };
}
