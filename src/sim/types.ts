export const RESOURCES = [
  'wood',
  'stone',
  'iron',
  'pitch',
  'apples',
  'cheese',
  'meat',
  'bread',
  'wheat',
  'flour',
  'hops',
  'beer',
  'horses',
  'weapons',
  'armor',
  'crossbows',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const FOODS = ['apples', 'cheese', 'meat', 'bread'] as const;
export type Food = (typeof FOODS)[number];

export type Ration = 'none' | 'half' | 'normal' | 'double' | 'feast';
export type TaxId = 'none' | 'low' | 'normal' | 'high' | 'harsh' | 'cruel';

export type BuildingType =
  | 'keep'
  | 'shack'
  | 'cabin'
  | 'house'
  | 'khrush'
  | 'highrise'
  | 'granary'
  | 'stockpile'
  | 'woodcutter'
  | 'orchard'
  | 'dairy'
  | 'hunter'
  | 'wheat'
  | 'mill'
  | 'bakery'
  | 'hop'
  | 'brewery'
  | 'tavern'
  | 'quarry'
  | 'mine'
  | 'pitch'
  | 'market'
  | 'stable'
  | 'smith'
  | 'armoury'
  | 'barracks'
  | 'palisade'
  | 'wall'
  | 'gate'
  | 'stairs'
  | 'woodtower'
  | 'stonetower'
  | 'moat'
  | 'pitchditch'
  | 'brazier'
  | 'oil'
  | 'guild'
  | 'workshop'
  | 'chapel'
  | 'merccamp';

export type Weapon =
  | 'club'
  | 'sword'
  | 'bow'
  | 'spear'
  | 'light'
  | 'heavy'
  | 'crossbow'
  | 'shield'
  | 'horsebow'
  | 'engineer'
  | 'ladder'
  | 'siegetower'
  | 'healer'
  | 'raider'
  | 'axe'
  | 'ram'
  | 'catapult';

export type Terrain = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const Terrain = {
  Land: 0,
  Desert: 1,
  Oasis: 2,
  Forest: 3,
  Limestone: 4,
  Iron: 5,
  Swamp: 6,
  Road: 7,
} as const;

export type WorkMode = 'goto' | 'labor' | 'fetch' | 'return' | 'deliver';

export type Task =
  | { type: 'idle' }
  | { type: 'build'; buildingId: number }
  | { type: 'work'; buildingId: number; mode: WorkMode; targetId: number };

export interface Player {
  id: number;
  name: string;
  isAi: boolean;
  alive: boolean;
  side: 'north' | 'south';
  spawnX: number;
  spawnY: number;
  color: string;
  gold: number;
  stocks: Record<Resource, number>;
  popularity: number;
  ration: Ration;
  tax: TaxId;
  hunger: boolean;
  beerMood: number;
  /** 1 after the armoury hardens mail. Arrow hits on this player's soldiers are weaker. */
  mail: number;
  migrate: number;
  stats: PlayerStats;
  difficulty: DifficultyId;
  personality: PersonalityId;
}

export interface PlayerStats {
  peakPop: number;
  food: Record<Food, number>;
  goldEarned: number;
  buildings: number;
  soldiers: number;
  kills: number;
  razed: number;
}

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type SeasonPace = 'off' | 'normal' | 'long';
export type WeatherId = 'clear' | 'rain' | 'heat' | 'storm' | 'snow' | 'drought';
export type EventPace = 'off' | 'rare' | 'normal' | 'often';

export type VictoryId = 'conquest' | 'wealth' | 'bloom' | 'survival';
export type MapSizeId = 'small' | 'normal' | 'large';
export type StartId = 'low' | 'normal' | 'high';
export type TeamMode = 'ffa' | 'pairs';
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'cruel';
export type PersonalityId = 'merchant' | 'warlord' | 'builder' | 'strategist';

export interface AiProfile {
  difficulty: DifficultyId;
  personality: PersonalityId;
}

export interface MatchSetup {
  victory: VictoryId;
  /** Game minutes. 0 means the match waits for the victory condition. */
  timeLimit: number;
  map: MapSizeId;
  start: StartId;
  ai: number;
  goldTarget: number;
  popTarget: number;
  surviveMinutes: number;
  /** Free-for-all, or two sides split by seat order. Omitted means free-for-all. */
  teams?: TeamMode;
  /** Up to three AI neighbours. Omitted in the packed seed; lobbies carry it in the name. */
  profiles?: AiProfile[];
  /** Season length. Omitted means off, so old matches and the campaign stay on a clear year. */
  seasons?: SeasonPace;
  /** Road events. Omitted means off, so the campaign and the balance runs stay quiet. */
  events?: EventPace;
}

export interface Sample {
  t: number;
  pop: number[];
  gold: number[];
}

export interface Building {
  id: number;
  playerId: number;
  type: BuildingType;
  x: number;
  y: number;
  complete: boolean;
  buildProgress: number;
  workerIds: number[];
  level: number;
  hp: number;
  maxHp: number;
  buffer: number;
  bufferRes: Resource | null;
  input: number;
  inputRes: Resource | null;
  work: number;
  plague: number;
  upgrading: boolean;
  /** Smith cycle. 0 weapon, 1 armour, 2 crossbow (iron and one wood). */
  gear: number;
  /** 1 when a fort wall has cut this building off from the keep. */
  seal: number;
  /** 1 after the owner's keep falls and the building is left as rubble. */
  ruin: number;
}

export interface Person {
  id: number;
  playerId: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  task: Task;
  cargo: Resource | null;
  cargoQty: number;
  destX: number;
  destY: number;
  destBuildingId: number;
  flee: boolean;
  anim: number;
  idlePhase: number;
}

export interface Soldier {
  id: number;
  playerId: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  weapon: Weapon;
  order: 'defend' | 'raid' | 'move' | 'hold' | 'attack' | 'attackmove' | 'home';
  raidTargetId: number;
  anim: number;
  destX: number;
  destY: number;
  anchorX: number;
  anchorY: number;
  targetKind: 'none' | 'soldier' | 'mob' | 'building';
  targetId: number;
  /** Flat [x, y, x, y, ...] tile centres. */
  waypoints: number[];
  waypointI: number;
  /** 1 until a heavy cavalryman's first blow. */
  charge: number;
  /** 1 when the soldier was trained in armour. Lowers arrow damage. */
  armor: number;
  /** 1 when a ladder is set against a wall, 2 when a siege tower is docked. */
  dock: number;
  /** 1 when the soldier was hired for gold and draws upkeep. */
  merc: number;
}

export interface Ox {
  id: number;
  playerId: number;
  buildingId: number;
  x: number;
  y: number;
  cargo: Resource | null;
  cargoQty: number;
  mode: 'load' | 'deliver';
  destX: number;
  destY: number;
  destBuildingId: number;
}

export type MobKind = 'wolf' | 'bear' | 'bandit' | 'deer';

export interface Mob {
  id: number;
  kind: MobKind;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hp: number;
  maxHp: number;
  dmg: number;
  alive: boolean;
  respawn: number;
  wander: number;
  destX: number;
  destY: number;
  /** 1 when this bandit belongs to a road raid and should not respawn with the wild herds. */
  raid?: number;
}

export interface Caravan {
  id: number;
  fromId: number;
  toId: number;
  x: number;
  y: number;
  toX: number;
  hp: number;
  gold: number;
  wood: number;
  apples: number;
  iron: number;
  weapons: number;
  alive: boolean;
}

export interface RoadFair {
  playerId: number;
  x: number;
  y: number;
  until: number;
}

export interface RoadParty {
  id: number;
  kind: 'travelers' | 'refugees';
  playerId: number;
  x: number;
  y: number;
  count: number;
  until: number;
}

export interface RoadNote {
  id: number;
  text: string;
  x: number;
  y: number;
  until: number;
}

export interface RoadState {
  caravans: Caravan[];
  fair: RoadFair | null;
  party: RoadParty | null;
  notes: RoadNote[];
  /** Player id who wronged this seat, or -1. */
  anger: number[];
  seq: number;
}

export interface Cloud {
  id: number;
  playerId: number;
  x: number;
  y: number;
  ticks: number;
  radius: number;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  tick: number;
  rng: number;
  mapW: number;
  mapH: number;
  roadY: number;
  terrain: Uint8Array;
  /** Player-drawn roads. 1 on a tile that is not the main trakt. Missing on old saves. */
  roads: Uint8Array;
  nextId: number;
  players: Player[];
  buildings: Building[];
  people: Person[];
  soldiers: Soldier[];
  oxen: Ox[];
  mobs: Mob[];
  clouds: Cloud[];
  match: MatchSetup;
  samples: Sample[];
  /** -1 while the match is open, -2 when every survivor wins, otherwise the winning player id. */
  winnerId: number;
  outcome: 'playing' | 'victory' | 'defeat';
  message: string;
  log: string[];
  /** Derived from tick, seed and match.seasons. Stored so the hash and saves share one value. */
  season: SeasonId | 'off';
  weather: WeatherId;
  /** Caravans, fairs, raids and travelers. Missing on old saves, which stay quiet. */
  road?: RoadState;
}

export type Command =
  | { kind: 'place'; playerId: number; building: BuildingType; x: number; y: number }
  | { kind: 'assign'; playerId: number; buildingId: number; delta: 1 | -1 }
  | { kind: 'ration'; playerId: number; ration: Ration }
  | { kind: 'tax'; playerId: number; tax: TaxId }
  | { kind: 'upgrade'; playerId: number; buildingId: number }
  | { kind: 'market'; playerId: number; resource: Resource; mode: 'buy' | 'sell'; qty: number }
  | { kind: 'trade'; playerId: number; caravanId: number; resource: Resource; mode: 'buy' | 'sell'; qty: number }
  | { kind: 'sack'; playerId: number; caravanId: number }
  | { kind: 'train'; playerId: number; weapon: Weapon }
  | { kind: 'hire'; playerId: number; weapon: 'raider' | 'axe' }
  | { kind: 'mail'; playerId: number }
  | { kind: 'cow'; playerId: number; soldierId: number; x: number; y: number }
  | { kind: 'order'; playerId: number; order: 'defend' | 'raid' }
  | {
      kind: 'army';
      playerId: number;
      ids: number[];
      mode: 'move' | 'attackmove' | 'hold' | 'home' | 'attack';
      x: number;
      y: number;
      target: 'none' | 'soldier' | 'mob' | 'building';
      targetId: number;
    }
  | { kind: 'demolish'; playerId: number; buildingId: number }
  | { kind: 'road'; playerId: number; x: number; y: number };

export interface PopReason {
  label: string;
  value: number;
}
