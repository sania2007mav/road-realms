import {
  BEER_POP,
  BUILDINGS,
  HUNGER_POP,
  KEEP_UPGRADE_COST,
  PRICES,
  RATION_POP,
  TAXES,
  TICKS_PER_GAME_MINUTE,
  VARIETY_BONUS,
  costGold,
} from './balance';
import { createBuilding, createSoldier } from './entities';
import { scoreOf } from './match';
import type { BuildingType, Command, DifficultyId, GameState, MatchSetup, PersonalityId, Resource, Weapon } from './types';
import { RESOURCES } from './types';
import { applyCommand, canPlace, housingCap, idleCount, playerKeep, step, suggestedTile } from './update';
import { createGame } from './world';

export interface PriceRow {
  resource: Resource;
  buy: number;
  sell: number;
  spread: number;
}

export function priceRows(): PriceRow[] {
  return RESOURCES.map((resource) => {
    const price = PRICES[resource];
    return { resource, buy: price.buy, sell: price.sell, spread: price.buy - price.sell };
  });
}

/** Positive means buying the input and selling the output prints gold with free labour. */
export interface CraftMargin {
  name: string;
  input: Resource;
  inputQty: number;
  output: Resource;
  outputQty: number;
  margin: number;
}

export function craftMargins(): CraftMargin[] {
  const link = (name: string, input: Resource, output: Resource, inputQty = 1, outputQty = 1): CraftMargin => ({
    name,
    input,
    inputQty,
    output,
    outputQty,
    margin: PRICES[output].sell * outputQty - PRICES[input].buy * inputQty,
  });
  return [
    link('пшеница → мука', 'wheat', 'flour'),
    link('мука → хлеб', 'flour', 'bread'),
    link('пшеница → хлеб', 'wheat', 'bread'),
    link('хмель → пиво', 'hops', 'beer'),
  ];
}

export function marketRoundTripLoss(resource: Resource, qty = 10): number {
  const price = PRICES[resource];
  return qty * (price.buy - price.sell);
}

export interface HousingRow {
  type: BuildingType;
  name: string;
  people: number;
  tiles: number;
  perTile: number;
  buyGold: number;
  perGold: number;
  keepLevel: number;
  denserThanPrevious: boolean;
}

const HOUSING: BuildingType[] = ['shack', 'cabin', 'house', 'khrush', 'highrise'];

export function housingRows(): HousingRow[] {
  let previous = 0;
  return HOUSING.map((type) => {
    const def = BUILDINGS[type];
    const tiles = def.w * def.h;
    const buyGold = Math.max(1, costGold(def.cost, 'buy'));
    const perTile = def.housing / tiles;
    const row: HousingRow = {
      type,
      name: def.name,
      people: def.housing,
      tiles,
      perTile,
      buyGold,
      perGold: def.housing / buyGold,
      keepLevel: def.keepLevel,
      denserThanPrevious: perTile > previous,
    };
    previous = perTile;
    return row;
  });
}

export interface ChainSpec {
  id: string;
  name: string;
  buildings: BuildingType[];
  product: Resource;
}

export const CHAINS: ChainSpec[] = [
  { id: 'apples', name: 'Яблоки', buildings: ['orchard'], product: 'apples' },
  { id: 'cheese', name: 'Сыр', buildings: ['dairy'], product: 'cheese' },
  { id: 'meat', name: 'Мясо', buildings: ['hunter'], product: 'meat' },
  { id: 'bread', name: 'Хлеб', buildings: ['wheat', 'mill', 'bakery'], product: 'bread' },
  { id: 'beer', name: 'Хмель → пиво', buildings: ['hop', 'brewery'], product: 'beer' },
  { id: 'tavern', name: 'Хмель → пиво → таверна', buildings: ['hop', 'brewery', 'tavern'], product: 'beer' },
  { id: 'wood', name: 'Дерево', buildings: ['woodcutter'], product: 'wood' },
  { id: 'stone', name: 'Камень', buildings: ['quarry'], product: 'stone' },
  { id: 'iron', name: 'Железо', buildings: ['mine'], product: 'iron' },
  { id: 'pitch', name: 'Смола', buildings: ['pitch'], product: 'pitch' },
];

export interface ChainResult {
  id: string;
  name: string;
  placed: boolean;
  note: string;
  minutes: number;
  produced: number;
  perMinute: number;
  perTile: number;
  oasisTiles: number;
  buyCost: number;
  paybackMin: number;
  firstMinute: number;
  beerMinutes: number;
  plague: number;
}

function workspace(seed: number): GameState {
  const state = createGame(seed, { ai: 0, setup: { map: 'small', ai: 0, victory: 'conquest' } });
  state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
  const keep = playerKeep(state, 0);
  if (keep) keep.level = 5;
  const player = state.players[0];
  player.stocks.wood = 500;
  player.stocks.stone = 400;
  player.stocks.iron = 80;
  player.ration = 'none';
  player.tax = 'none';
  return state;
}

function findTile(state: GameState, type: BuildingType): { x: number; y: number } | null {
  const near = suggestedTile(state, 0, type);
  if (near) return near;
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      if (canPlace(state, 0, type, x, y).ok) return { x, y };
    }
  }
  return null;
}

function finishBuilding(state: GameState, type: BuildingType) {
  const tile = findTile(state, type);
  if (!tile) return null;
  const ok = applyCommand(state, { kind: 'place', playerId: 0, building: type, x: tile.x, y: tile.y });
  if (!ok) return null;
  const building = state.buildings[state.buildings.length - 1];
  building.complete = true;
  return building;
}

export function measureChain(spec: ChainSpec, seed = 4, minutes = 12): ChainResult {
  const state = workspace(seed);
  const storage = spec.product === 'wood' || spec.product === 'stone' || spec.product === 'iron' || spec.product === 'pitch' || spec.product === 'beer' || spec.buildings.some((type) => BUILDINGS[type].input)
    ? 'stockpile'
    : 'granary';
  if (!finishBuilding(state, storage === 'stockpile' ? 'stockpile' : 'granary')) {
    return emptyChain(spec, 'нет склада');
  }
  if (spec.buildings.some((type) => type === 'wheat' || type === 'mill' || type === 'bakery' || type === 'hop' || type === 'brewery')) {
    if (!state.buildings.some((building) => building.type === 'granary')) finishBuilding(state, 'granary');
    if (!state.buildings.some((building) => building.type === 'stockpile')) finishBuilding(state, 'stockpile');
  }
  const sites = [];
  for (const type of spec.buildings) {
    const building = finishBuilding(state, type);
    if (!building) return emptyChain(spec, `не встало: ${BUILDINGS[type].name}`);
    sites.push(building);
  }
  for (const building of sites) {
    if (BUILDINGS[building.type].workers > 0) {
      applyCommand(state, { kind: 'assign', playerId: 0, buildingId: building.id, delta: 1 });
    }
  }
  const player = state.players[0];
  const start = player.stocks[spec.product];
  let first = -1;
  let beer = 0;
  let plague = 0;
  const ticks = minutes * TICKS_PER_GAME_MINUTE;
  const warmup = 2 * TICKS_PER_GAME_MINUTE;
  const atWarm = { qty: start };
  for (let i = 0; i < ticks; i++) {
    const logs = state.log.length;
    step(state, []);
    if (state.log.length > logs && state.log[state.log.length - 1].includes('Чума')) plague += 1;
    const qty = player.stocks[spec.product];
    if (first < 0 && qty > start) first = state.tick;
    if (player.beerMood > 0) beer += 1;
    if (state.tick === warmup) atWarm.qty = qty;
  }
  const produced = player.stocks[spec.product] - start;
  const steadyTicks = Math.max(1, ticks - warmup);
  const steady = player.stocks[spec.product] - atWarm.qty;
  const perMinute = (steady / steadyTicks) * TICKS_PER_GAME_MINUTE;
  const oasis = sites.reduce((sum, building) => {
    const def = BUILDINGS[building.type];
    return sum + (def.terrain ? def.w * def.h : 0);
  }, 0);
  const buyCost = sites.reduce((sum, building) => sum + costGold(BUILDINGS[building.type].cost, 'buy'), 0);
  const goldPerMin = perMinute * PRICES[spec.product].sell;
  const payback = goldPerMin > 0.01 ? buyCost / goldPerMin : Number.POSITIVE_INFINITY;
  return {
    id: spec.id,
    name: spec.name,
    placed: true,
    note: '',
    minutes,
    produced,
    perMinute,
    perTile: oasis > 0 ? perMinute / oasis : perMinute,
    oasisTiles: oasis,
    buyCost,
    paybackMin: payback,
    firstMinute: first < 0 ? Number.POSITIVE_INFINITY : first / TICKS_PER_GAME_MINUTE,
    beerMinutes: beer / TICKS_PER_GAME_MINUTE,
    plague,
  };
}

function emptyChain(spec: ChainSpec, note: string): ChainResult {
  return {
    id: spec.id,
    name: spec.name,
    placed: false,
    note,
    minutes: 0,
    produced: 0,
    perMinute: 0,
    perTile: 0,
    oasisTiles: 0,
    buyCost: 0,
    paybackMin: Number.POSITIVE_INFINITY,
    firstMinute: Number.POSITIVE_INFINITY,
    beerMinutes: 0,
    plague: 0,
  };
}

export interface TaxSim {
  id: string;
  label: string;
  pop: number;
  goldRate: number;
  people: number;
  popularity: number;
  gold: number;
}

export function measureTaxes(minutes = 8): TaxSim[] {
  return TAXES.map((tax) => {
    const state = createGame(5, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const player = state.players[0];
    player.tax = tax.id;
    player.ration = 'normal';
    player.stocks.apples = 500;
    const start = player.gold;
    for (let i = 0; i < minutes * TICKS_PER_GAME_MINUTE; i++) step(state, []);
    const people = state.people.filter((person) => person.playerId === 0 && person.hp > 0).length;
    return {
      id: tax.id,
      label: tax.label,
      pop: tax.pop,
      goldRate: tax.gold,
      people,
      popularity: player.popularity,
      gold: player.gold - start,
    };
  });
}

export interface DuelResult {
  left: Weapon;
  right: Weapon;
  count: number;
  winner: 'left' | 'right' | 'draw';
  minutes: number;
  leftHp: number;
  rightHp: number;
}

function aimAtEnemy(state: GameState) {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0) continue;
    const current = state.soldiers.find((other) => other.id === soldier.targetId && other.hp > 0 && other.playerId !== soldier.playerId);
    if (soldier.order === 'attack' && current) continue;
    let best: (typeof state.soldiers)[number] | null = null;
    let bestD = Infinity;
    for (const other of state.soldiers) {
      if (other.hp <= 0 || other.playerId === soldier.playerId) continue;
      const dist = Math.hypot(other.x - soldier.x, other.y - soldier.y);
      if (dist < bestD) {
        best = other;
        bestD = dist;
      }
    }
    if (!best) continue;
    soldier.order = 'attack';
    soldier.targetKind = 'soldier';
    soldier.targetId = best.id;
  }
}

export function measureDuel(left: Weapon, right: Weapon, count = 6, gap = 3.2): DuelResult {
  const state = createGame(2, { humans: 2, setup: { map: 'small', ai: 0, victory: 'conquest' } });
  state.mobs = [];
  const ax = 30;
  const ay = 24;
  for (let i = 0; i < count; i++) {
    createSoldier(state, 0, ax + (i % 3) * 0.8, ay + Math.floor(i / 3) * 0.8, left);
    createSoldier(state, 1, ax + (i % 3) * 0.8, ay + gap + Math.floor(i / 3) * 0.8, right);
  }
  const cap = 20 * TICKS_PER_GAME_MINUTE;
  let tick = 0;
  while (tick < cap) {
    const a = state.soldiers.filter((soldier) => soldier.playerId === 0 && soldier.hp > 0);
    const b = state.soldiers.filter((soldier) => soldier.playerId === 1 && soldier.hp > 0);
    if (a.length === 0 || b.length === 0) break;
    aimAtEnemy(state);
    step(state, []);
    tick += 1;
  }
  const leftHp = state.soldiers.filter((soldier) => soldier.playerId === 0).reduce((sum, soldier) => sum + Math.max(0, soldier.hp), 0);
  const rightHp = state.soldiers.filter((soldier) => soldier.playerId === 1).reduce((sum, soldier) => sum + Math.max(0, soldier.hp), 0);
  const winner = leftHp > 0 && rightHp <= 0 ? 'left' : rightHp > 0 && leftHp <= 0 ? 'right' : 'draw';
  return { left, right, count, winner, minutes: tick / TICKS_PER_GAME_MINUTE, leftHp, rightHp };
}

export interface WallResult {
  weapon: Weapon;
  count: number;
  wall: BuildingType;
  minutes: number;
  broke: boolean;
  hpLeft: number;
}

export function measureWall(weapon: Weapon, wall: BuildingType, count = 1): WallResult {
  const state = createGame(3, { ai: 0, setup: { map: 'small', ai: 0 } });
  state.mobs = [];
  const keep = playerKeep(state, 0)!;
  keep.level = 5;
  const building = createBuilding(state, 1, wall, keep.x + 8, keep.y, true);
  const foe = state.players[0];
  foe.stocks.wood = 40;
  for (let i = 0; i < count; i++) {
    const soldier = createSoldier(state, 0, building.x + 0.2 + (i % 3) * 0.7, building.y + 2.2 + Math.floor(i / 3) * 0.7, weapon);
    soldier.order = 'attack';
    soldier.targetKind = 'building';
    soldier.targetId = building.id;
  }
  const cap = 30 * TICKS_PER_GAME_MINUTE;
  let tick = 0;
  while (tick < cap && building.hp > 0) {
    step(state, []);
    tick += 1;
  }
  return {
    weapon,
    count,
    wall,
    minutes: tick / TICKS_PER_GAME_MINUTE,
    broke: building.hp <= 0,
    hpLeft: Math.max(0, building.hp),
  };
}

export interface MatchResult {
  seed: number;
  kind: string;
  victory: string;
  map: string;
  minutes: number;
  finished: boolean;
  winnerId: number;
  outcome: string;
  keepMinute: number[][];
  scores: number[];
  alive: boolean[];
  gold: number[];
}

function keepLevels(state: GameState): number[] {
  return state.players.map((player) => playerKeep(state, player.id)?.level ?? 0);
}

export function runMatch(
  seed: number,
  setup: Partial<MatchSetup> & { ai: number },
  capMinutes: number,
  kind: string,
  scripted = false,
): MatchResult {
  const arena = !scripted && setup.ai >= 2;
  const state = createGame(seed, { ai: setup.ai, arena, setup });
  const reached: number[][] = state.players.map(() => [0, 0, 0, 0]);
  const cap = capMinutes * TICKS_PER_GAME_MINUTE;
  while (state.outcome === 'playing' && state.tick < cap) {
    let command: Command | null = null;
    if (scripted && state.tick % 40 === 0) command = scriptedCommand(state);
    step(state, command ? [command] : []);
    if (state.tick % TICKS_PER_GAME_MINUTE === 0) {
      const levels = keepLevels(state);
      levels.forEach((level, index) => {
        for (let stepLevel = 2; stepLevel <= 5; stepLevel++) {
          if (level >= stepLevel && reached[index][stepLevel - 2] === 0) reached[index][stepLevel - 2] = state.tick / TICKS_PER_GAME_MINUTE;
        }
      });
    }
  }
  return {
    seed,
    kind,
    victory: state.match?.victory ?? 'conquest',
    map: state.match?.map ?? 'normal',
    minutes: state.tick / TICKS_PER_GAME_MINUTE,
    finished: state.outcome !== 'playing',
    winnerId: state.winnerId,
    outcome: state.outcome,
    keepMinute: reached,
    scores: state.players.map((player) => scoreOf(state, player)),
    alive: state.players.map((player) => player.alive),
    gold: state.players.map((player) => player.gold),
  };
}

export interface ClimbResult {
  seed: number;
  minutes: number[];
  finished: boolean;
  gold: number;
  people: number;
}

const CLIMB_BUILD: BuildingType[] = ['granary', 'woodcutter', 'orchard', 'stockpile', 'quarry', 'shack', 'mine'];

export function climbCommand(state: GameState): Command | null {
  const player = state.players[0];
  if (!player?.alive) return null;
  if (idleCount(state, 0) > 0) {
    const site = state.buildings.find((building) => {
      if (building.playerId !== 0 || !building.complete || building.hp <= 0) return false;
      return building.workerIds.length < BUILDINGS[building.type].workers;
    });
    if (site) return { kind: 'assign', playerId: 0, buildingId: site.id, delta: 1 };
  }
  const keep = playerKeep(state, 0);
  for (const type of CLIMB_BUILD) {
    if (type === 'mine' && (keep?.level ?? 1) < 2) continue;
    if (countType(state, type) >= 1) continue;
    const tile = suggestedTile(state, 0, type);
    if (!tile) continue;
    return { kind: 'place', playerId: 0, building: type, x: tile.x, y: tile.y };
  }
  if (keep && keep.level < 5 && !keep.upgrading) {
    const cost = KEEP_UPGRADE_COST[keep.level];
    if (cost && affordable(player.stocks, cost)) return { kind: 'upgrade', playerId: 0, buildingId: keep.id };
  }
  return null;
}

export function measureKeepClimb(seed = 4, capMinutes = 120): ClimbResult {
  const state = createGame(seed, { ai: 0, setup: { map: 'normal', ai: 0, victory: 'conquest' } });
  state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
  const reached = [0, 0, 0, 0];
  const cap = capMinutes * TICKS_PER_GAME_MINUTE;
  while (state.tick < cap && reached[3] === 0) {
    const command = state.tick % 40 === 0 ? climbCommand(state) : null;
    step(state, command ? [command] : []);
    const level = playerKeep(state, 0)?.level ?? 1;
    if (state.tick % TICKS_PER_GAME_MINUTE === 0) {
      for (let stepLevel = 2; stepLevel <= 5; stepLevel++) {
        if (level >= stepLevel && reached[stepLevel - 2] === 0) reached[stepLevel - 2] = state.tick / TICKS_PER_GAME_MINUTE;
      }
    }
  }
  return {
    seed,
    minutes: reached,
    finished: reached[3] > 0,
    gold: state.players[0].gold,
    people: peopleNow(state),
  };
}

const SCRIPT_BUILD: BuildingType[] = ['granary', 'stockpile', 'woodcutter', 'orchard', 'barracks', 'shack', 'quarry', 'shack', 'cabin'];

function affordable(stocks: GameState['players'][number]['stocks'], cost: Partial<Record<Resource, number>>): boolean {
  for (const key of Object.keys(cost) as Resource[]) {
    if ((cost[key] ?? 0) > (stocks[key] ?? 0)) return false;
  }
  return true;
}

function countType(state: GameState, type: BuildingType): number {
  return state.buildings.filter((building) => building.playerId === 0 && building.type === type && building.hp > 0).length;
}

export function scriptedCommand(state: GameState): Command | null {
  const player = state.players[0];
  if (!player?.alive) return null;
  if (idleCount(state, 0) > 0) {
    const site = state.buildings.find((building) => {
      if (building.playerId !== 0 || !building.complete || building.hp <= 0) return false;
      return building.workerIds.length < BUILDINGS[building.type].workers;
    });
    if (site) return { kind: 'assign', playerId: 0, buildingId: site.id, delta: 1 };
  }
  for (const type of SCRIPT_BUILD) {
    const want = type === 'shack' ? 2 : 1;
    if (countType(state, type) >= want) continue;
    const tile = suggestedTile(state, 0, type);
    if (!tile) continue;
    return { kind: 'place', playerId: 0, building: type, x: tile.x, y: tile.y };
  }
  const keep = playerKeep(state, 0);
  if (keep && keep.level < 4 && !keep.upgrading) {
    const cost = KEEP_UPGRADE_COST[keep.level];
    if (cost && affordable(player.stocks, cost)) {
      return { kind: 'upgrade', playerId: 0, buildingId: keep.id };
    }
  }
  const soldiers = state.soldiers.filter((soldier) => soldier.playerId === 0 && soldier.hp > 0);
  if (soldiers.length < 3 && countType(state, 'barracks') > 0 && idleCount(state, 0) > 0) {
    return { kind: 'train', playerId: 0, weapon: 'club' };
  }
  if (soldiers.length >= 3 && state.tick >= 10 * TICKS_PER_GAME_MINUTE) {
    const foe = state.buildings.find((building) => building.playerId !== 0 && building.hp > 0 && building.complete && building.type === 'granary')
      ?? state.buildings.find((building) => building.playerId !== 0 && building.hp > 0 && building.type === 'keep');
    if (!foe) return null;
    if (soldiers.every((soldier) => soldier.order === 'attack' && soldier.targetId === foe.id)) return null;
    return {
      kind: 'army',
      playerId: 0,
      ids: soldiers.map((soldier) => soldier.id),
      mode: 'attack',
      x: foe.x + 1,
      y: foe.y + 1,
      target: 'building',
      targetId: foe.id,
    };
  }
  return null;
}

export function arenaMatch(seed: number, victory: MatchSetup['victory'], cap: number, map: MatchSetup['map'] = 'small'): MatchResult {
  const profiles = [
    { difficulty: 'normal' as DifficultyId, personality: 'merchant' as PersonalityId },
    { difficulty: 'normal' as DifficultyId, personality: 'warlord' as PersonalityId },
  ];
  return runMatch(seed, { ai: 2, victory, map, timeLimit: 0, profiles }, cap, `арена ${victory}`, false);
}

export function scriptedConquest(seed: number, cap: number, map: MatchSetup['map'] = 'normal'): MatchResult {
  return runMatch(
    seed,
    {
      ai: 1,
      victory: 'conquest',
      map,
      timeLimit: 0,
      profiles: [{ difficulty: 'normal', personality: 'warlord' }],
    },
    cap,
    'сценарий против нормального',
    true,
  );
}

export interface DifficultyScore {
  difficulty: DifficultyId;
  score: number;
  people: number;
  keep: number;
}

export function difficultySnapshot(seed: number, minutes = 12): DifficultyScore[] {
  const difficulties: DifficultyId[] = ['easy', 'normal', 'hard', 'cruel'];
  return difficulties.map((difficulty) => {
    const state = createGame(seed, {
      ai: 1,
      setup: {
        map: 'small',
        victory: 'wealth',
        goldTarget: 99999,
        timeLimit: minutes,
        ai: 1,
        profiles: [{ difficulty, personality: 'strategist' }],
      },
    });
    while (state.outcome === 'playing') step(state, []);
    const player = state.players[1];
    return {
      difficulty,
      score: scoreOf(state, player),
      people: state.people.filter((person) => person.playerId === player.id && person.hp > 0).length,
      keep: playerKeep(state, player.id)?.level ?? 0,
    };
  });
}

export function popularityLines(): { label: string; value: number }[] {
  return [
    ...Object.entries(RATION_POP).map(([id, value]) => ({ label: `паёк ${id}`, value })),
    ...VARIETY_BONUS.map((value, index) => ({ label: `видов еды: ${index}`, value })),
    ...TAXES.map((tax) => ({ label: tax.label, value: tax.pop })),
    { label: 'пиво', value: BEER_POP },
    { label: 'голод', value: HUNGER_POP },
  ];
}

export function peopleNow(state: GameState, playerId = 0): number {
  return state.people.filter((person) => person.playerId === playerId && person.hp > 0).length;
}

export function housingHeadroom(state: GameState, playerId = 0): number {
  return housingCap(state, playerId) - peopleNow(state, playerId);
}
