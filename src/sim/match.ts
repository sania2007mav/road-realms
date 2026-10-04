import { MAP_H, MAP_W, START_GOLD, START_STOCKS } from './balance';
import type { Food, GameState, MapSizeId, MatchSetup, Player, PlayerStats, StartId, VictoryId } from './types';

export const DEFAULT_SETUP: MatchSetup = {
  victory: 'conquest',
  timeLimit: 0,
  map: 'normal',
  start: 'normal',
  ai: 3,
  goldTarget: 2000,
  popTarget: 20,
  surviveMinutes: 15,
};

const VICTORY: readonly VictoryId[] = ['conquest', 'wealth', 'bloom', 'survival'];
const TIMES = [0, 15, 30, 45] as const;
const MAPS: readonly MapSizeId[] = ['small', 'normal', 'large', 'normal'];
const STARTS: readonly StartId[] = ['low', 'normal', 'high', 'normal'];
const GOLD = [1000, 2000, 4000, 2000] as const;
const POP = [12, 20, 30, 20] as const;
const SURVIVE = [10, 20, 30, 15] as const;

export const SCORE_TEXT =
  'Счёт = золото в казне + пик населения × 10 + уровень главного здания × 50 + построенные здания × 8 + обученные воины × 12 + убитые враги × 6 + разрушенные здания × 20 + произведённая еда';

export function emptyStats(peakPop = 0): PlayerStats {
  return {
    peakPop,
    food: { apples: 0, cheese: 0, meat: 0, bread: 0 },
    goldEarned: 0,
    buildings: 0,
    soldiers: 0,
    kills: 0,
    razed: 0,
  };
}

export function normalizeSetup(partial?: Partial<MatchSetup> | null, ai = DEFAULT_SETUP.ai): MatchSetup {
  const base: MatchSetup = { ...DEFAULT_SETUP, ai };
  if (!partial) return base;
  return {
    victory: partial.victory ?? base.victory,
    timeLimit: finite(partial.timeLimit, base.timeLimit),
    map: partial.map ?? base.map,
    start: partial.start ?? base.start,
    ai: finite(partial.ai, base.ai),
    goldTarget: finite(partial.goldTarget, base.goldTarget),
    popTarget: finite(partial.popTarget, base.popTarget),
    surviveMinutes: finite(partial.surviveMinutes, base.surviveMinutes),
  };
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function mapSize(map: MapSizeId): { w: number; h: number } {
  if (map === 'small') return { w: 120, h: 80 };
  if (map === 'large') return { w: 240, h: 160 };
  return { w: MAP_W, h: MAP_H };
}

export function openingBundle(start: StartId): { wood: number; stone: number; apples: number; iron: number; pitch: number; gold: number } {
  if (start === 'low') return { wood: 18, stone: 4, apples: 36, iron: 0, pitch: 0, gold: 40 };
  if (start === 'high') return { wood: 80, stone: 40, apples: 160, iron: 4, pitch: 2, gold: 300 };
  return {
    wood: START_STOCKS.wood ?? 0,
    stone: START_STOCKS.stone ?? 0,
    apples: START_STOCKS.apples ?? 0,
    iron: START_STOCKS.iron ?? 0,
    pitch: START_STOCKS.pitch ?? 0,
    gold: START_GOLD,
  };
}

export function victoryName(id: VictoryId): string {
  if (id === 'wealth') return 'Богатство';
  if (id === 'bloom') return 'Расцвет';
  if (id === 'survival') return 'Выживание';
  return 'Завоевание';
}

export function describeSetup(setup: MatchSetup): string {
  const time = setup.timeLimit > 0 ? `, лимит ${setup.timeLimit} мин` : '';
  const map = setup.map === 'small' ? 'малая карта' : setup.map === 'large' ? 'большая карта' : 'обычная карта';
  const start = setup.start === 'low' ? 'скудные запасы' : setup.start === 'high' ? 'богатые запасы' : 'обычные запасы';
  const extra =
    setup.victory === 'wealth'
      ? `, ${setup.goldTarget} золота`
      : setup.victory === 'bloom'
        ? `, уровень 5 и ${setup.popTarget} людей`
        : setup.victory === 'survival'
          ? `, ${setup.surviveMinutes} мин`
          : '';
  return `${victoryName(setup.victory)}${extra}. ${map}, ${start}, соседей ${setup.ai}${time}.`;
}

export function foodTotal(food: Record<Food, number> | undefined): number {
  if (!food) return 0;
  return (food.apples || 0) + (food.cheese || 0) + (food.meat || 0) + (food.bread || 0);
}

export function scoreOf(state: GameState, player: Player): number {
  const keep = state.buildings.find((building) => building.playerId === player.id && building.type === 'keep');
  const stats = player.stats ?? emptyStats(0);
  return (
    player.gold +
    stats.peakPop * 10 +
    (keep?.level ?? 0) * 50 +
    stats.buildings * 8 +
    stats.soldiers * 12 +
    stats.kills * 6 +
    stats.razed * 20 +
    foodTotal(stats.food)
  );
}

function nearest(options: readonly number[], value: number): number {
  const exact = options.indexOf(value);
  if (exact >= 0) return exact;
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < options.length; i++) {
    const gap = Math.abs(options[i] - value);
    if (gap < dist) {
      dist = gap;
      best = i;
    }
  }
  return best;
}

/**
 * Lobby rules reject any field besides the existing ones. The seed is an immutable uint32,
 * so the high 16 bits carry the match and the low 16 bits stay the world seed.
 */
export function packSeed(worldSeed: number, setup: MatchSetup): number {
  const bits =
    (VICTORY.indexOf(setup.victory) & 3) |
    (nearest(TIMES, setup.timeLimit) << 2) |
    ((MAPS.indexOf(setup.map) & 3) << 4) |
    ((STARTS.indexOf(setup.start) & 3) << 6) |
    ((Math.max(0, Math.min(3, Math.floor(setup.ai))) & 3) << 8) |
    (nearest(GOLD, setup.goldTarget) << 10) |
    (nearest(POP, setup.popTarget) << 12) |
    (nearest(SURVIVE, setup.surviveMinutes) << 14);
  return (((bits & 0xffff) << 16) | (worldSeed & 0xffff)) >>> 0;
}

export function unpackSeed(packed: number): { worldSeed: number; setup: MatchSetup } {
  const n = packed >>> 0;
  const bits = n >>> 16;
  return {
    worldSeed: n & 0xffff,
    setup: {
      victory: VICTORY[bits & 3],
      timeLimit: TIMES[(bits >> 2) & 3],
      map: MAPS[(bits >> 4) & 3],
      start: STARTS[(bits >> 6) & 3],
      ai: (bits >> 8) & 3,
      goldTarget: GOLD[(bits >> 10) & 3],
      popTarget: POP[(bits >> 12) & 3],
      surviveMinutes: SURVIVE[(bits >> 14) & 3],
    },
  };
}
