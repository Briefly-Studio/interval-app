import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";

import { getLocaleInfo, type LocaleDirection } from "./localeRegistry";
import { useTranslation } from "./index";
import type { Locale } from "./types";

export type LayoutDirection = LocaleDirection;

export function localeDirection(locale: Locale): LayoutDirection {
  return getLocaleInfo(locale).direction;
}

export function directionalRow(direction: LayoutDirection): ViewStyle {
  return { flexDirection: direction === "rtl" ? "row-reverse" : "row" };
}

export function directionalText(direction: LayoutDirection): TextStyle {
  return {
    writingDirection: direction,
    textAlign: direction === "rtl" ? "right" : "left",
  };
}

export function mirrorIfRtl(direction: LayoutDirection): TextStyle | undefined {
  return direction === "rtl" ? { transform: [{ scaleX: -1 }] } : undefined;
}

export function useLayoutDirection(): {
  direction: LayoutDirection;
  isRtl: boolean;
  row: ViewStyle;
  text: TextStyle;
} {
  const { language } = useTranslation();
  const direction = localeDirection(language);

  return useMemo(
    () => ({
      direction,
      isRtl: direction === "rtl",
      row: directionalRow(direction),
      text: directionalText(direction),
    }),
    [direction]
  );
}
