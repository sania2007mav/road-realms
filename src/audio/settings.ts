export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
}

export const AUDIO_STORAGE_KEY = 'dorozhnye-kraya-audio';

export const DEFAULT_AUDIO: AudioSettings = {
  master: 0.8,
  music: 0.5,
  sfx: 0.85,
  ambience: 0.4,
  muted: false,
};

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function parseSettings(raw: string | null): AudioSettings {
  if (!raw) return { ...DEFAULT_AUDIO };
  try {
    const data = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      master: clamp01(data.master, DEFAULT_AUDIO.master),
      music: clamp01(data.music, DEFAULT_AUDIO.music),
      sfx: clamp01(data.sfx, DEFAULT_AUDIO.sfx),
      ambience: clamp01(data.ambience, DEFAULT_AUDIO.ambience),
      muted: data.muted === true,
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function serializeSettings(settings: AudioSettings): string {
  return JSON.stringify({
    master: clamp01(settings.master, DEFAULT_AUDIO.master),
    music: clamp01(settings.music, DEFAULT_AUDIO.music),
    sfx: clamp01(settings.sfx, DEFAULT_AUDIO.sfx),
    ambience: clamp01(settings.ambience, DEFAULT_AUDIO.ambience),
    muted: settings.muted === true,
  });
}

export function loadSettings(): AudioSettings {
  try {
    return parseSettings(localStorage.getItem(AUDIO_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, serializeSettings(settings));
  } catch {
    /* private mode */
  }
}
