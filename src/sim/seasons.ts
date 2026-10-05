import { POP_MIN, TICKS_PER_GAME_MINUTE } from './balance';
import type { BuildingType, GameState, SeasonId, SeasonPace, WeatherId } from './types';

export const SEASONS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** Game minutes in one season. Off skips the cycle. */
export const SEASON_MINUTES: Record<Exclude<SeasonPace, 'off'>, number> = {
  normal: 6,
  long: 12,
};

const FARMS = new Set<BuildingType>(['orchard', 'wheat', 'hop', 'dairy']);
const HEARTHS = new Set<BuildingType>(['shack', 'cabin', 'house', 'khrush', 'highrise']);

export function seasonPace(value: unknown): SeasonPace {
  return value === 'normal' || value === 'long' || value === 'off' ? value : 'off';
}

export function seasonLength(pace: SeasonPace): number {
  if (pace === 'off') return 0;
  return SEASON_MINUTES[pace] * TICKS_PER_GAME_MINUTE;
}

export function seasonAt(tick: number, pace: SeasonPace): SeasonId | 'off' {
  const len = seasonLength(pace);
  if (len <= 0) return 'off';
  return SEASONS[Math.floor(Math.max(0, tick) / len) % 4];
}

export function nextSeason(season: SeasonId | 'off'): SeasonId | 'off' {
  if (season === 'off') return 'off';
  return SEASONS[(SEASONS.indexOf(season) + 1) % 4];
}

/** 0..99 from the world seed and the game minute. It does not draw the sim rng. */
export function weatherRoll(seed: number, minute: number): number {
  let h = (seed ^ Math.imul(minute + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) % 100;
}

export function weatherAt(seed: number, tick: number, pace: SeasonPace): WeatherId {
  const season = seasonAt(tick, pace);
  if (season === 'off') return 'clear';
  const roll = weatherRoll(seed >>> 0, Math.floor(Math.max(0, tick) / TICKS_PER_GAME_MINUTE));
  if (season === 'spring') return roll < 40 ? 'rain' : 'clear';
  if (season === 'summer') {
    if (roll < 14) return 'drought';
    if (roll < 24) return 'storm';
    if (roll < 58) return 'heat';
    return 'clear';
  }
  if (season === 'autumn') return roll < 36 ? 'rain' : 'clear';
  return roll < 72 ? 'snow' : 'clear';
}

export function syncClimate(state: GameState): void {
  const pace = seasonPace(state.match?.seasons);
  state.season = seasonAt(state.tick, pace);
  state.weather = weatherAt(state.seed, state.tick, pace);
}

export function isFarm(type: BuildingType): boolean {
  return FARMS.has(type);
}

/** Spring and summer grow at the usual pace, autumn harvests twice as fast, winter pauses. Drought cuts the rest. */
export function farmWorkRate(state: GameState): number {
  const season = state.season ?? 'off';
  let rate = 1;
  if (season === 'autumn') rate = 2;
  else if (season === 'winter') rate = 0;
  if ((state.weather ?? 'clear') === 'drought') rate *= 0.45;
  return rate;
}

/** Off-road mud and snow. Roads keep ROAD_MULT and skip this. */
export function offroadFactor(state: GameState): number {
  const weather = state.weather ?? 'clear';
  const season = state.season ?? 'off';
  if (weather === 'snow' || season === 'winter') return 0.74;
  if (weather === 'rain') return 0.82;
  return 1;
}

/** Same drain the campaign drought uses: fields give up stored work. */
export function drainFarms(state: GameState, bufferLoss = 2): void {
  for (const building of state.buildings) {
    if (!isFarm(building.type)) continue;
    if (building.buffer > 0) building.buffer = Math.max(0, building.buffer - bufferLoss);
    building.work = Math.floor(building.work / 2);
  }
}

/** Once a game minute: firewood, ale in a heat wave, and a drought drain. */
export function climateMinute(state: GameState): void {
  if (state.tick <= 0 || state.tick % TICKS_PER_GAME_MINUTE !== 0) return;
  if ((state.weather ?? 'clear') === 'drought') {
    drainFarms(state, 1);
    for (const player of state.players) {
      if (!player.alive) continue;
      for (const resource of ['apples', 'wheat', 'cheese'] as const) {
        player.stocks[resource] = Math.max(0, (player.stocks[resource] ?? 0) - 1);
      }
    }
  }
  for (const player of state.players) {
    if (!player.alive) continue;
    if (state.season === 'winter') {
      const homes = state.buildings.filter(
        (building) => building.playerId === player.id && building.complete && building.hp > 0 && HEARTHS.has(building.type),
      ).length;
      if (homes > 0) {
        const need = Math.max(1, Math.ceil(homes / 4));
        if ((player.stocks.wood ?? 0) >= need) player.stocks.wood -= need;
        else player.popularity = Math.max(POP_MIN, player.popularity - 1);
      }
    }
    if (state.weather === 'heat') {
      if ((player.stocks.beer ?? 0) > 0) player.stocks.beer -= 1;
      else player.popularity = Math.max(POP_MIN, player.popularity - 1);
    }
  }
}

/** Deterministic miss in a storm: two gusts out of five throw the shot wide. */
export function stormMiss(state: GameState, soldierId: number): boolean {
  if ((state.weather ?? 'clear') !== 'storm') return false;
  const gust = (state.seed ^ Math.imul(state.tick + 1, 0x45d9f3b) ^ Math.imul(soldierId + 1, 0x27d4eb2d)) >>> 0;
  return gust % 5 < 2;
}

export function seasonName(season: SeasonId | 'off' | undefined): string {
  if (season === 'spring') return 'Весна';
  if (season === 'summer') return 'Лето';
  if (season === 'autumn') return 'Осень';
  if (season === 'winter') return 'Зима';
  return 'Без сезонов';
}

export function weatherName(weather: WeatherId | undefined): string {
  if (weather === 'rain') return 'дождь';
  if (weather === 'heat') return 'зной';
  if (weather === 'storm') return 'гроза';
  if (weather === 'snow') return 'снег';
  if (weather === 'drought') return 'засуха';
  return 'ясно';
}

export function paceName(pace: SeasonPace | undefined): string {
  if (pace === 'long') return 'долгие';
  if (pace === 'normal') return 'обычные';
  return 'выкл';
}

export function forecastLine(state: GameState): string {
  const season = state.season ?? 'off';
  if (season === 'off') return '';
  const next = nextSeason(season);
  return `${seasonName(season)} · ${weatherName(state.weather)} · дальше ${seasonName(next)}`;
}
