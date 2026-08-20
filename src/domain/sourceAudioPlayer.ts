export const AUDIO_PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export type AudioPlaybackRate = (typeof AUDIO_PLAYBACK_RATES)[number];

export function isAudioPlaybackRate(value: number): value is AudioPlaybackRate {
  return (AUDIO_PLAYBACK_RATES as readonly number[]).includes(value);
}

export function clampPlaybackPosition(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return seconds;
  return Math.min(seconds, duration);
}

export function playbackProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, currentTime / duration));
}

export function formatPlaybackTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function isPlaybackComplete(status: { didJustFinish?: boolean; currentTime?: number; duration?: number }): boolean {
  if (status.didJustFinish) return true;
  const currentTime = status.currentTime ?? 0;
  const duration = status.duration ?? 0;
  return Number.isFinite(duration) && duration > 0 && currentTime >= duration - 0.25;
}
