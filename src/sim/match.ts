import { MAP_H, MAP_W, START_GOLD, START_STOCKS, TICKS_PER_GAME_MINUTE } from './balance';
import type {
  AiProfile,
  DifficultyId,
  Food,
  GameState,
  MapSizeId,
  MatchSetup,
  PersonalityId,
  Player,
  PlayerStats,
  StartId,
  VictoryId,
} from './types';

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'cruel'] as const;
export const PERSONALITIES = ['merchant', 'warlord', 'builder', 'strategist'] as const;

/** One gold per game minute. The only resource bonus in the game, and only on this difficulty. */
export const CRUEL_GOLD_PER_MINUTE = 1;

export const CRUEL_BONUS_TEXT =
  'Сложность меняет скорость решений, бережливость и срок первого набега. «Жестокий» дополнительно получает 1 золото за игровую минуту. «Лёгкий», «Нормальный» и «Сложный» играют без прибавки к запасам.';

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
  const setup: MatchSetup = {
    victory: partial.victory ?? base.victory,
    timeLimit: finite(partial.timeLimit, base.timeLimit),
    map: partial.map ?? base.map,
    start: partial.start ?? base.start,
    ai: finite(partial.ai, base.ai),
    goldTarget: finite(partial.goldTarget, base.goldTarget),
    popTarget: finite(partial.popTarget, base.popTarget),
    surviveMinutes: finite(partial.surviveMinutes, base.surviveMinutes),
  };
  if (partial.profiles) setup.profiles = normalizeProfiles(partial.profiles);
  return setup;
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
  const faces =
    setup.profiles && setup.ai > 0
      ? ` ${setup.profiles
          .slice(0, setup.ai)
          .map((profile) => `${personalityName(profile.personality)} (${difficultyName(profile.difficulty).toLowerCase()})`)
          .join(', ')}.`
      : '';
  return `${victoryName(setup.victory)}${extra}. ${map}, ${start}, соседей ${setup.ai}${time}.${faces}`;
}

export function defaultProfiles(): AiProfile[] {
  return [
    { difficulty: 'normal', personality: 'merchant' },
    { difficulty: 'normal', personality: 'warlord' },
    { difficulty: 'normal', personality: 'builder' },
  ];
}

export function difficultyName(id: DifficultyId | undefined): string {
  if (id === 'easy') return 'Лёгкий';
  if (id === 'hard') return 'Сложный';
  if (id === 'cruel') return 'Жестокий';
  return 'Нормальный';
}

export function personalityName(id: PersonalityId | undefined): string {
  if (id === 'merchant') return 'Купец';
  if (id === 'warlord') return 'Воевода';
  if (id === 'builder') return 'Зодчий';
  return 'Стратег';
}

function isDifficulty(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard' || value === 'cruel';
}

function isPersonality(value: unknown): value is PersonalityId {
  return value === 'merchant' || value === 'warlord' || value === 'builder' || value === 'strategist';
}

export function normalizeProfiles(list?: AiProfile[] | null): AiProfile[] {
  const base = defaultProfiles();
  return [0, 1, 2].map((index) => {
    const row = list?.[index];
    return {
      difficulty: isDifficulty(row?.difficulty) ? row.difficulty : base[index].difficulty,
      personality: isPersonality(row?.personality) ? row.personality : base[index].personality,
    };
  });
}

/** Lobby rules reject new fields. The name is an existing 1–32 string, so AI profiles ride a 7-character suffix. */
export function packLobbyName(name: string, profiles?: AiProfile[] | null): string {
  const list = normalizeProfiles(profiles);
  const digits =
    list.map((profile) => String(DIFFICULTIES.indexOf(profile.difficulty))).join('') +
    list.map((profile) => String(PERSONALITIES.indexOf(profile.personality))).join('');
  const base = displayLobbyName(name).replace(/~/g, '').trim().slice(0, 25);
  return `${base || 'Тракт'}~${digits}`;
}

export function displayLobbyName(name: string): string {
  return name.replace(/~[0-3]{6}$/, '');
}

export function profilesFromLobbyName(name: string): AiProfile[] | null {
  const found = name.match(/~([0-3]{6})$/);
  if (!found) return null;
  const digits = found[1];
  return [0, 1, 2].map((index) => ({
    difficulty: DIFFICULTIES[Number(digits[index])] ?? 'normal',
    personality: PERSONALITIES[Number(digits[index + 3])] ?? 'strategist',
  }));
}

export interface ResultCopy {
  won: boolean;
  title: string;
  detail: string;
}

export function viewerWon(state: GameState, localPlayer: number, netMode: boolean): boolean {
  if (!netMode) return state.outcome === 'victory';
  if (state.winnerId === -2) return !!state.players[localPlayer]?.alive;
  if (state.winnerId >= 0) return state.winnerId === localPlayer;
  return !!state.players[localPlayer]?.alive;
}

function livingOf(state: GameState, playerId: number): number {
  let count = 0;
  for (const person of state.people) if (person.playerId === playerId && person.hp > 0) count += 1;
  return count;
}

/** True only when the recorded ending really satisfied the victory condition. */
export function conditionMet(state: GameState): boolean {
  const setup = state.match;
  if (!setup || state.outcome === 'playing') return false;
  if (setup.victory === 'wealth') return state.players.some((player) => player.alive && player.gold >= setup.goldTarget);
  if (setup.victory === 'bloom') {
    return state.players.some((player) => {
      if (!player.alive) return false;
      const keep = state.buildings.find((building) => building.playerId === player.id && building.type === 'keep');
      return (keep?.level ?? 0) >= 5 && livingOf(state, player.id) >= setup.popTarget;
    });
  }
  if (setup.victory === 'survival') {
    return state.tick >= setup.surviveMinutes * TICKS_PER_GAME_MINUTE && state.players.some((player) => player.alive);
  }
  const clock = setup.timeLimit > 0 && state.tick >= setup.timeLimit * TICKS_PER_GAME_MINUTE;
  const lastKeep = state.players.filter((player) => player.alive).length <= 1 && state.winnerId >= 0;
  if (clock) return lastKeep;
  return lastKeep;
}

export function resultCopy(state: GameState, localPlayer: number, netMode: boolean): ResultCopy {
  const won = viewerWon(state, localPlayer, netMode);
  const winner = state.winnerId >= 0 ? state.players.find((player) => player.id === state.winnerId) : undefined;
  const reason = victoryName(state.match?.victory ?? 'conquest');
  if (!won) {
    if (winner) return { won: false, title: 'Поражение', detail: `Поражение — победил ${winner.name}.` };
    return { won: false, title: 'Поражение', detail: 'Поражение.' };
  }
  const named = winner ? ` Победил ${winner.name}.` : '';
  if (conditionMet(state)) return { won: true, title: 'Победа', detail: `Условие «${reason}» выполнено.${named}` };
  return { won: true, title: 'Победа', detail: winner ? `Победил ${winner.name}.` : 'Матч окончен.' };
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
