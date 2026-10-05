import type { BuildingType, Food, PopReason, Ration, Resource, Soldier, TaxId, Terrain, Weapon } from './types';
import { FOODS, Terrain as T } from './types';

export const MAP_W = 180;
export const MAP_H = 120;
export const MIN_SPAWN_DISTANCE = 40;
export const TICKS_PER_SECOND = 20;
export const TICKS_PER_GAME_MINUTE = 60;
export const PERSON_SPEED = 0.12;
export const OX_SPEED = 0.08;
export const SOLDIER_SPEED = 0.2;
export const TAX_EVERY = 40;
export const CONSUME_EVERY = 50;
export const POP_EVERY = 4;
export const AI_EVERY = 40;
export const KEEP_UPGRADE_TICKS = 80;
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

export function costGold(cost: Partial<Record<Resource, number>> | undefined, mode: 'buy' | 'sell'): number {
  if (!cost) return 0;
  let gold = 0;
  for (const key of Object.keys(cost) as Resource[]) {
    gold += (cost[key] ?? 0) * PRICES[key][mode];
  }
  return gold;
}

export function popularityTarget(input: {
  ration: Ration;
  foodTypes: number;
  tax: TaxId;
  beer: boolean;
  hunger: boolean;
  chapel?: boolean;
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
  let chapel = 0;
  if (input.chapel) {
    chapel = CHAPEL_POP;
    reasons.push({ label: 'Часовня', value: chapel });
  }
  const raw = ration + variety + tax.pop + beer + hunger + chapel;
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
    horses: 0,
    weapons: 0,
    armor: 0,
    crossbows: 0,
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
  horses: 'Лошади',
  weapons: 'Оружие',
  armor: 'Доспехи',
  crossbows: 'Арбалеты',
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
  wheat: { buy: 5, sell: 1 },
  flour: { buy: 7, sell: 2 },
  hops: { buy: 5, sell: 1 },
  beer: { buy: 12, sell: 4 },
  horses: { buy: 18, sell: 6 },
  weapons: { buy: 22, sell: 8 },
  armor: { buy: 22, sell: 8 },
  crossbows: { buy: 32, sell: 10 },
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
  category: 'housing' | 'food' | 'industry' | 'military' | 'storage' | 'defence';
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
  /** Units a person picks up in one trip. Oxen use their own carry size. */
  carry: number;
}

function def(partial: Omit<BuildingDef, 'carry'> & { carry?: number }): BuildingDef {
  return { carry: 1, ...partial };
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
    hp: 360,
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
    desc: 'Дерево, камень, железо, смола и сырьё. Оружие, доспехи и лошадей держат в оружейной.',
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
    cycle: 18,
    output: 'wood',
    outputQty: 5,
    input: null,
    hauler: 'person',
    carry: 5,
  }),
  orchard: def({
    type: 'orchard',
    name: 'Яблоневый сад',
    desc: 'Дешёвые яблоки, но сад занимает много оазиса. Один работник кормит начальный посад.',
    w: 4,
    h: 3,
    cost: { wood: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 1,
    category: 'food',
    buildTicks: 120,
    hp: 90,
    terrain: [T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 24,
    output: 'apples',
    outputQty: 12,
    input: null,
    hauler: 'person',
    carry: 12,
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
    cycle: 24,
    output: 'cheese',
    outputQty: 22,
    input: null,
    hauler: 'person',
    carry: 22,
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
    cycle: 36,
    output: 'meat',
    outputQty: 4,
    input: null,
    hauler: 'person',
    carry: 4,
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
    cycle: 10,
    output: 'wheat',
    outputQty: 24,
    input: null,
    hauler: 'person',
    carry: 24,
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
    cycle: 8,
    output: 'flour',
    outputQty: 24,
    input: 'wheat',
    hauler: 'person',
    carry: 24,
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
    keepLevel: 3,
    category: 'food',
    buildTicks: 200,
    hp: 120,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 8,
    output: 'bread',
    outputQty: 24,
    input: 'flour',
    hauler: 'person',
    carry: 24,
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
    cycle: 20,
    output: 'hops',
    outputQty: 6,
    input: null,
    hauler: 'person',
    carry: 6,
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
    cycle: 16,
    output: 'beer',
    outputQty: 6,
    input: 'hops',
    hauler: 'person',
    carry: 6,
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
    keepLevel: 1,
    category: 'industry',
    buildTicks: 180,
    hp: 140,
    terrain: [T.Limestone],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 30,
    output: 'stone',
    outputQty: 6,
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
    keepLevel: 2,
    category: 'industry',
    buildTicks: 210,
    hp: 150,
    terrain: [T.Iron],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 36,
    output: 'iron',
    outputQty: 6,
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
    cycle: 40,
    output: 'pitch',
    outputQty: 2,
    input: null,
    hauler: 'person',
    carry: 2,
  }),
  stable: def({
    type: 'stable',
    name: 'Конюшня',
    desc: 'На траве или в оазисе. Работник скармливает яблоки или пшеницу и выводит лошадей.',
    w: 3,
    h: 2,
    cost: { wood: 10 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'industry',
    buildTicks: 180,
    hp: 120,
    terrain: [T.Land, T.Oasis],
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 36,
    output: 'horses',
    outputQty: 1,
    input: 'apples',
    hauler: 'person',
    carry: 1,
  }),
  smith: def({
    type: 'smith',
    name: 'Кузница',
    desc: 'Железо становится оружием и доспехами, а железо с деревом — арбалетом. Без оружейной повозка стоит во дворе.',
    w: 2,
    h: 2,
    cost: { wood: 8, stone: 6 },
    workers: 1,
    housing: 0,
    keepLevel: 2,
    category: 'industry',
    buildTicks: 180,
    hp: 140,
    terrain: null,
    nearTerrain: null,
    nearRadius: 0,
    nearHint: '',
    needsDeer: false,
    cycle: 24,
    output: 'weapons',
    outputQty: 1,
    input: 'iron',
    hauler: 'person',
    carry: 1,
  }),
  armoury: def({
    type: 'armoury',
    name: 'Оружейная',
    desc: 'Склад оружия, доспехов, арбалетов и лошадей. Здесь же укрепляют кольчугу против стрел.',
    w: 2,
    h: 2,
    cost: { wood: 6 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'storage',
    buildTicks: 120,
    hp: 130,
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
    desc: 'Ополченцы, копейщики, мечники, лучники и конница. Мечи, копья и тяжёлая конница берут оружие и доспехи из оружейной.',
    w: 3,
    h: 2,
    cost: { wood: 8 },
    workers: 0,
    housing: 0,
    keepLevel: 1,
    category: 'military',
    buildTicks: 140,
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
  palisade: def({
    type: 'palisade',
    name: 'Палисад',
    desc: 'Деревянная стена. Враги не проходят, свои — только через ворота.',
    w: 1,
    h: 1,
    cost: { wood: 2 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 40,
    hp: 90,
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
  wall: def({
    type: 'wall',
    name: 'Каменная стена',
    desc: 'Крепкий участок стены. Таран и катапульта бьют его сильнее солдат.',
    w: 1,
    h: 1,
    cost: { stone: 3 },
    workers: 0,
    housing: 0,
    keepLevel: 3,
    category: 'defence',
    buildTicks: 70,
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
  gate: def({
    type: 'gate',
    name: 'Ворота',
    desc: 'Свои люди и солдаты проходят. Чужие остаются снаружи.',
    w: 1,
    h: 1,
    cost: { wood: 8, stone: 6 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 90,
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
  stairs: def({
    type: 'stairs',
    name: 'Лестница',
    desc: 'Подъём на свою стену: лучники идут по участкам, связанным с лестницей.',
    w: 1,
    h: 1,
    cost: { wood: 4 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 50,
    hp: 70,
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
  woodtower: def({
    type: 'woodtower',
    name: 'Деревянная башня',
    desc: 'Лучники наверху бьют дальше и сами получают меньше урона.',
    w: 2,
    h: 2,
    cost: { wood: 14 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 140,
    hp: 150,
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
  stonetower: def({
    type: 'stonetower',
    name: 'Каменная башня',
    desc: 'Высокая башня для лучников. Рядом можно поставить котёл.',
    w: 2,
    h: 2,
    cost: { stone: 18, wood: 6 },
    workers: 0,
    housing: 0,
    keepLevel: 3,
    category: 'defence',
    buildTicks: 180,
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
  moat: def({
    type: 'moat',
    name: 'Ров',
    desc: 'Рабочие роют ров. Своих замедляет, чужих не пускает, пока его не засыплют.',
    w: 1,
    h: 1,
    cost: { wood: 1 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 80,
    hp: 50,
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
  pitchditch: def({
    type: 'pitchditch',
    name: 'Смоляная канава',
    desc: 'Канава со смолой. Лучник или жаровня поджигают её, и огонь жжёт тех, кто в ней.',
    w: 1,
    h: 1,
    cost: { pitch: 2 },
    workers: 0,
    housing: 0,
    keepLevel: 3,
    category: 'defence',
    buildTicks: 60,
    hp: 40,
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
  brazier: def({
    type: 'brazier',
    name: 'Жаровня',
    desc: 'Огонь у стены. Поджигает соседнюю смоляную канаву, когда рядом враг.',
    w: 1,
    h: 1,
    cost: { wood: 3, stone: 1 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 40,
    hp: 40,
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
  oil: def({
    type: 'oil',
    name: 'Котёл с маслом',
    desc: 'Ставится у башни. Инженер выливает смолу на тех, кто стоит внизу.',
    w: 1,
    h: 1,
    cost: { pitch: 2, stone: 6, iron: 2 },
    workers: 0,
    housing: 0,
    keepLevel: 4,
    category: 'defence',
    buildTicks: 100,
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
  guild: def({
    type: 'guild',
    name: 'Гильдия инженеров',
    desc: 'Здесь учат инженеров, лестничников, таран и катапульту. Осадную башню собирают в мастерской.',
    w: 3,
    h: 2,
    cost: { wood: 12, stone: 8 },
    workers: 0,
    housing: 0,
    keepLevel: 3,
    category: 'defence',
    buildTicks: 180,
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
  workshop: def({
    type: 'workshop',
    name: 'Инженерная мастерская',
    desc: 'Дерево и железо. Здесь учат инженеров и собирают лестницы и осадную башню. Инженер ставит лестницу, засыпает ров и ведёт башню к стене.',
    w: 3,
    h: 2,
    cost: { wood: 12, iron: 2 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'defence',
    buildTicks: 140,
    hp: 150,
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
  chapel: def({
    type: 'chapel',
    name: 'Часовня',
    desc: 'Учит лекаря. Он медленно лечит своих рядом и почти не лечит в бою. Часовня чуть поднимает настроение.',
    w: 2,
    h: 2,
    cost: { wood: 8, stone: 6 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'military',
    buildTicks: 120,
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
  merccamp: def({
    type: 'merccamp',
    name: 'Лагерь наёмников',
    desc: 'Наём за золото, без оружия и людей посада. Запас обновляется. Каждый наёмник берёт золото в минуту и уходит, если казна пуста.',
    w: 3,
    h: 2,
    cost: { wood: 10, stone: 4 },
    workers: 0,
    housing: 0,
    keepLevel: 2,
    category: 'military',
    buildTicks: 100,
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
};

export const BUILD_MENU: BuildingType[] = [
  'shack',
  'cabin',
  'house',
  'khrush',
  'highrise',
  'granary',
  'stockpile',
  'armoury',
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
  'stable',
  'smith',
  'market',
  'barracks',
  'palisade',
  'wall',
  'gate',
  'stairs',
  'woodtower',
  'stonetower',
  'moat',
  'pitchditch',
  'brazier',
  'oil',
  'guild',
  'workshop',
  'chapel',
  'merccamp',
];

export const CATEGORY_NAME = {
  housing: 'Жильё',
  food: 'Еда',
  industry: 'Добыча',
  military: 'Войско',
  storage: 'Запасы',
  defence: 'Оборона',
} as const;

export const KEEP_HOUSING = [0, 5, 8, 12, 18, 28];

export const KEEP_UPGRADE_COST: Record<number, Partial<Record<Resource, number>>> = {
  1: { wood: 25, stone: 15 },
  2: { wood: 8, stone: 6, iron: 1 },
  3: { wood: 12, stone: 8, iron: 2 },
  4: { wood: 14, stone: 10, iron: 2 },
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
  // A basket already in the stores: five people finish the granary and the first orchard before this runs out.
  apples: 80,
};

export const START_GOLD = 100;
export const START_PEOPLE = 5;

export const BUFFER_CAP = 6;
export const OX_BUFFER_CAP = 12;
export const OX_CARRY = 6;
export const PLAGUE_CHANCE = 0.05;
export const PLAGUE_TICKS = 160;

export const CLUB_COST: Partial<Record<Resource, number>> = { wood: 2 };
export const SWORD_COST: Partial<Record<Resource, number>> = { weapons: 1, armor: 1 };

export const TRAIN_COST: Record<Weapon, Partial<Record<Resource, number>>> = {
  club: CLUB_COST,
  sword: SWORD_COST,
  bow: { wood: 4 },
  spear: { wood: 8, weapons: 1 },
  light: { horses: 1, wood: 4 },
  heavy: { horses: 1, weapons: 1, armor: 1 },
  crossbow: { crossbows: 1 },
  shield: { wood: 6, armor: 1 },
  horsebow: { horses: 1, wood: 4 },
  engineer: { wood: 3, iron: 1 },
  ladder: { wood: 8 },
  siegetower: { wood: 12, stone: 6 },
  healer: { wood: 4 },
  raider: {},
  axe: {},
  ram: { wood: 16, stone: 4 },
  catapult: { wood: 18, stone: 10, iron: 4 },
};

/** Gold on top of the stock cost. Spearmen stay cheap; heavy cavalry does not. */
export const TRAIN_GOLD: Record<Weapon, number> = {
  club: 0,
  sword: 0,
  bow: 0,
  spear: 6,
  light: 10,
  heavy: 24,
  crossbow: 12,
  shield: 8,
  horsebow: 14,
  engineer: 10,
  ladder: 0,
  siegetower: 8,
  healer: 8,
  raider: 0,
  axe: 0,
  ram: 0,
  catapult: 0,
};

export const MAIL_COST = 4;
export const CHARGE_BONUS = 1.8;
export const ARMOR_ARROW = 0.75;
/** Shield bearers soak arrows. Crossbows ignore armour and mail, and only partly this. */
export const SHIELD_ARROW = 0.32;
export const SHIELD_PIERCE = 0.7;
/** One nearby shield bearer softens arrows for friends. It does not stack. */
export const SHIELD_AURA = 0.72;
export const SHIELD_AURA_RANGE = 1.7;
/** Crossbows are clumsy once infantry is on top of them. */
export const CROSSBOW_MELEE = 0.4;
export const CROSSBOW_RELOAD = 28;
export const CROSSBOW_RANGE = 5.8;
export const HORSEBOW_RANGE = 4.8;
/** A finished chapel lifts mood by this much. */
export const CHAPEL_POP = 4;
export const HEAL_RANGE = 2.2;
export const HEAL_PULSE = 12;
export const HEAL_COMBAT_PULSE = 24;
/** Hit points one side can restore on a single pulse, however many healers stand together. */
export const HEAL_CAP = 2;
/** Wood an engineer spends to set one ladder against a wall. */
export const LADDER_WOOD = 4;
export const MERC_REFRESH = 180;
export const RAIDER_GOLD = 40;
export const AXE_GOLD = 56;
export const RAIDER_UPKEEP = 2;
export const AXE_UPKEEP = 3;

export function isArrow(weapon: Weapon): boolean {
  return weapon === 'bow' || weapon === 'crossbow' || weapon === 'horsebow';
}

export function soldierPace(weapon: Weapon): number {
  if (weapon === 'light') return 0.34;
  if (weapon === 'horsebow') return 0.33;
  if (weapon === 'heavy') return 0.26;
  if (weapon === 'spear') return 0.18;
  if (weapon === 'crossbow') return 0.15;
  if (weapon === 'shield') return 0.13;
  if (weapon === 'raider') return 0.36;
  if (weapon === 'siegetower') return 0.07;
  if (weapon === 'axe') return 0.14;
  if (weapon === 'healer') return 0.16;
  if (weapon === 'engineer') return 0.16;
  return SOLDIER_SPEED;
}

const COUNTER: Partial<Record<Weapon, Partial<Record<Weapon, number>>>> = {
  spear: { light: 2.2, heavy: 2.1, bow: 0.55, sword: 0.6, ram: 0.7, catapult: 0.65, horsebow: 1.85, crossbow: 1.15, shield: 0.9 },
  light: { spear: 0.4, heavy: 0.7, sword: 0.75, bow: 0.9, club: 1.2, ram: 1.85, catapult: 1.85, engineer: 1.7, ladder: 1.7, horsebow: 0.85, crossbow: 1.1, shield: 0.8 },
  heavy: { spear: 0.42, sword: 0.85, bow: 1.05, club: 1.25, light: 1.2, ram: 1.15, catapult: 1.1, horsebow: 0.9, crossbow: 1.05, shield: 0.75 },
  sword: { spear: 1.5, bow: 1.15, light: 1.05, heavy: 0.8, shield: 1.65, crossbow: 1.45, horsebow: 1.2, healer: 1.7, engineer: 1.6, ladder: 1.55, raider: 1.15, axe: 0.85 },
  bow: { spear: 1.6, light: 1.15, heavy: 0.85, club: 1.15, catapult: 1.3, shield: 1, horsebow: 1.25, crossbow: 0.9, siegetower: 0, healer: 1.6, engineer: 1.4, ladder: 1.3 },
  club: { spear: 0.85, light: 0.7, heavy: 0.55, shield: 0.8, horsebow: 0.75 },
  crossbow: { sword: 1.65, heavy: 1.7, light: 1.15, spear: 1.2, shield: 1.15, horsebow: 1.6, bow: 1.1, club: 1.15, ram: 0.7, catapult: 0.6, siegetower: 0 },
  shield: { sword: 0.45, catapult: 0.4, bow: 0.55, crossbow: 0.5, spear: 0.85, club: 0.8, light: 0.7, heavy: 0.65, horsebow: 0.7 },
  horsebow: { spear: 0.4, crossbow: 0.45, sword: 0.85, shield: 0.7, bow: 0.8, club: 1.15, ram: 1.4, heavy: 0.75, light: 0.9, catapult: 1.2, siegetower: 0 },
  catapult: { shield: 1.8, siegetower: 1.4 },
  engineer: { sword: 0.35, spear: 0.45, bow: 0.5, club: 0.6 },
  ladder: { sword: 0.4, bow: 0.55, spear: 0.5 },
  siegetower: { sword: 0.3, bow: 0.2, crossbow: 0.2 },
  healer: { club: 0, spear: 0, sword: 0, bow: 0, crossbow: 0, shield: 0, light: 0, heavy: 0, horsebow: 0, engineer: 0, ladder: 0, siegetower: 0, raider: 0, axe: 0, ram: 0, catapult: 0 },
  raider: { spear: 0.4, sword: 0.7, club: 1.35, engineer: 1.6, ladder: 1.5, ram: 1.7, catapult: 1.6 },
  axe: { shield: 1.55, spear: 0.5, crossbow: 0.55, bow: 0.7, sword: 0.9, club: 1.25 },
};

/** Damage multiplier from the attacker onto this defender. 1 is an even trade before hit points. */
export function counterFactor(attacker: Weapon, defender: Weapon): number {
  return COUNTER[attacker]?.[defender] ?? 1;
}

export function dealtToSoldier(attacker: Soldier, defender: Soldier, mail: boolean, aura = 1): number {
  if (attacker.weapon === 'healer' || attacker.dmg <= 0) return 0;
  if (defender.weapon === 'siegetower' && isArrow(attacker.weapon)) return 0;
  let dmg = attacker.dmg * counterFactor(attacker.weapon, defender.weapon);
  if (attacker.weapon === 'heavy' && attacker.charge > 0) dmg *= CHARGE_BONUS;
  if (isArrow(attacker.weapon)) {
    const piercing = attacker.weapon === 'crossbow';
    if (!piercing) {
      if (defender.armor) dmg *= ARMOR_ARROW;
      if (mail) dmg *= ARMOR_ARROW;
    }
    if (defender.weapon === 'shield') dmg *= piercing ? SHIELD_PIERCE : SHIELD_ARROW;
    dmg *= aura;
  }
  return Math.max(1, Math.round(dmg));
}

export const BOW_RANGE = 5.4;
/** Attacking archers back away from infantry while they are farther than this. Closer than this, infantry catches them. */
export const BOW_SKIRMISH = 3.4;
export const TOWER_RANGE = 7.4;
export const PITCH_BURN = 120;
export const CLOUD_TICKS = 160;
export const CLOUD_RADIUS = 3.2;
