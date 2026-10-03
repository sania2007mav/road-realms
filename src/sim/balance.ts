import type { BuildingType, Food, PopReason, Ration, Resource, TaxId, Terrain } from './types';
import { FOODS, Terrain as T } from './types';

export const MAP_W = 180;
export const MAP_H = 120;
export const MIN_SPAWN_DISTANCE = 40;
export const TICKS_PER_SECOND = 20;
export const TICKS_PER_GAME_MINUTE = 60;
export const PERSON_SPEED = 0.12;
export const OX_SPEED = 0.05;
export const SOLDIER_SPEED = 0.11;
export const TAX_EVERY = 40;
export const CONSUME_EVERY = 50;
export const POP_EVERY = 4;
export const AI_EVERY = 40;
export const KEEP_UPGRADE_TICKS = 220;
export const BUILD_RADIUS = 18;
export const ENEMY_KEEP_GAP = 12;

export const RATION_POP: Record<Ration, number> = {
  none: -12,
  half: -4,
  normal: 3,
  double: 7,
  feast: 12,
};

export const RATION_LABEL: Record<Ration, string> = {
  none: 'Паёк: нет',
  half: 'Паёк: скромный',
  normal: 'Паёк: обычный',
  double: 'Паёк: двойной',
  feast: 'Паёк: пир',
};

/** Food units per person each meal. Half is rounded up across the settlement. */
export const RATION_PER_PERSON: Record<Ration, number> = {
  none: 0,
  half: 0.5,
  normal: 1,
  double: 2,
  feast: 3,
};

export const VARIETY_BONUS = [0, 0, 8, 14, 22] as const;

export function varietyBonus(types: number): number {
  const i = Math.max(0, Math.min(4, Math.floor(types)));
  return VARIETY_BONUS[i];
}

export const VARIETY_LABEL = [
  'В амбаре нет еды',
  'Разнообразие: один вид',
  'Разнообразие: два вида',
  'Разнообразие: три вида',
  'Разнообразие: все четыре вида',
];

export interface TaxDef {
  id: TaxId;
  label: string;
  pop: number;
  gold: number;
}

export const TAXES: TaxDef[] = [
  { id: 'none', label: 'Налог: нет', pop: 8, gold: 0 },
  { id: 'low', label: 'Налог: низкий', pop: 4, gold: 1 },
  { id: 'normal', label: 'Налог: обычный', pop: 0, gold: 2 },
  { id: 'high', label: 'Налог: высокий', pop: -6, gold: 3 },
  { id: 'harsh', label: 'Налог: жёсткий', pop: -12, gold: 4 },
  { id: 'cruel', label: 'Налог: грабёж', pop: -20, gold: 6 },
];

export const BEER_POP = 12;
export const HUNGER_POP = -10;
export const POP_MIN = -50;
export const POP_MAX = 50;

export function taxDef(id: TaxId): TaxDef {
  return TAXES.find((t) => t.id === id) ?? TAXES[1];
}

export function taxGold(people: number, tax: TaxId): number {
  return Math.max(0, people) * taxDef(tax).gold;
}

export function popularityTarget(input: {
  ration: Ration;
  foodTypes: number;
  tax: TaxId;
  beer: boolean;
  hunger: boolean;
}): { value: number; reasons: PopReason[] } {
  const reasons: PopReason[] = [];
  const ration = RATION_POP[input.ration];
  reasons.push({ label: RATION_LABEL[input.ration], value: ration });
  const types = Math.max(0, Math.min(4, Math.floor(input.foodTypes)));
  const variety = varietyBonus(types);
  reasons.push({ label: VARIETY_LABEL[types], value: variety });
  const tax = taxDef(input.tax);
  reasons.push({ label: tax.label, value: tax.pop });
  let beer = 0;
  if (input.beer) {
    beer = BEER_POP;
    reasons.push({ label: 'Пиво в таверне', value: beer });
  }
  let hunger = 0;
  if (input.hunger) {
    hunger = HUNGER_POP;
    reasons.push({ label: 'Голод', value: hunger });
  }
  const raw = ration + variety + tax.pop + beer + hunger;
  const value = Math.max(POP_MIN, Math.min(POP_MAX, raw));
  return { value, reasons };
}

export function emptyStocks(): Record<Resource, number> {
  return {
    wood: 0,
    stone: 0,
    iron: 0,
    pitch: 0,
    apples: 0,
    cheese: 0,
    meat: 0,
    bread: 0,
    wheat: 0,
    flour: 0,
    hops: 0,
    beer: 0,
  };
}

export function foodTypesIn(stocks: Record<Resource, number>): number {
  return FOODS.filter((f) => stocks[f] > 0).length;
}

export function isFood(res: Resource): res is Food {
  return (FOODS as readonly string[]).includes(res);
}

export const RESOURCE_NAME: Record<Resource, string> = {
  wood: 'Дерево',
  stone: 'Камень',
  iron: 'Железо',
  pitch: 'Смола',
  apples: 'Яблоки',
  cheese: 'Сыр',
  meat: 'Мясо',
  bread: 'Хлеб',
  wheat: 'Пшеница',
  flour: 'Мука',
  hops: 'Хмель',
  beer: 'Пиво',
};

export const PRICES: Record<Resource, { buy: number; sell: number }> = {
  wood: { buy: 6, sell: 2 },
  stone: { buy: 12, sell: 4 },
  iron: { buy: 28, sell: 10 },
  pitch: { buy: 16, sell: 6 },
  apples: { buy: 5, sell: 1 },
  cheese: { buy: 8, sell: 3 },
  meat: { buy: 10, sell: 4 },
  bread: { buy: 10, sell: 4 },
  wheat: { buy: 4, sell: 1 },
  flour: { buy: 7, sell: 2 },
  hops: { buy: 5, sell: 1 },
  beer: { buy: 12, sell: 4 },
};

export interface BuildingDef {
  type: BuildingType;
  name: string;
  desc: string;
  w: number;
  h: number;
  cost: Partial<Record<Resource, number>>;
  workers: number;
  housing: number;
  keepLevel: number;
  category: 'housing' | 'food' | 'industry' | 'military' | 'storage';
  buildTicks: number;
  hp: number;
  /** Every footprint tile must be one of these. Empty means ordinary ground. */
  terrain: Terrain[] | null;
  nearTerrain: Terrain | null;
  nearRadius: number;
  nearHint: string;
  needsDeer: boolean;
  cycle: number;
  output: Resource | null;
  outputQty: number;
  input: Resource | null;
  hauler: 'person' | 'ox' | 'none';
}

function def(partial: BuildingDef): BuildingDef {
  return partial;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  keep: def({
    type: 'keep',
    name: 'Главное здание',
    desc: 'Сердце поселения. Уровень открывает новые постройки и даёт жильё.',
    w: 3,
    h: 3,
    cost: {},
    workers: 0,
    housing: 5,
    keepLevel: 1,
    category: 'housing',
    buildTicks: 0,
    hp: 520,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  shack: def({
    type: 'shack',
    name: 'Шалаш',
    desc: 'Первое жильё. Двое новых людей.',
    w: 2,
    h: 2,
    cost: { wood: 4 },
    workers: 0,
    housing: 2,
    keepLevel: 1,
    category: 'housing',
    buildTicks: 140,
    hp: 80,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  cabin: def({
    type: 'cabin',
    name: 'Бытовка',
    desc: 'Тесный барак на четверых.',
    w: 2,
    h: 2,
    cost: { wood: 8, stone: 4 },
    workers: 0,
    housing: 4,
    keepLevel: 2,
    category: 'housing',
    buildTicks: 180,
    hp: 120,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  house: def({
    type: 'house',
    name: 'Дом',
    desc: 'Крепкий дом на восьмерых.',
    w: 2,
    h: 2,
    cost: { wood: 12, stone: 10 },
    workers: 0,
    housing: 8,
    keepLevel: 3,
    category: 'housing',
    buildTicks: 220,
    hp: 160,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  khrush: def({
    type: 'khrush',
    name: 'Хрущёвка',
    desc: 'Панельный дом. Шестнадцать жильцов.',
    w: 3,
    h: 2,
    cost: { wood: 16, stone: 20, iron: 4 },
    workers: 0,
    housing: 16,
    keepLevel: 4,
    category: 'housing',
    buildTicks: 280,
    hp: 220,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  highrise: def({
    type: 'highrise',
    name: 'Многоэтажка',
    desc: 'Башня на тридцать два человека.',
    w: 3,
    h: 3,
    cost: { wood: 20, stone: 30, iron: 8 },
    workers: 0,
    housing: 32,
    keepLevel: 5,
    category: 'housing',
    buildTicks: 340,
    hp: 280,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  granary: def({
    type: 'granary',
    name: 'Амбар',
    desc: 'Сюда носят еду. Без амбара урожай не попадает в запас.',
    w: 3,
    h: 2,
    cost: { wood: 6 },
    workers: 0,
    housing: 0,
    keepLevel: 1,
    category: 'storage',
    buildTicks: 150,
    hp: 140,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  stockpile: def({
    type: 'stockpile',
    name: 'Склад',
    desc: 'Дерево, камень, железо, смола и сырьё. Дальше тащить — дольше ждать.',
    w: 3,
    h: 3,
    cost: { wood: 4 },
    workers: 0,
    housing: 0,
    keepLevel: 1,
    category: 'storage',
    buildTicks: 110,
    hp: 100,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  woodcutter: def({
    type: 'woodcutter',
    name: 'Хижина лесоруба',
    desc: 'Рубит соседний лес. Работник сам относит брёвна на склад.',
    w: 2,
    h: 2,
    cost: { wood: 3 },
    workers: 1,
    housing: 0,
    keepLevel: 1,
    category: 'industry',
    buildTicks: 120,
    hp: 90,
    terrain: null,
    nearTerrain: T.Forest,
    nearRadius: 2,
    nearHint: 'Нужен лес рядом',
    needsDeer: false,
    cycle: 45,
    output: 'wood',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  orchard: def({
    type: 'orchard',
    name: 'Яблоневый сад',
    desc: 'Дешёвые яблоки, но сад занимает много оазиса.',
    w: 4,
    h: 3,
    cost: { wood: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 1,
    category: 'food',
    buildTicks: 170,
    hp: 90,
    terrain: [T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 70,
    output: 'apples',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  dairy: def({
    type: 'dairy',
    name: 'Молочная ферма',
    desc: 'Коровы дают сыр. Иногда на ферму приходит чума.',
    w: 3,
    h: 3,
    cost: { wood: 8 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'food',
    buildTicks: 180,
    hp: 110,
    terrain: [T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 80,
    output: 'cheese',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  hunter: def({
    type: 'hunter',
    name: 'Охотничья хижина',
    desc: 'Мясо, если рядом бродит стадо оленей.',
    w: 2,
    h: 2,
    cost: { wood: 5 },
    workers: 1,
    housing: 0,
    keepLevel: 1,
    category: 'food',
    buildTicks: 130,
    hp: 90,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: true,
    cycle: 100,
    output: 'meat',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  wheat: def({
    type: 'wheat',
    name: 'Пшеничная ферма',
    desc: 'Первое звено хлеба. Пшеницу несут на мельницу.',
    w: 3,
    h: 3,
    cost: { wood: 8 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'food',
    buildTicks: 180,
    hp: 100,
    terrain: [T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 55,
    output: 'wheat',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  mill: def({
    type: 'mill',
    name: 'Мельница',
    desc: 'Мелет пшеницу в муку.',
    w: 2,
    h: 2,
    cost: { wood: 10, stone: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 3,
    category: 'food',
    buildTicks: 200,
    hp: 130,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 50,
    output: 'flour',
    outputQty: 1,
    input: 'wheat',
    hauler: 'person',
  }),
  bakery: def({
    type: 'bakery',
    name: 'Пекарня',
    desc: 'Печёт хлеб из муки и относит его в амбар.',
    w: 2,
    h: 2,
    cost: { wood: 10, stone: 8 },
    workers: 1,
    housing: 0,
    keepLevel: 4,
    category: 'food',
    buildTicks: 200,
    hp: 120,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 50,
    output: 'bread',
    outputQty: 1,
    input: 'flour',
    hauler: 'person',
  }),
  hop: def({
    type: 'hop',
    name: 'Хмелевая ферма',
    desc: 'Хмель для пивоварни. Только на оазисе.',
    w: 3,
    h: 3,
    cost: { wood: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'food',
    buildTicks: 160,
    hp: 90,
    terrain: [T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 60,
    output: 'hops',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  brewery: def({
    type: 'brewery',
    name: 'Пивоварня',
    desc: 'Варит пиво из хмеля.',
    w: 2,
    h: 2,
    cost: { wood: 8, stone: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 3,
    category: 'food',
    buildTicks: 190,
    hp: 120,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 70,
    output: 'beer',
    outputQty: 1,
    input: 'hops',
    hauler: 'person',
  }),
  tavern: def({
    type: 'tavern',
    name: 'Таверна',
    desc: 'Поит людей пивом. Сильный плюс к настроению.',
    w: 3,
    h: 2,
    cost: { wood: 12, stone: 10 },
    workers: 1,
    housing: 0,
    keepLevel: 4,
    category: 'food',
    buildTicks: 210,
    hp: 140,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 80,
    output: null,
    outputQty: 0,
    input: 'beer',
    hauler: 'none',
  }),
  quarry: def({
    type: 'quarry',
    name: 'Каменоломня',
    desc: 'Только на известняке. Камень везут волы.',
    w: 3,
    h: 2,
    cost: { wood: 8 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'industry',
    buildTicks: 180,
    hp: 140,
    terrain: [T.Limestone],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 70,
    output: 'stone',
    outputQty: 1,
    input: null,
    hauler: 'ox',
  }),
  mine: def({
    type: 'mine',
    name: 'Железный рудник',
    desc: 'Только на железной породе. Волы везут руду на склад.',
    w: 2,
    h: 2,
    cost: { wood: 8, stone: 8 },
    workers: 1,
    housing: 0,
    keepLevel: 3,
    category: 'industry',
    buildTicks: 210,
    hp: 150,
    terrain: [T.Iron],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 100,
    output: 'iron',
    outputQty: 1,
    input: null,
    hauler: 'ox',
  }),
  pitch: def({
    type: 'pitch',
    name: 'Смолокурня',
    desc: 'Черпает смолу на чёрном болоте.',
    w: 2,
    h: 2,
    cost: { wood: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'industry',
    buildTicks: 150,
    hp: 90,
    terrain: [T.Swamp],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 80,
    output: 'pitch',
    outputQty: 1,
    input: null,
    hauler: 'person',
  }),
  market: def({
    type: 'market',
    name: 'Рынок',
    desc: 'Мгновенно покупает и продаёт запасы за золото. Нужен торговец.',
    w: 3,
    h: 2,
    cost: { wood: 10 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'industry',
    buildTicks: 160,
    hp: 110,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
  barracks: def({
    type: 'barracks',
    name: 'Казарма',
    desc: 'Один человек и оружие становятся солдатом.',
    w: 3,
    h: 2,
    cost: { wood: 14, stone: 10 },
    workers: 0,
    housing: 0,
    keepLevel: 3,
    category: 'military',
    buildTicks: 200,
    hp: 180,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 0,
    output: null,
    outputQty: 0,
    input: null,
    hauler: 'none',
  }),
};

export const BUILD_MENU: BuildingType[] = [
  'shack',
  'cabin',
  'house',
  'khrush',
  'highrise',
  'granary',
  'stockpile',
  'woodcutter',
  'orchard',
  'dairy',
  'hunter',
  'wheat',
  'mill',
  'bakery',
  'hop',
  'brewery',
  'tavern',
  'quarry',
  'mine',
  'pitch',
  'market',
  'barracks',
];

export const CATEGORY_NAME = {
  housing: 'Жильё',
  food: 'Еда',
  industry: 'Добыча',
  military: 'Войско',
  storage: 'Запасы',
} as const;

export const KEEP_HOUSING = [0, 5, 8, 12, 18, 28];

export const KEEP_UPGRADE_COST: Record<number, Partial<Record<Resource, number>>> = {
  1: { wood: 25, stone: 15 },
  2: { wood: 35, stone: 30, iron: 4 },
  3: { wood: 45, stone: 45, iron: 10 },
  4: { wood: 60, stone: 70, iron: 18 },
};

export function housingOf(type: BuildingType, level: number): number {
  if (type === 'keep') return KEEP_HOUSING[level] ?? 5;
  return BUILDINGS[type].housing;
}

export function keepLevelName(level: number): string {
  return `Уровень ${level}`;
}

export const PLAYER_COLORS = ['#2f6fed', '#d6453d', '#e0a11b', '#7a4db0'];
export const PLAYER_NAMES = ['Ваш посад', 'Посад «Ольха»', 'Посад «Ковыль»', 'Посад «Суходол»'];

export const START_STOCKS: Partial<Record<Resource, number>> = {
  wood: 36,
  stone: 10,
  apples: 40,
};

export const START_GOLD = 100;
export const START_PEOPLE = 5;

export const BUFFER_CAP = 6;
export const OX_BUFFER_CAP = 12;
export const OX_CARRY = 4;
export const PLAGUE_CHANCE = 0.05;
export const PLAGUE_TICKS = 420;

export const CLUB_COST: Partial<Record<Resource, number>> = { wood: 2 };
export const SWORD_COST: Partial<Record<Resource, number>> = { iron: 2 };
