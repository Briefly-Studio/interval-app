import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "./types";
import type { SourceType } from "../../models/librarySource";

// Audio sources carry no extractable text in this batch — no transcription. `durationSeconds` is
// copied ONLY from already-known LibrarySourceRecord.audioDuration metadata (see the caller,
// normalizeSource.ts) — this adapter never decodes, probes, or otherwise inspects audio bytes to
// derive it. See docs/source-normalization-foundation.md's "Future image/audio adapters" section
// for the deferred timestamped-transcript-chunk boundary this leaves room for
// (ChunkProvenance.timeRangeMs already exists on the shared type for exactly that future adapter
// to populate — unused by anything in this batch).
export type AudioAdapterInput = {
  sourceId: string;
  sourceType: SourceType;
  title: string;
  originalName?: string;
  language?: string;
  byteSize?: number;
  durationSeconds?: number;
};

export function normalizeAudioSource(input: AudioAdapterInput): { status: "unsupported"; content: NormalizedSourceContent } {
  return {
    status: "unsupported",
    content: {
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      title: input.title,
      originalName: input.originalName,
      language: input.language,
      contentKind: "audio",
      chunks: [],
      metadata: { byteSize: input.byteSize, durationSeconds: input.durationSeconds },
      extraction: { status: "unsupported", adapter: "audio-metadata-v1", reason: "no-transcription-in-this-batch" },
      normalizationVersion: NORMALIZATION_VERSION,
    },
  };
}
