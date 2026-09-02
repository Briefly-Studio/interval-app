import type { DiscoverContentProvider, DiscoverLesson } from "../domain/discover";

export const DISCOVER_FIXTURE_LESSONS: readonly DiscoverLesson[] = [
  {
    id: "sleep-memory-replay",
    title: "Why sleep strengthens memory",
    category: "Science",
    estimatedMinutes: 3,
    hook: "Your brain does not simply shut down at night. It quietly rehearses what mattered.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "During sleep, the brain reactivates patterns from recent experience. That replay helps fragile memories become more stable and easier to retrieve later.",
      },
      {
        heading: "Why it matters",
        body:
          "A late study session can feel productive, but sleep is part of the learning process. Spacing study and protecting sleep often beats one long push.",
      },
    ],
    keyTakeaway: "Sleep is not a break from learning. It is one of the ways learning gets stored.",
    relatedTopics: ["Spaced repetition", "Attention", "Memory consolidation"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "roman-concrete",
    title: "The surprising durability of Roman concrete",
    category: "History",
    estimatedMinutes: 3,
    hook: "Some ancient harbor structures survived seawater for centuries because their material changed over time.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Roman builders often mixed volcanic ash with lime and seawater. In some marine settings, that chemistry encouraged mineral growth inside the concrete.",
      },
      {
        heading: "Why it matters",
        body:
          "Durability is not only about resisting change. Sometimes a material lasts because its environment helps it become stronger in useful ways.",
      },
    ],
    keyTakeaway: "Good engineering can depend on designing with an environment, not merely against it.",
    relatedTopics: ["Materials science", "Infrastructure", "Volcanic ash"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "packet-switching",
    title: "Why the internet breaks messages into packets",
    category: "Technology",
    estimatedMinutes: 4,
    hook: "A web page does not travel to you as one neat object. It arrives in pieces that find their way across the network.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Packet switching splits data into small chunks. Each packet carries addressing information, and the network can route packets around congestion or failure.",
      },
      {
        heading: "Why it matters",
        body:
          "This makes networks more resilient. If one path is busy or broken, packets may still arrive through another path and be reassembled at the destination.",
      },
    ],
    keyTakeaway: "The internet is robust partly because it moves many small pieces rather than one fragile stream.",
    relatedTopics: ["Networks", "Protocols", "Resilience"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "availability-heuristic",
    title: "The availability heuristic",
    category: "Psychology",
    estimatedMinutes: 3,
    hook: "The examples that come to mind fastest can quietly distort what feels common or risky.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "People often estimate probability using memorable examples. Recent, vivid, or emotionally charged events can feel more representative than they really are.",
      },
      {
        heading: "Why it matters",
        body:
          "A useful pause is to ask: am I seeing good evidence, or just remembering a striking example quickly?",
      },
    ],
    keyTakeaway: "Easy-to-recall examples are useful clues, but they are not the same as reliable base rates.",
    relatedTopics: ["Judgment", "Bias", "Decision-making"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "compound-interest",
    title: "Compound interest in one minute",
    category: "Finance",
    estimatedMinutes: 2,
    hook: "Compounding is what happens when growth starts earning its own growth.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Simple interest grows from the original amount only. Compound interest grows from the original amount plus prior gains, so the curve bends upward over time.",
      },
      {
        heading: "Why it matters",
        body:
          "Small differences in rate, fees, or time can become large differences later. That is why starting early can matter even when the first amounts are modest.",
      },
    ],
    keyTakeaway: "Compounding rewards time, consistency, and low friction.",
    relatedTopics: ["Savings", "Exponential growth", "Fees"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "negative-space",
    title: "How negative space changes a composition",
    category: "Art & Culture",
    estimatedMinutes: 3,
    hook: "What is not drawn can be as important as what is placed on the page.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Negative space is the area around and between subjects. Designers and artists use it to guide attention, create balance, and let important elements breathe.",
      },
      {
        heading: "Why it matters",
        body:
          "A crowded layout can make every element weaker. Deliberate empty space can make the main idea easier to notice and remember.",
      },
    ],
    keyTakeaway: "Space is not absence. It is an active part of visual meaning.",
    relatedTopics: ["Design", "Composition", "Visual hierarchy"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "river-deltas",
    title: "Why river deltas are always changing",
    category: "Geography",
    estimatedMinutes: 4,
    hook: "A delta is not a fixed shape. It is a negotiation between river sediment, waves, tides, and human choices.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Rivers carry sediment toward the sea. When the water slows, sediment can build new land, but waves and tides may redistribute or erode it.",
      },
      {
        heading: "Why it matters",
        body:
          "Deltas often support farms, cities, fisheries, and wetlands. Dams, levees, and sea-level rise can change whether a delta grows or shrinks.",
      },
    ],
    keyTakeaway: "Deltas are dynamic systems shaped by water, sediment, climate, and infrastructure.",
    relatedTopics: ["Coasts", "Sediment", "Sea-level rise"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "feedback-loops",
    title: "Feedback loops make systems behave unexpectedly",
    category: "Science",
    estimatedMinutes: 3,
    hook: "A small change can fade away, stabilize a system, or amplify into something much larger.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "A negative feedback loop dampens change, like a thermostat switching heat off after a room warms. A positive feedback loop amplifies change.",
      },
      {
        heading: "Why it matters",
        body:
          "Feedback loops appear in biology, climate, markets, habits, and software. Spotting the loop helps explain behavior that a simple cause-and-effect story misses.",
      },
    ],
    keyTakeaway: "To understand a system, ask what the results of an action feed back into next.",
    relatedTopics: ["Systems thinking", "Climate", "Behavior"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "printing-press",
    title: "Why movable type changed learning",
    category: "History",
    estimatedMinutes: 4,
    hook: "A faster way to copy pages changed who could encounter, question, and preserve ideas.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Movable type made it easier to reproduce texts consistently and at scale. More copies meant ideas could travel farther and be compared more widely.",
      },
      {
        heading: "Why it matters",
        body:
          "Information technology changes learning habits. The printing press did not only spread facts; it altered institutions, authority, and public debate.",
      },
    ],
    keyTakeaway: "When copying gets cheaper, the social life of knowledge changes.",
    relatedTopics: ["Media history", "Literacy", "Institutions"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
  {
    id: "opportunity-cost",
    title: "Opportunity cost is the hidden price of a choice",
    category: "Finance",
    estimatedMinutes: 2,
    hook: "Every yes quietly spends the chance to do something else.",
    contentLanguage: "en",
    sections: [
      {
        heading: "The idea",
        body:
          "Opportunity cost is the value of the best alternative you give up. It applies to money, time, attention, and effort.",
      },
      {
        heading: "Why it matters",
        body:
          "A choice can look cheap in dollars but expensive in time, focus, or flexibility. Naming the alternative makes tradeoffs clearer.",
      },
    ],
    keyTakeaway: "The real cost of a choice includes the best path you did not take.",
    relatedTopics: ["Tradeoffs", "Scarcity", "Decision-making"],
    sourceNote: "Curated preview lesson written for Interval.",
  },
];

export const LocalDiscoverFixtureProvider: DiscoverContentProvider = {
  listLessons: () => DISCOVER_FIXTURE_LESSONS,
  getLessonById: (id) => DISCOVER_FIXTURE_LESSONS.find((lesson) => lesson.id === id) ?? null,
};

