/** Campaign progress lives in the browser only. The sim never reads it. */

export const CAMPAIGN_KEY = 'dorozhnye-kraya-campaign';

export interface CampaignSave {
  version: 1;
  stars: Record<string, number>;
  minutes: Record<string, number>;
}

export function emptySave(): CampaignSave {
  return { version: 1, stars: {}, minutes: {} };
}

export function parseSave(raw: string | null | undefined): CampaignSave {
  if (!raw) return emptySave();
  try {
    const data = JSON.parse(raw) as Partial<CampaignSave>;
    if (!data || data.version !== 1 || typeof data.stars !== 'object' || !data.stars) return emptySave();
    const stars: Record<string, number> = {};
    const minutes: Record<string, number> = {};
    for (const [id, value] of Object.entries(data.stars)) {
      const starsValue = Math.floor(Number(value));
      if (!Number.isFinite(starsValue)) continue;
      stars[id] = Math.max(0, Math.min(3, starsValue));
    }
    if (data.minutes && typeof data.minutes === 'object') {
      for (const [id, value] of Object.entries(data.minutes)) {
        const minutesValue = Number(value);
        if (Number.isFinite(minutesValue) && minutesValue >= 0) minutes[id] = minutesValue;
      }
    }
    return { version: 1, stars, minutes };
  } catch {
    return emptySave();
  }
}

export function isUnlocked(save: CampaignSave, index: number, ids: readonly string[]): boolean {
  if (index <= 0) return true;
  const previous = ids[index - 1];
  if (!previous) return false;
  return (save.stars[previous] ?? 0) >= 1;
}

/** Keeps the best star count and the fastest winning time. */
export function award(save: CampaignSave, id: string, stars: number, minutes: number): CampaignSave {
  const next = parseSave(JSON.stringify(save));
  const earned = Math.max(0, Math.min(3, Math.floor(stars)));
  const had = next.stars[id] ?? 0;
  if (earned > had) next.stars[id] = earned;
  else next.stars[id] = had;
  if (earned > 0 && Number.isFinite(minutes)) {
    const prev = next.minutes[id];
    next.minutes[id] = prev == null ? minutes : Math.min(prev, minutes);
  }
  return next;
}

export function loadProgress(): CampaignSave {
  try {
    return parseSave(globalThis.localStorage?.getItem(CAMPAIGN_KEY) ?? null);
  } catch {
    return emptySave();
  }
}

export function saveProgress(save: CampaignSave): void {
  try {
    globalThis.localStorage?.setItem(CAMPAIGN_KEY, JSON.stringify(save));
  } catch {
    /* private mode */
  }
}

export function starsFor(won: boolean, minutes: number, parMinutes: number, bonus: boolean): 0 | 1 | 2 | 3 {
  if (!won) return 0;
  let stars = 1;
  if (minutes <= parMinutes) stars += 1;
  if (bonus) stars += 1;
  return stars as 1 | 2 | 3;
}
