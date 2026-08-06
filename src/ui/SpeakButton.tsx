import { IconButton } from "./IconButton";

type SpeakButtonProps = {
  isSpeaking: boolean;
  onPress: () => void;
  playLabel: string;
  stopLabel: string;
  disabled?: boolean;
};

// Shared speaker control for study screens. Acts as a toggle: idle shows a "play" affordance and
// speaks on press; while speaking, the same control shows a "stop" affordance and stops on press
// instead of queuing a second utterance. Icon alone is never the only signal — playLabel/stopLabel
// (both required, both localized by the caller) always carry the real meaning for screen readers.
export function SpeakButton({ isSpeaking, onPress, playLabel, stopLabel, disabled }: SpeakButtonProps) {
  return (
    <IconButton
      name={isSpeaking ? "stop-circle-outline" : "volume-medium-outline"}
      accessibilityLabel={isSpeaking ? stopLabel : playLabel}
      onPress={onPress}
      variant="surface"
      disabled={disabled}
    />
  );
}
