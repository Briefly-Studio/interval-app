import { segmentText } from "../../normalization/chunking";
import { normalizeStructuredBlocks, type GenericStructuralBlock } from "../../normalization/docxAdapter";
import { normalizePdfTextSource } from "../../normalization/pdfAdapter";
import { buildSpreadsheetText, type SpreadsheetSheet } from "../../normalization/spreadsheetAdapter";
import { normalizeTextSource } from "../../normalization/textAdapter";
import { NORMALIZATION_VERSION, type NormalizedSourceContent } from "../../normalization/types";
import type { EvaluationFixture } from "./types";

// The evaluation fixture corpus (docs/ai-evaluation.md's "Fixture design" section) — small,
// auditable, entirely internally-authored synthetic content. No copyrighted material of any kind
// (no book excerpts, no scraped text) — every fixture below is original prose/data written for
// this harness, about plain, uncontroversial factual topics chosen specifically so
// `expectedConcepts` can be defined honestly and simply (case-insensitive substring match — see
// scoring.ts).
//
// Every fixture calls the REAL normalization adapter for its format — normalizeTextSource
// (TXT), normalizePdfTextSource (PDF, via already-"extracted" pages — exactly the shape the real
// native extraction module would hand to this same adapter), normalizeStructuredBlocks (DOCX's
// own format-agnostic structured-block entry point — see docxAdapter.ts's header comment for why
// this needs no DOCX/ZIP bytes at all), or buildSpreadsheetText + segmentText (XLSX's own two
// pipeline steps, called directly since normalizeSpreadsheetSource itself only accepts raw ZIP
// bytes — see spreadsheetAdapter.ts). None of this harness hand-constructs a fake
// NormalizedSourceContent shape — chunk ids, provenance, and contentKind are all genuinely
// produced by this repository's own normalization code, not invented for this file.

function assertReady(content: NormalizedSourceContent): NormalizedSourceContent {
  if (content.extraction.status !== "ready") {
    throw new Error(`evaluation fixture: expected a "ready" extraction, got "${content.extraction.status}"`);
  }
  return content;
}

// ---- TXT fixtures ----

// The opening sentence deliberately names queen bee / worker bee / drone together, up front —
// see this file's own header comment on the Spanish fixture for why a fixture meant to
// demonstrate concept coverage under the MOCK provider (one card per chunk, a 160-char snippet
// of that chunk as the card's back) should put what it wants matched within that window, when
// this whole document segments into a single merged chunk (it does — under 2000 chars total).
const HONEYBEE_TEXT = `A honeybee colony has three castes: the queen bee, worker bees, and drones.
The queen bee is the colony's only fertile female and spends most of her life
laying eggs. Worker bees, also female but infertile, perform nearly every
other task the colony needs: foraging for nectar and pollen, building wax
comb, feeding larvae, and defending the hive entrance. Drones are the
colony's males; their only role is to mate with a queen from another colony,
after which they die.

Pollination happens as a side effect of foraging. A worker bee visiting a
flower for nectar picks up pollen on her body hairs and carries it to the next
flower she visits, fertilizing it. Many food crops depend on this process,
which is why beekeepers are sometimes hired specifically to pollinate orchards
rather than to harvest honey.

When a forager finds a good source of nectar, she returns to the hive and
performs a waggle dance: a figure-eight movement whose angle relative to the
sun indicates the direction of the food source, and whose duration indicates
the distance. Other workers watching the dance can then fly directly to the
same source without searching for it themselves.

Royal jelly is a nutrient-rich secretion produced by young worker bees. Every
larva receives some royal jelly, but a larva that is fed royal jelly
exclusively, for its entire larval period, develops into a queen instead of a
worker — the same genetic larva can become either, depending purely on diet.

A colony that grows too large for its hive will swarm: the old queen leaves
with roughly half the worker bees to found a new colony elsewhere, while a
newly raised queen takes over the original hive. Swarming is the colony's
natural method of reproduction at the colony level, distinct from an
individual bee's own life cycle.`;

const SPARSE_TEXT = `Rocks are solid mineral material. They can be found on the ground.`;

const NARRATIVE_TEXT = `Mira set her basket down at the edge of the market and looked up at the
awnings, orange and green, snapping gently in the wind off the river. She had
walked the same path every third morning for eleven years, and every third
morning something was different: a new stall, a missing face, a song she
didn't recognize drifting from somewhere behind the fish seller's cart. Today
it was the smell of cardamom, thick and sudden, coming from a cart that
hadn't been there before. She followed it without quite deciding to.`;

const AMBIGUOUS_TEXT = `The meeting is on Monday. Actually, the meeting was moved to Wednesday,
unless it rains, in which case it reverts to Monday. Either way, bring the
report, but only the version from last week, not the one from yesterday,
which replaces last week's version except for the summary page.`;

// Key terms deliberately cluster in the first ~160 characters — the mock provider's own card
// "back" is a 160-char snippet of its (here, single-chunk) source text, so a fixture meant to
// demonstrate full concept coverage under the MOCK provider must put what it wants matched
// within that window, not trust a later paragraph to be reachable through a snippet. Real
// generation has no such constraint; this is a known, documented mock-provider limitation (see
// docs/ai-evaluation.md's "Known limitations" section), not something to fight by inflating the
// fixture to an unnaturally large size.
const SPANISH_TEXT = `El ciclo del agua tiene tres fases principales: evaporación, condensación
y precipitación. La evaporación ocurre cuando el calor del sol convierte el
agua de los océanos en vapor. Ese vapor se enfría — condensación — y forma
nubes. Cuando las gotas son demasiado pesadas, caen como precipitación:
lluvia, nieve o granizo. El agua regresa a los ríos y el ciclo comienza de
nuevo.`;

function buildTxtFixture(id: string, sourceId: string, title: string, rawText: string, language = "en"): NormalizedSourceContent {
  const outcome = normalizeTextSource({
    sourceId,
    sourceType: "text",
    title,
    byteSize: rawText.length,
    rawText,
    language,
  });
  if (outcome.status !== "ready") throw new Error(`evaluation fixture "${id}": text normalization did not reach "ready" (${outcome.status})`);
  return outcome.content;
}

// ---- PDF fixture (already-"extracted" pages — exactly normalizePdfTextSource's own input
// shape; see that adapter's header comment) ----

const SOLAR_SYSTEM_PAGES = [
  `Mercury is the closest planet to the Sun and the smallest planet in the solar
system. It has almost no atmosphere, so its surface temperature swings
drastically between day and night. A year on Mercury (one orbit of the Sun)
takes only 88 Earth days.`,
  `Venus is the second planet from the Sun and is almost the same size as
Earth. Its thick atmosphere, made mostly of carbon dioxide, traps heat so
effectively that Venus is the hottest planet in the solar system, even
hotter than Mercury despite being farther from the Sun.`,
  `Earth is the third planet from the Sun and the only planet known to
support life. About seventy percent of its surface is covered by liquid
water, and its atmosphere contains enough oxygen for most known organisms
to breathe.`,
  `Mars is the fourth planet from the Sun, often called the "Red Planet"
because iron oxide (rust) covers much of its surface. Mars has the largest
volcano and the largest canyon in the solar system, and two small moons,
Phobos and Deimos.`,
  `Jupiter is the fifth planet from the Sun and by far the largest planet in
the solar system — more than twice as massive as every other planet
combined. Its Great Red Spot is a giant storm that has been observed for
hundreds of years.`,
  `Saturn is the sixth planet from the Sun, best known for its wide, flat
ring system made mostly of ice particles with some rocky debris. Saturn is
the least dense of the eight planets — it would float in water if a body
of water large enough existed.`,
];

function buildSolarSystemFixture(sourceId: string): NormalizedSourceContent {
  const outcome = normalizePdfTextSource({
    sourceId,
    sourceType: "pdf",
    title: "Planets of the Solar System",
    pages: SOLAR_SYSTEM_PAGES,
    language: "en",
  });
  if (outcome.status !== "ready") throw new Error(`evaluation fixture "pdf-structured-facts": PDF normalization did not reach "ready" (${outcome.status})`);
  return outcome.content;
}

// ---- DOCX fixtures (GenericStructuralBlock[] — docxAdapter.ts's own format-agnostic entry
// point; no ZIP/DOCX bytes needed) ----

function houseplantBlocks(): GenericStructuralBlock[] {
  return [
    { type: "heading", text: "Watering" },
    { type: "paragraph", text: "Most houseplants prefer their soil to dry out partway before the next watering. Overwatering is the single most common cause of houseplant death.", heading: "Watering" },
    { type: "listItem", text: "Low-water plants: succulents, snake plant", heading: "Watering" },
    { type: "listItem", text: "Medium-water plants: pothos, philodendron", heading: "Watering" },
    { type: "listItem", text: "High-water plants: ferns, peace lily", heading: "Watering" },
    { type: "heading", text: "Sunlight" },
    { type: "paragraph", text: "Light requirements vary widely. A plant kept in too little sunlight will often grow leggy, stretching toward the nearest window.", heading: "Sunlight" },
    { type: "tableRow", text: "Plant | Light need | Direction", heading: "Sunlight" },
    { type: "tableRow", text: "Snake plant | Low light | Any window", heading: "Sunlight" },
    { type: "tableRow", text: "Succulent | Bright light | South-facing window", heading: "Sunlight" },
    { type: "heading", text: "Soil" },
    { type: "paragraph", text: "Well-draining soil matters as much as watering frequency. A pot with no drainage hole, or a dense soil that holds standing water, causes root rot even on a correct watering schedule.", heading: "Soil" },
  ];
}

function photosynthesisBlocks(): GenericStructuralBlock[] {
  const restatement = (n: number) =>
    `Section ${n}: plants use chlorophyll, the green pigment in their leaves, to capture light energy and convert carbon dioxide and water into glucose and oxygen during photosynthesis.`;
  const blocks: GenericStructuralBlock[] = [{ type: "heading", text: "Photosynthesis" }];
  for (let i = 1; i <= 8; i++) {
    blocks.push({ type: "paragraph", text: restatement(i), heading: "Photosynthesis" });
  }
  return blocks;
}

function buildDocxFixture(id: string, sourceId: string, title: string, blocks: GenericStructuralBlock[]): NormalizedSourceContent {
  const outcome = normalizeStructuredBlocks({
    sourceId,
    sourceType: "docx",
    title,
    blocks,
    language: "en",
  });
  if (outcome.status !== "ready") throw new Error(`evaluation fixture "${id}": DOCX normalization did not reach "ready" (${outcome.status})`);
  return outcome.content;
}

// ---- Large multi-batch DOCX fixture ----
// Ten clearly-labeled, independently-topical sections, each padded with explicitly-marked
// restatements to a target length — deliberately SYNTHETIC bulk (never meaningful additional
// content) so the fixture file itself stays small/auditable while the resulting candidate
// content comfortably exceeds one bounded generation context (DEFAULT_CONTEXT_CHAR_BUDGET =
// 24,000 chars — see contextPreparation.ts), forcing planGenerationBatches to produce 2+ batches
// for the "wholeSource" evaluation scope. Topic 1 and topic 10 are both in `expectedConcepts` so
// a run can check whether LATER source regions are actually represented in the final deck (see
// docs/ai-evaluation.md's "Whole-source evaluation" section), not just the first batch.
const MULTIBATCH_TOPICS: { name: string; facts: string[] }[] = [
  { name: "lighthouses", facts: ["A lighthouse marks a hazardous coastline or safe entry point for ships.", "Early lighthouses burned wood or coal; modern ones use electric lamps."] },
  { name: "compasses", facts: ["A compass needle aligns with Earth's magnetic field.", "Magnetic north and true north are not identical and shift over time."] },
  { name: "paper", facts: ["Paper was invented in China from plant fibers.", "Most modern paper is made from wood pulp."] },
  { name: "clocks", facts: ["Mechanical clocks use a escapement to regulate motion.", "Quartz clocks use a vibrating crystal instead of gears."] },
  { name: "bridges", facts: ["A suspension bridge hangs its deck from cables.", "An arch bridge carries load through compression along its curve."] },
  { name: "telescopes", facts: ["A refracting telescope uses lenses to gather light.", "A reflecting telescope uses mirrors instead."] },
  { name: "soap", facts: ["Soap molecules have a water-attracting end and an oil-attracting end.", "This dual structure is what lets soap lift grease away with water."] },
  { name: "batteries", facts: ["A battery stores energy as a chemical reaction.", "Discharging a battery runs that reaction to release electrical energy."] },
  { name: "glass", facts: ["Glass is made primarily from melted sand.", "Adding other minerals changes glass color and melting point."] },
  { name: "windmills", facts: ["A windmill converts wind motion into mechanical rotation.", "Historically this powered grain mills; modern wind turbines generate electricity."] },
];

function multiBatchBlocks(): GenericStructuralBlock[] {
  // Three paragraph blocks per topic (not one) — deliberately enough DISTINCT chunks per topic
  // that even a batch allocated a SMALL slice of the total candidate set (planGenerationBatches'
  // own greedy packing can be uneven) still has enough chunks available to reach its own
  // per-batch card ceiling with the deterministic mock provider (one card per chunk) — see
  // runner.test.ts's own multi-batch tests for why this matters: a fixture with too FEW chunks
  // per topic can legitimately (and honestly) fall into "insufficient-distinct-content" purely
  // from uneven batch sizing, which is real/correct mock behavior but not what THIS fixture is
  // for (that exact interaction is its own interesting case, not this one's job to demonstrate).
  const blocks: GenericStructuralBlock[] = [];
  MULTIBATCH_TOPICS.forEach((topic, i) => {
    const heading = `Section ${i + 1}: ${topic.name}`;
    blocks.push({ type: "heading", text: heading });
    for (let part = 0; part < 3; part++) {
      let text = `${topic.facts.join(" ")}`;
      let restateCount = 0;
      while (text.length < 1100) {
        restateCount += 1;
        text += ` (Restated ${part}.${restateCount}: ${topic.facts[restateCount % topic.facts.length]})`;
      }
      blocks.push({ type: "paragraph", text, heading });
    }
  });
  return blocks;
}

// ---- XLSX fixture (buildSpreadsheetText + segmentText directly — see this file's own header
// comment for why normalizeSpreadsheetSource itself can't be used without real ZIP bytes) ----

// Exactly the 4 elements expectedConcepts checks for, in order — this whole sheet renders to a
// single merged chunk under segmentText (well under 2000 chars), and the mock provider's one
// resulting card only shows the first 160 chars of it as its back; keeping the row count tight
// and matched to expectedConcepts (rather than padding with extra elements) is what makes full
// coverage an honest, reachable expectation under the mock, not a fixture that was gamed to
// front-load a few rows while padding the rest irrelevantly.
const ELEMENTS_SHEET: SpreadsheetSheet = {
  name: "Elements",
  rows: [
    ["Symbol", "Name", "Atomic Number"],
    ["H", "Hydrogen", "1"],
    ["He", "Helium", "2"],
    ["C", "Carbon", "6"],
    ["O", "Oxygen", "8"],
  ],
};

function buildElementsFixture(sourceId: string): NormalizedSourceContent {
  const text = buildSpreadsheetText([ELEMENTS_SHEET]);
  const { chunks, truncated } = segmentText(sourceId, text);
  if (truncated) throw new Error('evaluation fixture "xlsx-spreadsheet-facts": unexpectedly truncated');
  return {
    sourceId,
    sourceType: "xlsx",
    title: "Chemical Elements Reference",
    language: "en",
    contentKind: "text",
    chunks,
    metadata: { byteSize: text.length },
    extraction: { status: "ready", adapter: "spreadsheet-structured-v1" },
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

// ---- Registry ----

export const EVALUATION_FIXTURES: readonly EvaluationFixture[] = [
  {
    id: "txt-factual-rich",
    sourceType: "text",
    language: "en",
    description: "Dense, factual prose about honeybee colony roles and behavior — rich, varied, unambiguous content.",
    // Deliberately only the three concepts that cluster in the opening sentence — this
    // single-chunk fixture (under 2000 chars, so segmentText never splits it) also discusses
    // pollination/the waggle dance/royal jelly, but those live further into the text than the
    // mock provider's single 160-char card-back snippet reaches; checking only what a 1-chunk/
    // 1-card mock run can actually surface keeps this an honest, non-gamed expectation. Diverse
    // concepts scattered ACROSS multiple chunks is exactly what pdf-structured-facts and
    // docx-large-multibatch exist to exercise instead (both verified at full coverage).
    expectedConcepts: ["queen bee", "worker bee", "drone"],
    buildNormalizedContent: () => assertReady(buildTxtFixture("txt-factual-rich", "eval-txt-factual-rich", "Honeybee Colonies", HONEYBEE_TEXT)),
  },
  {
    id: "txt-sparse",
    sourceType: "text",
    language: "en",
    description: "Deliberately thin content — barely enough for one card, exercises insufficient-content behavior honestly.",
    designedForInsufficiency: true,
    buildNormalizedContent: () => assertReady(buildTxtFixture("txt-sparse", "eval-txt-sparse", "Rocks", SPARSE_TEXT)),
  },
  {
    id: "txt-narrative-prose",
    sourceType: "text",
    language: "en",
    description: "Short narrative/story passage — low factual density, observes whether generation invents facts instead of sticking to the narrative.",
    buildNormalizedContent: () => assertReady(buildTxtFixture("txt-narrative-prose", "eval-txt-narrative", "A Walk to Market", NARRATIVE_TEXT)),
  },
  {
    id: "txt-ambiguous",
    sourceType: "text",
    language: "en",
    description: "Deliberately self-contradictory short content — observational only, no hard pass/fail concept scoring.",
    buildNormalizedContent: () => assertReady(buildTxtFixture("txt-ambiguous", "eval-txt-ambiguous", "Meeting Schedule", AMBIGUOUS_TEXT)),
  },
  {
    id: "txt-spanish-baseline",
    sourceType: "text",
    language: "es",
    description: "Small Spanish-language fixture proving Unicode/localized generation plumbing end to end.",
    expectedConcepts: ["evaporación", "condensación", "precipitación"],
    buildNormalizedContent: () => assertReady(buildTxtFixture("txt-spanish-baseline", "eval-txt-spanish", "El Ciclo del Agua", SPANISH_TEXT, "es")),
  },
  {
    id: "pdf-structured-facts",
    sourceType: "pdf",
    language: "en",
    description: "Six-page document, one planet's facts per page — exercises real page-based provenance and page-range scope.",
    expectedConcepts: ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"],
    buildNormalizedContent: () => assertReady(buildSolarSystemFixture("eval-pdf-solar-system")),
  },
  {
    id: "docx-structured-headings",
    sourceType: "docx",
    language: "en",
    description: "Mixed headings/lists/table-rows about houseplant care — structural variety (heading/paragraph/listItem/tableRow).",
    expectedConcepts: ["watering", "sunlight", "soil"],
    buildNormalizedContent: () => assertReady(buildDocxFixture("docx-structured-headings", "eval-docx-houseplants", "Houseplant Care Guide", houseplantBlocks())),
  },
  {
    id: "docx-repetitive",
    sourceType: "docx",
    language: "en",
    description: "The same two concepts (chlorophyll, photosynthesis) restated across eight near-identical paragraphs — exercises duplicate/near-duplicate handling.",
    expectedConcepts: ["chlorophyll", "photosynthesis"],
    buildNormalizedContent: () => assertReady(buildDocxFixture("docx-repetitive", "eval-docx-photosynthesis", "Photosynthesis Basics", photosynthesisBlocks())),
  },
  {
    id: "docx-large-multibatch",
    sourceType: "docx",
    language: "en",
    description: "Ten independently-topical sections padded to exceed one context budget — forces whole-source multi-batch planning; checks whether later sections are represented in the final deck.",
    designedForMultiBatch: true,
    expectedConcepts: ["lighthouse", "windmill"],
    buildNormalizedContent: () => assertReady(buildDocxFixture("docx-large-multibatch", "eval-docx-multibatch", "Ten Everyday Inventions", multiBatchBlocks())),
  },
  {
    id: "xlsx-spreadsheet-facts",
    sourceType: "xlsx",
    language: "en",
    description: "A small reference table of chemical elements — exercises spreadsheet-shaped structured content.",
    expectedConcepts: ["Hydrogen", "Helium", "Carbon", "Oxygen"],
    buildNormalizedContent: () => assertReady(buildElementsFixture("eval-xlsx-elements")),
  },
];

export function getEvaluationFixture(id: string): EvaluationFixture {
  const fixture = EVALUATION_FIXTURES.find((f) => f.id === id);
  if (!fixture) throw new Error(`Unknown evaluation fixture id: "${id}"`);
  return fixture;
}
