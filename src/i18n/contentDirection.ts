import type { TextStyle } from "react-native";

import type { LayoutDirection } from "./direction";

// Natural direction of a piece of CONTENT (a generated/source card's text), independent of the
// app's UI locale direction. UI chrome always follows the locale (see i18n/direction.ts); a
// source or generated card's own text must not be flipped just because the surrounding chrome is
// RTL (Arabic UI + an English card stays LTR; English UI + an Arabic card renders RTL).
//
// Deterministic first-strong-character scan — the same idea as the Unicode Bidi Algorithm's
// paragraph-direction rule (P2/P3), scoped to the ranges that matter here. Codepoint ranges only
// (no literal RTL characters in this file), no dependency, no string reversal, no bidi control
// characters inserted.

// [start, end] inclusive codepoint ranges.
const RTL_RANGES: readonly (readonly [number, number])[] = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x07bf], // Arabic, Arabic Supplement, Thaana
  [0x07c0, 0x08ff], // NKo, Samaritan, Mandaic, Arabic Extended-B/A
  [0xfb1d, 0xfb4f], // Hebrew presentation forms
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

const LTR_RANGES: readonly (readonly [number, number])[] = [
  [0x0041, 0x005a], // A–Z
  [0x0061, 0x007a], // a–z
  [0x00c0, 0x024f], // Latin-1 Supplement + Latin Extended-A/B letters
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x04ff], // Cyrillic
  [0x3040, 0x30ff], // Hiragana + Katakana
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xac00, 0xd7af], // Hangul syllables
];

function inRanges(cp: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/**
 * Returns the natural layout direction of `value` from its first strong character. Neutral
 * characters (digits, punctuation, whitespace, symbols) are skipped. Falls back to `"ltr"` when
 * the string has no strong character at all (empty, digits-only, punctuation-only).
 */
export function detectContentDirection(value: string): LayoutDirection {
  for (const char of value) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    if (inRanges(cp, RTL_RANGES)) return "rtl";
    if (inRanges(cp, LTR_RANGES)) return "ltr";
  }
  return "ltr";
}

/**
 * A `Text` style that renders `value` in its own natural direction — pass the result alongside
 * the normal typography/color styles. Deliberately mirrors `directionalText` in
 * i18n/direction.ts (same shape), but keyed off the content, not the UI locale.
 */
export function contentDirectionStyle(value: string): TextStyle {
  const direction = detectContentDirection(value);
  return { writingDirection: direction, textAlign: direction === "rtl" ? "right" : "left" };
}
