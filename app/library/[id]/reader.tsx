import Pdf from "react-native-pdf";
import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from "react-native";

import { AuthService } from "../../../src/auth/AuthService";
import {
  openSourceOriginal,
  resolveSourceOriginal,
  type OpenSourceErrorReason,
  type OpenSourceStage,
} from "../../../src/cloud/librarySourceStorage/openSource";
import { prepareViewerInput } from "../../../src/domain/sourceViewer";
import {
  AUDIO_PLAYBACK_RATES,
  clampPlaybackPosition,
  formatPlaybackTime,
  isPlaybackComplete,
  playbackProgress,
  type AudioPlaybackRate,
} from "../../../src/domain/sourceAudioPlayer";
import { chunkTextReaderContent, inspectTextReaderFile } from "../../../src/domain/sourceReaderText";
import { readDocxArchive, type DocxMedia } from "../../../src/domain/sourceReaderDocx";
import type { DocxBlock, DocxRun } from "../../../src/domain/docxContent";
import { computeDocxTableLayout } from "../../../src/domain/docxTableLayout";
import { resolveSourceReaderStrategy, type SourceReaderStrategy } from "../../../src/domain/sourceReader";
import { useTranslation } from "../../../src/i18n";
import { useLayoutDirection } from "../../../src/i18n/direction";
import type { LibrarySourceRecord } from "../../../src/models/librarySource";
import { getLibrarySources } from "../../../src/storage/librarySources";
import { Button } from "../../../src/ui/Button";
import { IconButton } from "../../../src/ui/IconButton";
import { Screen } from "../../../src/ui/Screen";
import { useTheme } from "@/src/theme";

// Full Source Reader — the complete-consumption counterpart to Quick Preview
// (app/library/[id]/preview.tsx). The two screens deliberately share plumbing (source
// resolution, viewer-input preparation, Open Original) but stay separate concepts and separate
// routes:
//   Quick Preview  — fast, bounded glance; may impose size/rendering limits (e.g. the 1 MB text
//                    threshold in src/domain/sourcePreviewText.ts, unchanged by this file).
//   Full Reader    — actual consumption of the complete supported source; no artificial
//                    page-count or content-length limit; the format-specific renderers below are
//                    built to stay responsive at realistic book/chapter-sized documents.
// Open Original remains the interoperability escape hatch, available from both screens and this
// one, never the primary/required path.
//
// PDF: reuses `Pdf` from `react-native-pdf` exactly as Quick Preview does. No custom page
// virtualization is implemented here because react-native-pdf's native view (PDFKit on iOS,
// PdfRenderer on Android) already manages page rendering natively — it does not rasterize the
// entire document into JS/React memory up front, only the visible and nearby pages. Investigated
// before writing any of this file; see PDF Reader section of the mission report for the record.
//
// Text: see src/domain/sourceReaderText.ts's header comment for the exact, honestly-documented
// large-file strategy (whole-file read, chunked + FlatList-virtualized render — not a streaming
// or ranged read).
//
// Audio: uses expo-audio's native AudioPlayer against a local file URI. The route still uses the
// same local-first/cloud-fallback resolver as every other Reader/Open Original path, but current
// backend upload allow-lists intentionally do not accept audio originals, so cross-device audio
// playback remains limited until that separately gated backend contract changes.
//
// DOCX: see src/domain/sourceReaderDocx.ts and src/domain/docxContent.ts for the full parsing
// and security model. Rendering here follows the same block-level-not-per-word discipline as the
// text reader: each paragraph/heading/list-item/table-row/image is exactly one FlatList item, so
// a long document's native view count stays bounded by what's actually visible, never by its
// total word count. Bold/italic runs within a single paragraph are nested <Text> spans (RN's
// standard mixed-formatting pattern) — cheap, and bounded by a paragraph's actual run count
// (typically single digits), not by every individual word.

type ReaderStatus = "resolving" | "loading" | "ready" | "empty" | "too-large" | "unsupported" | "failed";
type EmbeddedReaderKind = Exclude<SourceReaderStrategy["kind"], "unsupported">;

// docxContent.ts emits every table row as its own top-level block. For rendering we re-group each
// maximal run of consecutive rows into ONE "table" block so the whole table shares a single set
// of column widths and a single horizontal-scroll offset (see the table branch of
// `renderDocxBlock` and src/domain/docxTableLayout.ts). Non-table blocks pass through untouched
// and stay individually FlatList-virtualized; only a table's own rows render together. That
// grouping is bounded by docxContent.ts's `MAX_BLOCKS` document-wide ceiling — a document large
// enough to make one un-virtualized table a problem is already rejected upstream as "too-large".
type DocxRenderBlock = Exclude<DocxBlock, { kind: "tableRow" }> | { kind: "table"; rows: DocxRun[][][] };

function coalesceDocxTableRows(blocks: DocxBlock[]): DocxRenderBlock[] {
  const out: DocxRenderBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "tableRow") {
      out.push(block);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === "table") {
      last.rows.push(block.cells);
    } else {
      out.push({ kind: "table", rows: [block.cells] });
    }
  }
  return out;
}

const DOCX_MEDIA_DIR_NAME = "librarySourceReaderDocxMedia";
const SAFE_MEDIA_EXTENSION = /^[a-z0-9]{1,10}$/;

/**
 * Persists one extracted DOCX image to a disposable Cache-directory location so `expo-image` has
 * a real `file://` URI to render — never the canonical durable source file, never synced, safe
 * for the OS to purge. Scoped per source id and cleared on every load, so repeated opens/retries
 * never accumulate stale copies from a previous read of the same (or a different) document.
 */
function writeDocxMediaFile(sourceId: string, relationshipId: string, media: DocxMedia): string | null {
  try {
    const safeId = /^[a-zA-Z0-9_-]{1,64}$/.test(relationshipId) ? relationshipId : "media";
    const extension = SAFE_MEDIA_EXTENSION.test(media.extension) ? media.extension : "png";
    const dir = new Directory(Paths.cache, DOCX_MEDIA_DIR_NAME, sourceId);
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${safeId}.${extension}`);
    if (dest.exists) dest.delete();
    dest.write(media.bytes);
    return dest.exists ? dest.uri : null;
  } catch {
    return null;
  }
}

function clearDocxMediaDir(sourceId: string): void {
  try {
    const dir = new Directory(Paths.cache, DOCX_MEDIA_DIR_NAME, sourceId);
    if (dir.exists) dir.delete();
  } catch {
    // Best-effort cleanup only — a stray cache directory left behind is not user-visible and the
    // OS is free to purge Caches at any time regardless.
  }
}

function logSourceReader(stage: string, detail?: Record<string, unknown>): void {
  if (!__DEV__) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log(`[LibrarySourceReader] ${stage}`, detail);
  } else {
    console.log(`[LibrarySourceReader] ${stage}`);
  }
}

// Sanitized diagnostic only — see this app's Dev Tools diagnostics guardrail (CLAUDE.md). Never
// logs source contents, a signed URL, or a full filesystem path.
function safeErrorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function uriScheme(uri: string): string {
  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  return match ? `${match[1]}://` : "unknown";
}

function inspectLocalFile(uri: string): { exists: boolean; size?: number } {
  try {
    const file = new File(uri);
    return file.exists ? { exists: true, size: file.size } : { exists: false };
  } catch (error) {
    logSourceReader("file inspect failed", { error: safeErrorDetail(error) });
    return { exists: false };
  }
}

function AudioPlayerView({
  uri,
  title,
  onFailed,
}: {
  uri: string;
  title: string;
  onFailed: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const { colors, iconSizes, radii, spacing, typography, touchTarget } = useTheme();
  const { row, text } = useLayoutDirection();
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const audioStatus = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<AudioPlaybackRate>(1);
  const [trackWidth, setTrackWidth] = useState(0);

  const duration = Number.isFinite(audioStatus.duration) && audioStatus.duration > 0 ? audioStatus.duration : 0;
  const currentTime = clampPlaybackPosition(audioStatus.currentTime, duration);
  const complete = isPlaybackComplete(audioStatus);
  const progress = playbackProgress(currentTime, duration);
  const canSeek = audioStatus.isLoaded && duration > 0;
  const stateLabel = audioStatus.isBuffering
    ? t("librarySource.reader.audioBuffering")
    : complete
      ? t("librarySource.reader.audioEnded")
      : audioStatus.playing
        ? t("librarySource.reader.audioPlaying")
        : audioStatus.isLoaded
          ? t("librarySource.reader.audioPaused")
          : t("librarySource.reader.loadingAudio");

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch((error) => {
      logSourceReader("audio mode setup failed", { error: safeErrorDetail(error) });
    });
  }, []);

  useEffect(() => {
    return () => {
      try {
        player.pause();
        player.clearLockScreenControls();
      } catch {
        // Best-effort cleanup; useAudioPlayer releases the native player when this component
        // unmounts, so a cleanup exception here is not actionable for the user.
      }
    };
  }, [player]);

  const seekTo = useCallback(
    async (seconds: number) => {
      if (!canSeek) return;
      try {
        await player.seekTo(clampPlaybackPosition(seconds, duration));
      } catch (error) {
        logSourceReader("audio seek failed", { error: safeErrorDetail(error) });
        onFailed(error);
      }
    },
    [canSeek, duration, onFailed, player]
  );

  const seekFromEvent = useCallback(
    (event: GestureResponderEvent) => {
      if (!canSeek || trackWidth <= 0) return;
      const pct = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
      seekTo(pct * duration);
    },
    [canSeek, duration, seekTo, trackWidth]
  );

  const onPlayPause = async () => {
    if (!audioStatus.isLoaded) return;
    try {
      if (complete) {
        await player.seekTo(0);
        player.play();
        return;
      }
      if (audioStatus.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (error) {
      logSourceReader("audio play/pause failed", { error: safeErrorDetail(error) });
      onFailed(error);
    }
  };

  const onSpeed = (nextSpeed: AudioPlaybackRate) => {
    try {
      player.setPlaybackRate(nextSpeed);
      setSpeed(nextSpeed);
    } catch (error) {
      logSourceReader("audio rate failed", { error: safeErrorDetail(error) });
      onFailed(error);
    }
  };

  const timeLabel = useMemo(
    () => `${formatPlaybackTime(currentTime)} / ${duration > 0 ? formatPlaybackTime(duration) : "--:--"}`,
    [currentTime, duration]
  );

  return (
    <View style={[styles.audioPanel, { gap: spacing.lg, padding: spacing.lg }]}>
      <View style={[styles.audioArtwork, { borderRadius: radii.lg, backgroundColor: colors.accentSubtle }]}>
        <Ionicons name="musical-notes" size={48} color={colors.accent} importantForAccessibility="no" />
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text style={[typography.subheading, text, { color: colors.textPrimary }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]} accessibilityLiveRegion="polite">
          {stateLabel}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <View
          style={[styles.progressTrack, { borderRadius: radii.pill, backgroundColor: colors.surfaceMuted }]}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => canSeek}
          onResponderGrant={seekFromEvent}
          onResponderMove={seekFromEvent}
          accessibilityRole="adjustable"
          accessibilityLabel={t("librarySource.reader.seekLabel")}
          accessibilityValue={{
            min: 0,
            max: Math.max(0, Math.round(duration)),
            now: Math.round(currentTime),
            text: timeLabel,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => {
            const delta = event.nativeEvent.actionName === "increment" ? 15 : -15;
            seekTo(currentTime + delta);
          }}
        >
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, borderRadius: radii.pill, backgroundColor: colors.accent },
            ]}
          />
        </View>
        <View style={styles.mediaTimeRow}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{formatPlaybackTime(currentTime)}</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{duration > 0 ? formatPlaybackTime(duration) : "--:--"}</Text>
        </View>
      </View>

      <View style={[styles.transportRow, row, { gap: spacing.md }]}>
        <Pressable
          onPress={() => seekTo(currentTime - 15)}
          disabled={!canSeek}
          accessibilityRole="button"
          accessibilityLabel={t("librarySource.reader.seekBackwardLabel")}
          style={({ pressed }) => [
            styles.transportButton,
            { width: touchTarget.min, height: touchTarget.min, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
            pressed && styles.pressed,
            !canSeek && styles.disabled,
          ]}
        >
          <Ionicons name="play-back" size={iconSizes.md} color={colors.textPrimary} />
        </Pressable>

        <Pressable
          onPress={onPlayPause}
          disabled={!audioStatus.isLoaded}
          accessibilityRole="button"
          accessibilityLabel={
            complete
              ? t("librarySource.reader.replayAudio")
              : audioStatus.playing
                ? t("librarySource.reader.pauseAudio")
                : t("librarySource.reader.playAudio")
          }
          style={({ pressed }) => [
            styles.playButton,
            { width: 72, height: 72, borderRadius: radii.pill, backgroundColor: colors.accent },
            pressed && styles.pressed,
            !audioStatus.isLoaded && styles.disabled,
          ]}
        >
          <Ionicons
            name={complete ? "refresh" : audioStatus.playing ? "pause" : "play"}
            size={32}
            color={colors.onAccent}
            style={!audioStatus.playing && !complete ? styles.playIconNudge : undefined}
          />
        </Pressable>

        <Pressable
          onPress={() => seekTo(currentTime + 15)}
          disabled={!canSeek}
          accessibilityRole="button"
          accessibilityLabel={t("librarySource.reader.seekForwardLabel")}
          style={({ pressed }) => [
            styles.transportButton,
            { width: touchTarget.min, height: touchTarget.min, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted },
            pressed && styles.pressed,
            !canSeek && styles.disabled,
          ]}
        >
          <Ionicons name="play-forward" size={iconSizes.md} color={colors.textPrimary} />
        </Pressable>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.caption, text, { color: colors.textSecondary }]}>
          {t("librarySource.reader.playbackSpeed")}
        </Text>
        <View style={[styles.speedRow, row, { gap: spacing.xs }]}>
          {AUDIO_PLAYBACK_RATES.map((rate) => {
            const selected = speed === rate;
            return (
              <Pressable
                key={rate}
                onPress={() => onSpeed(rate)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={t("librarySource.reader.playbackSpeedOption", { speed: rate })}
                style={({ pressed }) => [
                  styles.speedButton,
                  {
                    minHeight: touchTarget.min,
                    borderRadius: radii.pill,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSubtle : colors.surface,
                    paddingHorizontal: spacing.md,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[typography.label, { color: selected ? colors.accent : colors.textPrimary }]}>
                  {rate}x
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function openFailedBodyKey(reason: OpenSourceErrorReason): string {
  switch (reason) {
    case "offline-no-local":
      return "librarySource.detail.openFailedOfflineBody";
    case "access-denied":
      return "librarySource.detail.openFailedAccessDeniedBody";
    case "not-found":
      return "librarySource.detail.openFailedNotFoundBody";
    case "download-failed":
      return "librarySource.detail.openFailedDownloadBody";
    case "unsupported-viewer":
      return "librarySource.detail.openFailedUnsupportedBody";
    case "handoff-failed":
      return "librarySource.detail.openFailedHandoffBody";
    case "unavailable":
    default:
      return "librarySource.detail.openFailedGenericBody";
  }
}

export default function LibrarySourceReaderScreen() {
  const router = useRouter();
  const { t, plural } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  // `row`/`text` style the app's own Reader chrome (header, footer, status copy) per the active
  // UI locale's direction. Deliberately NEVER applied to the rendered document text chunks below
  // (`renderTextChunk`) — a source's own content must never be forced into the UI locale's
  // direction (e.g. Arabic UI + an English .txt source must keep that English text naturally
  // left-aligned, not right-aligned just because the chrome around it is RTL).
  const { row, text } = useLayoutDirection();
  const params = useLocalSearchParams();
  const idParam = params.id;
  const id = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : "";

  const [source, setSource] = useState<LibrarySourceRecord | null>(null);
  const [readerUri, setReaderUri] = useState<string | null>(null);
  const [readerKind, setReaderKind] = useState<EmbeddedReaderKind | null>(null);
  const [textChunks, setTextChunks] = useState<string[]>([]);
  const [docxBlocks, setDocxBlocks] = useState<DocxBlock[]>([]);
  const [docxMediaUris, setDocxMediaUris] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<ReaderStatus>("resolving");
  const [stage, setStage] = useState<Exclude<OpenSourceStage, "opening">>("resolving");
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  // Actual on-screen width of the DOCX list, captured on layout — the reference width the table
  // renderer sizes columns against. Falls back to the window width until the first layout pass.
  const [docxListWidth, setDocxListWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();

  // Consecutive DOCX table rows are grouped into single table blocks; see `coalesceDocxTableRows`.
  const docxRenderBlocks = useMemo(() => coalesceDocxTableRows(docxBlocks), [docxBlocks]);
  // Width available to a table = the list's inner width minus the FlatList content padding.
  const docxTableViewport = Math.max(0, (docxListWidth || windowWidth) - spacing.md * 2);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/library/[id]" as any, params: { id } });
  }, [id, router]);

  const load = useCallback(async () => {
    if (!id) {
      setStatus("failed");
      return;
    }

    setStatus("resolving");
    setStage("resolving");
    setPageLabel(null);
    setReaderUri(null);
    setReaderKind(null);
    setTextChunks([]);
    setDocxBlocks([]);
    setDocxMediaUris(new Map());
    clearDocxMediaDir(id);

    const scope = await AuthService.getActiveScope();
    const sources = await getLibrarySources(scope);
    const found = sources.find((item) => item.id === id) ?? null;
    setSource(found);

    const strategy = found ? resolveSourceReaderStrategy(found) : { kind: "unsupported" as const };
    if (!found || strategy.kind === "unsupported") {
      setStatus("unsupported");
      return;
    }

    setStatus("loading");
    const resolved = await resolveSourceOriginal(found, setStage);
    if (resolved.status === "error") {
      setStatus("failed");
      return;
    }

    const input = await prepareViewerInput(resolved.uri, found);
    const file = inspectLocalFile(input.uri);
    logSourceReader("prepared input", {
      sourceType: found.sourceType,
      strategy: strategy.kind,
      uriScheme: uriScheme(input.uri),
      usedStagedCopy: input.usedStagedCopy,
      extension: input.extension,
      exists: file.exists,
      size: file.size,
    });
    if (!input.usedStagedCopy || !input.extension || !file.exists || file.size === undefined) {
      setStatus("failed");
      return;
    }
    if (strategy.kind !== "text-reader" && file.size <= 0) {
      setStatus("failed");
      return;
    }

    if (strategy.kind === "text-reader") {
      const inspection = inspectTextReaderFile(file);
      if (inspection.status !== "readable") {
        // "missing" and the 25 MB device-memory safety ceiling ("too-large") both surface as the
        // same generic failed state — Reader deliberately does not promote a distinct
        // product-facing "too large" concept the way Quick Preview does (see
        // src/domain/sourceReaderText.ts's header comment).
        setStatus("failed");
        return;
      }
      try {
        const text = await new File(input.uri).text();
        const chunks = chunkTextReaderContent(text);
        setTextChunks(chunks);
        if (chunks.length === 0) {
          setReaderUri(input.uri);
          setReaderKind(strategy.kind);
          setStatus("empty");
          return;
        }
      } catch (error) {
        logSourceReader("text read failed", { error: safeErrorDetail(error) });
        setStatus("failed");
        return;
      }
    }

    if (strategy.kind === "docx-reader") {
      let archiveBytes: Uint8Array;
      try {
        archiveBytes = await new File(input.uri).bytes();
      } catch (error) {
        logSourceReader("docx read failed", { error: safeErrorDetail(error) });
        setStatus("failed");
        return;
      }
      const outcome = readDocxArchive(archiveBytes);
      logSourceReader("docx parsed", { status: outcome.status, blocks: outcome.status === "ready" ? outcome.blocks.length : 0 });
      if (outcome.status !== "ready") {
        setStatus(outcome.status);
        return;
      }
      const mediaUris = new Map<string, string>();
      for (const [relationshipId, media] of outcome.mediaByRelationshipId) {
        const uri = writeDocxMediaFile(found.id, relationshipId, media);
        if (uri) mediaUris.set(relationshipId, uri);
      }
      setDocxBlocks(outcome.blocks);
      setDocxMediaUris(mediaUris);
    }

    setReaderUri(input.uri);
    setReaderKind(strategy.kind);
    setStatus("ready");
  }, [id]);

  useEffect(() => {
    let alive = true;
    load().catch(() => {
      if (alive) setStatus("failed");
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const onOpenOriginal = async () => {
    if (!source || openingOriginal) return;
    setOpeningOriginal(true);
    try {
      const outcome = await openSourceOriginal(source);
      if (outcome.status === "error") {
        Alert.alert(t("librarySource.detail.openFailedTitle"), t(openFailedBodyKey(outcome.reason) as any));
      }
    } finally {
      setOpeningOriginal(false);
    }
  };

  const loadingText =
    stage === "downloading" ? t("librarySource.preview.downloading") : t("librarySource.reader.loading");

  const renderTextChunk = useCallback(
    ({ item }: { item: string }) => (
      <Text style={[typography.body, styles.readerText, { color: colors.textPrimary }]}>{item}</Text>
    ),
    [typography, colors]
  );

  // Runs a paragraph/heading/list-item's DOCX content is deliberately rendered with NO
  // direction/writingDirection styling — same rule as `renderTextChunk` above: a document's own
  // content must never be forced into the UI locale's direction. Bold/italic are nested <Text>
  // spans within the single outer paragraph <Text>, RN's normal mixed-formatting mechanism —
  // bounded by a paragraph's actual run count, not one component per word.
  const renderDocxRuns = useCallback(
    (runs: DocxRun[]) =>
      runs.map((run, index) => (
        <Text key={index} style={[run.bold ? styles.docxBold : null, run.italic ? styles.docxItalic : null]}>
          {run.text}
        </Text>
      )),
    []
  );

  const renderDocxBlock = useCallback(
    ({ item }: { item: DocxRenderBlock }) => {
      if (item.kind === "heading") {
        const headingStyle = item.level === 1 ? typography.heading : item.level === 2 ? typography.subheading : typography.bodyMedium;
        return (
          <Text style={[headingStyle, styles.docxHeading, { color: colors.textPrimary }]} accessibilityRole="header">
            {renderDocxRuns(item.runs)}
          </Text>
        );
      }
      if (item.kind === "listItem") {
        return (
          <View style={[styles.docxListItem, row]}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{"•  "}</Text>
            <Text style={[typography.body, styles.docxListText, { color: colors.textPrimary }]}>{renderDocxRuns(item.runs)}</Text>
          </View>
        );
      }
      if (item.kind === "table") {
        // Column widths come from a single deterministic pass (docxTableLayout.ts): narrow tables
        // fill the viewport evenly with no scroll; wide tables hold a readable minimum per column
        // and become horizontally scrollable rather than squeezing every column to a sliver.
        // `columnCount` is the widest row's cell count so shorter rows still align.
        const columnCount = item.rows.reduce((max, cells) => Math.max(max, cells.length), 0);
        const layout = computeDocxTableLayout(columnCount, docxTableViewport);
        const columnIndexes = Array.from({ length: layout.columnCount }, (_, index) => index);
        const grid = (
          <View style={[styles.docxTable, { width: layout.tableWidth, borderColor: colors.border }]}>
            {item.rows.map((cells, rowIndex) => (
              // Columns render in document (parse) order — NOT `row`/chrome direction. The parser
              // carries no Word table-direction metadata, and forcing document content to follow
              // the UI locale (e.g. reversing an English table under Arabic chrome) is the same
              // thing `renderTextChunk`/`renderDocxRuns` deliberately avoid. Chrome stays RTL.
              <View key={rowIndex} style={styles.docxTableRow}>
                {columnIndexes.map((colIndex) => (
                  <View
                    key={colIndex}
                    style={[styles.docxTableCell, { width: layout.columnWidth, borderColor: colors.border }]}
                  >
                    {/* Real, wrapping text (no numberOfLines) — screen-reader accessible, never clipped. */}
                    <Text style={[typography.secondary, { color: colors.textPrimary }]}>
                      {(cells[colIndex] ?? []).map((run) => run.text).join("")}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        );
        if (!layout.scrollable) {
          return <View style={styles.docxTableBlock}>{grid}</View>;
        }
        // A horizontal ScrollView nested in the vertical reader FlatList: orthogonal axes, so
        // vertical reading is unaffected and the whole table moves as one under a horizontal swipe.
        return (
          <ScrollView horizontal style={styles.docxTableBlock} showsHorizontalScrollIndicator>
            {grid}
          </ScrollView>
        );
      }
      if (item.kind === "image") {
        const uri = docxMediaUris.get(item.relationshipId);
        // A missing URI means this image was skipped by the media count/size budget (see
        // src/domain/sourceReaderDocx.ts) or failed to persist — the document's text still reads
        // fine without it, so it's simply omitted rather than shown as a broken-image icon.
        if (!uri) return null;
        return <Image source={{ uri }} style={styles.docxImage} contentFit="contain" />;
      }
      return (
        <Text style={[typography.body, styles.docxParagraph, { color: colors.textPrimary }]}>{renderDocxRuns(item.runs)}</Text>
      );
    },
    [typography, colors, row, docxMediaUris, renderDocxRuns, docxTableViewport]
  );

  return (
    <Screen>
      <View style={[styles.container, { gap: spacing.md }]}>
        <View style={[styles.header, row, { gap: spacing.sm }]}>
          <IconButton name="chevron-back" accessibilityLabel={t("common.back")} onPress={goBack} />
          <View style={styles.headerText}>
            <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{t("librarySource.reader.screenLabel")}</Text>
            <Text style={[typography.title, text, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
              {source?.displayTitle ?? t("librarySource.detail.loading")}
            </Text>
          </View>
        </View>

        <View style={[styles.viewer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {status === "resolving" || status === "loading" ? (
            <View style={styles.centered}>
              <Text style={[typography.secondary, text, { color: colors.textSecondary }]}>{loadingText}</Text>
            </View>
          ) : status === "ready" && readerUri ? (
            readerKind === "pdf-reader" ? (
              <Pdf
                source={{ uri: readerUri, cache: false }}
                style={styles.pdf}
                trustAllCerts={false}
                enablePaging={false}
                onLoadComplete={(numberOfPages) => {
                  logSourceReader("pdf load complete", { pages: numberOfPages });
                  setPageLabel(plural("librarySource.preview.pageCount", numberOfPages));
                }}
                onPageChanged={(page, numberOfPages) => {
                  logSourceReader("pdf page changed", { page, pages: numberOfPages });
                  setPageLabel(t("librarySource.preview.pageProgress", { page, count: numberOfPages }));
                }}
                onError={(error) => {
                  logSourceReader("pdf render error", { error: safeErrorDetail(error) });
                  setStatus("failed");
                }}
              />
            ) : readerKind === "image-reader" ? (
              <Image
                source={{ uri: readerUri }}
                style={styles.image}
                contentFit="contain"
                transition={120}
                onLoad={() => {
                  logSourceReader("image load complete", { uriScheme: uriScheme(readerUri) });
                }}
                onError={(error) => {
                  logSourceReader("image render error", { error: safeErrorDetail(error) });
                  setStatus("failed");
                }}
              />
            ) : readerKind === "audio-player" ? (
              <AudioPlayerView
                uri={readerUri}
                title={source?.displayTitle ?? t("librarySource.reader.audioScreenLabel")}
                onFailed={(error) => {
                  logSourceReader("audio playback failed", { error: safeErrorDetail(error) });
                  setStatus("failed");
                }}
              />
            ) : readerKind === "text-reader" ? (
              <FlatList
                data={textChunks}
                renderItem={renderTextChunk}
                keyExtractor={(_, index) => String(index)}
                style={styles.textList}
                contentContainerStyle={{ padding: spacing.md }}
                // Virtualization tuning: only a handful of chunks are ever mounted as native Text
                // nodes at once, regardless of how many chunks a large source produces — this is
                // what keeps a book-sized file from becoming a single giant native view tree.
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={5}
                removeClippedSubviews
              />
            ) : (
              <FlatList
                data={docxRenderBlocks}
                renderItem={renderDocxBlock}
                keyExtractor={(_, index) => String(index)}
                style={styles.textList}
                contentContainerStyle={{ padding: spacing.md }}
                onLayout={(event) => setDocxListWidth(event.nativeEvent.layout.width)}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews
              />
            )
          ) : status === "empty" ? (
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <Text style={[typography.secondary, text, styles.errorText, { color: colors.textSecondary }]}>
                {readerKind === "text-reader" ? t("librarySource.preview.emptyTextBody") : t("librarySource.reader.emptyBody")}
              </Text>
            </View>
          ) : status === "too-large" ? (
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <Text style={[typography.subheading, text, { color: colors.textPrimary }]}>{t("librarySource.reader.tooLargeTitle")}</Text>
              <Text style={[typography.secondary, text, styles.errorText, { color: colors.textSecondary }]}>
                {t("librarySource.reader.tooLargeBody")}
              </Text>
            </View>
          ) : (
            <View style={[styles.centered, { gap: spacing.sm }]}>
              <Text style={[typography.subheading, text, { color: colors.textPrimary }]}>
                {status === "unsupported" ? t("librarySource.reader.unsupportedTitle") : t("librarySource.reader.errorTitle")}
              </Text>
              <Text style={[typography.secondary, text, styles.errorText, { color: colors.textSecondary }]}>
                {status === "unsupported" ? t("librarySource.reader.unsupportedBody") : t("librarySource.reader.errorBody")}
              </Text>
              {status !== "unsupported" ? (
                <Button label={t("librarySource.preview.retryButton")} variant="secondary" onPress={load} />
              ) : null}
            </View>
          )}
        </View>

        <View style={[styles.footer, row, { gap: spacing.sm }]}>
          {pageLabel ? <Text style={[typography.caption, text, { color: colors.textSecondary }]}>{pageLabel}</Text> : <View />}
          {source ? (
            <Button
              label={t("librarySource.detail.openOriginalButton")}
              variant="secondary"
              loading={openingOriginal}
              disabled={openingOriginal}
              onPress={onOpenOriginal}
            />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

// Image full-view: pinch/pan/double-tap zoom is a documented future enhancement — this batch
// ships a clean, correct static full-image view instead. `react-native-gesture-handler` and
// `react-native-reanimated` are both already installed and available for a future zoom
// implementation (no new dependency required), but a correct pinch/pan gesture implementation
// needs real-device tuning that isn't practical to verify confidently without one, so it is
// deliberately deferred rather than shipped unverified — see this file's header comment.

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center" },
  headerText: { flex: 1 },
  viewer: { flex: 1, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  pdf: { flex: 1, width: "100%", height: "100%" },
  image: { flex: 1, width: "100%", height: "100%" },
  textList: { flex: 1 },
  readerText: { lineHeight: 23 },
  audioPanel: { flex: 1, justifyContent: "center" },
  audioArtwork: { alignSelf: "center", width: 128, height: 128, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 12, overflow: "hidden", direction: "ltr" },
  progressFill: { height: "100%" },
  mediaTimeRow: { flexDirection: "row", justifyContent: "space-between" },
  transportRow: { alignItems: "center", justifyContent: "center" },
  transportButton: { alignItems: "center", justifyContent: "center" },
  playButton: { alignItems: "center", justifyContent: "center" },
  playIconNudge: { marginLeft: 3 },
  speedRow: { flexWrap: "wrap" },
  speedButton: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  pressed: { opacity: 0.84 },
  disabled: { opacity: 0.45 },
  docxHeading: { marginBottom: 4, marginTop: 12 },
  docxParagraph: { lineHeight: 23, marginBottom: 12 },
  docxListItem: { alignItems: "flex-start", marginBottom: 8 },
  docxListText: { flex: 1, lineHeight: 23 },
  // One table block: outer margin only. When the table is wider than the viewport this is the
  // horizontal ScrollView's own style; otherwise it wraps the grid directly.
  docxTableBlock: { marginBottom: 12 },
  // The grid gets top+left borders; each cell adds right+bottom — together a full ruled table
  // with a border on every side. Explicit `width` is applied inline from docxTableLayout.ts.
  docxTable: { borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth },
  docxTableRow: { flexDirection: "row", alignItems: "stretch" },
  docxTableCell: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  docxImage: { width: "100%", height: 220, marginBottom: 12 },
  docxBold: { fontWeight: "700" },
  docxItalic: { fontStyle: "italic" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { textAlign: "center" },
  footer: { alignItems: "center", justifyContent: "space-between" },
});
