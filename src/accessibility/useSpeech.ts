import { useCallback, useEffect, useRef, useState } from "react";

import { SPEECH_RATE_VALUES, useAccessibilityPreferences } from "./accessibilityPreferences";
import { speak as speakRaw, stopSpeech } from "./speech";

/**
 * Screen-scoped speech controller for study content. Automatically stops any in-flight speech
 * when the owning component unmounts (navigating away) — callers are still responsible for
 * calling `stop()` themselves whenever the spoken content changes under them (e.g. moving to the
 * next card), since unmount alone doesn't cover "same screen, different content."
 *
 * `languageTag` should be a concrete BCP-47-ish tag (e.g. "en-US", "es-ES") derived from
 * Interval's own current UI language — never inferred from card content, which this app has no
 * reliable way to detect.
 */
export function useSpeech(languageTag: string) {
  const { speechEnabled, speechRate } = useAccessibilityPreferences();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSpeech();
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!speechEnabled) return;
      setIsSpeaking(true);
      speakRaw(text, {
        language: languageTag,
        rate: SPEECH_RATE_VALUES[speechRate],
        onDone: () => {
          if (mountedRef.current) setIsSpeaking(false);
        },
        onStopped: () => {
          if (mountedRef.current) setIsSpeaking(false);
        },
        onError: () => {
          if (mountedRef.current) setIsSpeaking(false);
        },
      });
    },
    [speechEnabled, speechRate, languageTag]
  );

  const stop = useCallback(() => {
    stopSpeech();
    setIsSpeaking(false);
  }, []);

  return { speak, stop, isSpeaking, speechEnabled };
}
