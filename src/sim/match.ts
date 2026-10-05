import { MAP_H, MAP_W, START_GOLD, START_STOCKS, TICKS_PER_GAME_MINUTE } from './balance';
import { eventName, eventPace } from './events';
import { paceName, seasonPace } from './seasons';
import type {
  AiProfile,
  DifficultyId,
  Food,
  GameState,
  MapSizeId,
  MatchSetup,
  PersonalityId,
  Player,
  TeamMode,
  PlayerStats,
  EventPace,
  SeasonPace,
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
    seasons: seasonPace(partial.seasons),
    events: eventPace(partial.events),
  };
  if (partial.seasonShift === 1 || partial.seasonShift === 2 || partial.seasonShift === 3) setup.seasonShift = partial.seasonShift;
  if (partial.teams === 'pairs' || partial.teams === 'ffa') setup.teams = partial.teams;
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

/** «12 человек» is the short Расцвет: keep 4. The 20 and 30 tiers still need keep 5. Other targets stay on keep 5. */
export function bloomKeepLevel(popTarget: number): number {
  return popTarget === 12 ? 4 : 5;
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
        ? `, уровень ${bloomKeepLevel(setup.popTarget)} и ${setup.popTarget} людей`
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
  const teams = setup.teams === 'pairs' ? ' Команды: двое на двое.' : '';
  const year = setup.seasons && setup.seasons !== 'off' ? ` Сезоны: ${paceName(setup.seasons)}.` : '';
  const events = setup.events && setup.events !== 'off' ? ` События на тракте: ${eventName(setup.events)}.` : '';
  return `${victoryName(setup.victory)}${extra}. ${map}, ${start}, соседей ${setup.ai}${time}.${faces}${teams}${year}${events}`;
}

/** Seat order splits in half: 0..half-1 against the rest. Two players are opponents; four are 2v2. */
export function teamOf(playerId: number, playerCount: number): number {
  const half = Math.max(1, Math.ceil(Math.max(1, playerCount) / 2));
  return playerId < half ? 0 : 1;
}

export function hostile(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (state.match?.teams !== 'pairs') return true;
  const count = state.players.length;
  return teamOf(a, count) !== teamOf(b, count);
}

export interface LobbyConfig {
  speed: 1 | 2 | 3;
  teams: TeamMode;
  difficulty: DifficultyId;
}

const SPEEDS = [1, 2, 3] as const;

/** Extra lobby settings that do not fit in the 16 match bits of the seed. */
export function packConfig(config: LobbyConfig): number {
  const speed = config.speed === 2 ? 1 : config.speed === 3 ? 2 : 0;
  const teams = config.teams === 'pairs' ? 1 : 0;
  const difficulty = Math.max(0, DIFFICULTIES.indexOf(config.difficulty)) & 3;
  return (speed | (teams << 2) | (difficulty << 3)) >>> 0;
}

export function unpackConfig(raw: number | null | undefined): LobbyConfig {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { speed: 1, teams: 'ffa', difficulty: 'normal' };
  const n = raw >>> 0;
  const speed = SPEEDS[(n & 3) === 1 ? 1 : (n & 3) === 2 ? 2 : 0];
  return {
    speed,
    teams: (n >> 2) & 1 ? 'pairs' : 'ffa',
    difficulty: DIFFICULTIES[(n >> 3) & 3] ?? 'normal',
  };
}

export function lobbySummary(setup: MatchSetup, config: LobbyConfig, ranked = false): string {
  const map = setup.map === 'small' ? 'малая' : setup.map === 'large' ? 'большая' : 'обычная';
  if (ranked) return `Рейтинговая · завоевание · ${map} · 1×`;
  const start = setup.start === 'low' ? 'скудные' : setup.start === 'high' ? 'богатые' : 'обычные';
  const teams = config.teams === 'pairs' ? '2×2' : 'каждый сам';
  const year = setup.seasons && setup.seasons !== 'off' ? ` · сезоны ${paceName(setup.seasons)}` : '';
  const events = setup.events && setup.events !== 'off' ? ` · тракт ${eventName(setup.events)}` : '';
  return `${victoryName(setup.victory)} · ${map} · ${config.speed}× · ${start} · соседи ${setup.ai} · ${teams}${year}${events}`;
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

const LOBBY_TAIL = /~([0-3]{6})(?:([012])([01])([012])?([0-3])?(r)?(?:([0-9a-f]{8}|-{8}))?)?$/;

export interface LobbyTail {
  speed: 1 | 2 | 3;
  teams: TeamMode;
  /** First 8 hex chars of the password hash, or empty when the room is open. */
  lock: string;
  seasons: SeasonPace;
  events: EventPace;
  /** Ranked 1v1. The letter sits in the name because the seed's high bits are already full. */
  ranked: boolean;
}

/** Fixed 1v1. Only the map size stays open. */
export function rankedSetup(map: MatchSetup['map']): MatchSetup {
  return normalizeSetup({
    victory: 'conquest',
    timeLimit: 0,
    map,
    start: 'normal',
    ai: 0,
    teams: 'ffa',
    seasons: 'off',
    events: 'off',
  });
}

/** The lobby name is an existing 1–32 string. Profiles, speed, teams and a password tag share its suffix. */
export function packLobbyName(name: string, profiles?: AiProfile[] | null, tail?: Partial<LobbyTail> | null): string {
  const list = normalizeProfiles(profiles);
  const digits =
    list.map((profile) => String(DIFFICULTIES.indexOf(profile.difficulty))).join('') +
    list.map((profile) => String(PERSONALITIES.indexOf(profile.personality))).join('');
  const shown = displayLobbyName(name).replace(/~/g, '').trim();
  if (!tail) return `${shown.slice(0, 25) || 'Тракт'}~${digits}`;
  const speed = tail.ranked ? '0' : tail.speed === 2 ? '1' : tail.speed === 3 ? '2' : '0';
  const teams = tail.ranked ? '0' : tail.teams === 'pairs' ? '1' : '0';
  let season = tail.seasons === 'normal' ? '1' : tail.seasons === 'long' ? '2' : tail.seasons === 'off' ? '0' : '';
  let events = tail.events === 'rare' ? '1' : tail.events === 'normal' ? '2' : tail.events === 'often' ? '3' : '';
  if (tail.ranked) {
    season = '0';
    events = '0';
  } else if (events && !season) season = '0';
  const lock = !tail.ranked && tail.lock && /^[0-9a-f]{8}$/.test(tail.lock) ? tail.lock : '';
  const ranked = tail.ranked ? 'r' : '';
  const suffix = `${digits}${speed}${teams}${season}${events}${ranked}${lock}`;
  const cap = Math.max(1, 32 - suffix.length - 1);
  return `${shown.slice(0, cap) || 'Тракт'}~${suffix}`;
}

export function displayLobbyName(name: string): string {
  return name.replace(LOBBY_TAIL, '');
}

export function profilesFromLobbyName(name: string): AiProfile[] | null {
  const found = name.match(LOBBY_TAIL);
  if (!found) return null;
  const digits = found[1];
  return [0, 1, 2].map((index) => ({
    difficulty: DIFFICULTIES[Number(digits[index])] ?? 'normal',
    personality: PERSONALITIES[Number(digits[index + 3])] ?? 'strategist',
  }));
}

export function tailFromLobbyName(name: string): LobbyTail {
  const found = name.match(LOBBY_TAIL);
  const seasons = found?.[4] === '1' ? 'normal' : found?.[4] === '2' ? 'long' : 'off';
  const events = found?.[5] === '1' ? 'rare' : found?.[5] === '2' ? 'normal' : found?.[5] === '3' ? 'often' : 'off';
  const ranked = found?.[6] === 'r';
  if (!found || found[2] == null) return { speed: 1, teams: 'ffa', lock: '', seasons: 'off', events: 'off', ranked: false };
  return {
    speed: ranked ? 1 : found[2] === '1' ? 2 : found[2] === '2' ? 3 : 1,
    teams: ranked ? 'ffa' : found[3] === '1' ? 'pairs' : 'ffa',
    lock: ranked ? '' : found[7] && !found[7].startsWith('-') ? found[7] : '',
    seasons: ranked ? 'off' : seasons,
    events: ranked ? 'off' : events,
    ranked,
  };
}

export interface ResultCopy {
  won: boolean;
  title: string;
  detail: string;
}

export function viewerWon(state: GameState, localPlayer: number, netMode: boolean): boolean {
  if (!netMode) return state.outcome === 'victory';
  if (state.winnerId === -2) return !!state.players[localPlayer]?.alive;
  if (state.match?.teams === 'pairs' && state.winnerId >= 0) {
    return teamOf(localPlayer, state.players.length) === teamOf(state.winnerId, state.players.length);
  }
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
  if (setup.teams === 'pairs' && setup.victory === 'conquest') {
    const alive = state.players.filter((player) => player.alive);
    const standing = new Set(alive.map((player) => teamOf(player.id, state.players.length)));
    const sides = new Set(state.players.map((player) => teamOf(player.id, state.players.length)));
    if (sides.size >= 2 && standing.size <= 1 && state.winnerId >= 0) return true;
  }
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
    setup: normalizeSetup({
      victory: VICTORY[bits & 3],
      timeLimit: TIMES[(bits >> 2) & 3],
      map: MAPS[(bits >> 4) & 3],
      start: STARTS[(bits >> 6) & 3],
      ai: (bits >> 8) & 3,
      goldTarget: GOLD[(bits >> 10) & 3],
      popTarget: POP[(bits >> 12) & 3],
      surviveMinutes: SURVIVE[(bits >> 14) & 3],
    }),
  };
}
