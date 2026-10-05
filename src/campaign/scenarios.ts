import { createGame } from '../sim/world';
import { Terrain, type GameState, type MatchSetup } from '../sim/types';
import type { Scenario } from './types';
import { addWolves, clearHostiles, fortify, grant, paintDisc, setKeepLevel, thinKeep } from './prepare';
import { playerKeep } from '../sim/update';

function match(partial: Partial<MatchSetup> & Pick<MatchSetup, 'ai' | 'victory'>): MatchSetup {
  return {
    victory: partial.victory,
    timeLimit: 0,
    map: partial.map ?? 'small',
    start: partial.start ?? 'normal',
    ai: partial.ai,
    goldTarget: partial.goldTarget ?? 999999,
    popTarget: partial.popTarget ?? 20,
    surviveMinutes: partial.surviveMinutes ?? 15,
    profiles: partial.profiles,
  };
}

function calm(state: GameState) {
  clearHostiles(state);
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'korm',
    title: 'Корм для тракта',
    intro:
      'Караван ушёл на север и оставил вас у пустой обочины. В корзине ещё есть яблоки, но десять ртов сами себя не прокормят. Поставьте амбар и сад, пока тракт молчит: первые две минуты еда не тратится.',
    objective: 'Прокормите 10 человек',
    bonus: 'Два яблоневых сада',
    goal: { kind: 'population', count: 10 },
    bonusKind: 'orchards',
    seed: 4101,
    setup: match({ ai: 0, victory: 'conquest' }),
    parMinutes: 15,
    proofMinutes: 22,
    failMinutes: 28,
    shelterMinutes: 2,
    events: [{ minute: 1, kind: 'log', text: 'Тракт спокоен. Пока еда не тратится.' }],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'stockpile', max: 1 },
        { type: 'shack', max: 3 },
        { type: 'orchard', max: 2 },
      ],
    },
  },
  {
    id: 'kamen',
    title: 'Известняк',
    intro:
      'Под песком у посада лежит известняк. Без камня главное здание не поднять, а без склада волам некуда везти породу. В кузнице остался один слиток железа — его хватит на второй уровень.',
    objective: 'Главное здание 2 уровня и 50 камня',
    bonus: 'Каменоломня работает, склад стоит',
    goal: { kind: 'keep-stone', level: 2, stone: 50 },
    bonusKind: 'quarry',
    seed: 4102,
    setup: match({ ai: 0, victory: 'conquest' }),
    parMinutes: 34,
    proofMinutes: 45,
    failMinutes: 50,
    shelterMinutes: 0,
    events: [{ minute: 5, kind: 'caravan', gold: 25, text: 'Караван оставил 25 золота за ночлег.' }],
    bot: {
      tax: 'none',
      upgradeTo: 2,
      buildings: [
        { type: 'granary', max: 1, beforeUpgrade: true },
        { type: 'woodcutter', max: 1, beforeUpgrade: true },
        { type: 'orchard', max: 1, beforeUpgrade: true },
        { type: 'stockpile', max: 1, beforeUpgrade: true },
        { type: 'quarry', max: 1, beforeUpgrade: true },
      ],
    },
  },
  {
    id: 'nalet',
    title: 'Пыль на дороге',
    intro:
      'С барханов спускаются волки, а по тракту уже ходят слухи о бандах. Десять минут держите посад: налёты придут, когда успеете поднять казарму. Несколько дубин стоят дешевле, чем новый дом после пожара.',
    objective: 'Продержитесь 10 минут',
    bonus: 'Обучить хотя бы двух ополченцев',
    goal: { kind: 'hold', minutes: 10 },
    bonusKind: 'soldiers',
    seed: 4103,
    setup: match({ ai: 0, victory: 'conquest' }),
    parMinutes: 10,
    proofMinutes: 12,
    failMinutes: 0,
    shelterMinutes: 0,
    events: [
      { minute: 4, kind: 'wave', count: 2, text: 'Волна: с тракта идут двое бандитов' },
      { minute: 7, kind: 'wave', count: 3, text: 'Волна: бандиты подступают' },
      { minute: 9, kind: 'wave', count: 4, text: 'Волна: большая стая бандитов' },
    ],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'barracks', max: 1 },
        { type: 'woodcutter', max: 1 },
      ],
      train: [{ weapon: 'club', count: 4, keepPeople: 2 }],
    },
  },
  {
    id: 'torg',
    title: 'Монеты каравана',
    intro:
      'С востока идёт караван и платит за еду. Рынок на втором уровне превращает запас в монеты, а налог капает сам. Наберите 300 золота и не дайте настроению упасть ниже нуля.',
    objective: '300 золота при настроении не ниже нуля',
    bonus: 'На рынке работает торговец',
    goal: { kind: 'gold-mood', gold: 300, mood: 0 },
    bonusKind: 'market',
    seed: 4104,
    setup: match({ ai: 0, victory: 'conquest' }),
    parMinutes: 24,
    proofMinutes: 36,
    failMinutes: 40,
    shelterMinutes: 0,
    events: [{ minute: 6, kind: 'caravan', gold: 40, text: 'Караван заплатил 40 золота за воду и ночлег.' }],
    bot: {
      tax: 'normal',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'market', max: 1 },
        { type: 'dairy', max: 1 },
      ],
      sell: { resource: 'cheese', above: 12 },
    },
  },
  {
    id: 'hleb',
    title: 'Печь у обочины',
    intro:
      'Путники просят хлеб, а не яблоки. Пшеница, мельница и пекарня уже открыты: главное здание третьего уровня. Напеките хлеб и отвезите его в амбар — нужно сорок хлебов.',
    objective: 'Сдайте в амбар 40 хлеба',
    bonus: 'Мельница и пекарня работают',
    goal: { kind: 'bread', count: 40 },
    bonusKind: 'chain',
    seed: 4105,
    setup: match({ ai: 0, victory: 'conquest' }),
    parMinutes: 16,
    proofMinutes: 24,
    failMinutes: 30,
    shelterMinutes: 0,
    events: [{ minute: 2, kind: 'log', text: 'Путники ждут хлеб у обочины.' }],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'stockpile', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'wheat', max: 1 },
        { type: 'mill', max: 1 },
        { type: 'bakery', max: 1 },
        { type: 'orchard', max: 1 },
      ],
    },
  },
  {
    id: 'stena',
    title: 'Частокол',
    intro:
      'Сосед с юга собирает дубины и пришлёт людей раньше, чем сам выйдет в поле. Двенадцать минут главное здание должно устоять. Палисад и башня встречают налёт деревом, а не дверью дома.',
    objective: 'Удержите главное здание 12 минут',
    bonus: 'Четыре участка палисада и башня',
    goal: { kind: 'hold', minutes: 12 },
    bonusKind: 'walls',
    seed: 4106,
    setup: match({
      ai: 1,
      victory: 'wealth',
      profiles: [{ difficulty: 'easy', personality: 'warlord' }],
    }),
    parMinutes: 12,
    proofMinutes: 14,
    failMinutes: 0,
    shelterMinutes: 0,
    events: [
      { minute: 6, kind: 'wave', count: 3, text: 'На нас напали: бандиты с тракта' },
      { minute: 9, kind: 'raiders', count: 3, text: 'На нас напали: сосед прислал отряд' },
    ],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'orchard', max: 1 },
      ],
      ring: 5,
      gate: true,
      tower: true,
      later: [
        { type: 'barracks', max: 1 },
        { type: 'woodcutter', max: 1 },
      ],
      train: [{ weapon: 'club', count: 4, keepPeople: 2 }],
    },
  },
  {
    id: 'osada',
    title: 'Чужой посад',
    intro:
      'За частоколом сидит чужой посад. Ворота закрыты, на башне лучник. Таран бьёт в створки, лестницы и осадная башня переводят людей через частокол. Снесите их главное здание.',
    objective: 'Разрушьте главное здание соседа',
    bonus: 'Своё главное здание сохранило хотя бы половину прочности',
    goal: { kind: 'conquest' },
    bonusKind: 'keep-hp',
    seed: 4107,
    setup: match({
      ai: 1,
      victory: 'conquest',
      profiles: [{ difficulty: 'easy', personality: 'builder' }],
    }),
    parMinutes: 32,
    proofMinutes: 45,
    failMinutes: 50,
    shelterMinutes: 0,
    events: [{ minute: 3, kind: 'log', text: 'За частоколом молчат. Ворота закрыты.' }],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'stockpile', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'guild', max: 1 },
        { type: 'workshop', max: 1 },
        { type: 'barracks', max: 1 },
      ],
      train: [
        { weapon: 'ram', count: 1, keepPeople: 1 },
        { weapon: 'club', count: 4, keepPeople: 2 },
        { weapon: 'ladder', count: 2, keepPeople: 1 },
        { weapon: 'siegetower', count: 1, keepPeople: 1 },
      ],
      attack: 'raid',
      attackSoldiers: 2,
      attackMinute: 0,
      attackWeapon: 'ram',
    },
  },
  {
    id: 'rascvet',
    title: 'Раньше соседа',
    intro:
      'Два посада растут вдоль одного тракта, и край признает только тот, что расцветёт первым. Нужны четвёртый уровень и двенадцать человек. Сосед тоже строит — не отдавайте ему эту весну.',
    objective: 'Расцвет: уровень 4 и 12 человек раньше соседа',
    bonus: 'Настроение не ниже нуля',
    goal: { kind: 'bloom' },
    bonusKind: 'mood',
    seed: 4108,
    setup: match({
      ai: 1,
      victory: 'bloom',
      popTarget: 12,
      map: 'small',
      profiles: [{ difficulty: 'easy', personality: 'builder' }],
    }),
    parMinutes: 42,
    proofMinutes: 60,
    failMinutes: 0,
    shelterMinutes: 0,
    events: [{ minute: 2, kind: 'log', text: 'Сосед уже метит участки под жильё.' }],
    bot: { tax: 'none', buildings: [], bloom: true },
  },
  {
    id: 'suhoy',
    title: 'Сухой год',
    intro:
      'Небо закрылось, колодцы сели, и с тракта тянет сладковатый дым. Запасы малы, а засуха несколько минут забирает урожай прямо из амбара. Продержитесь двенадцать минут и не останьтесь без людей.',
    objective: 'Продержитесь 12 минут',
    bonus: 'В конце не меньше 4 человек и 8 яблок',
    goal: { kind: 'hold', minutes: 12 },
    bonusKind: 'stores',
    seed: 4109,
    setup: match({ ai: 0, victory: 'conquest', start: 'low' }),
    parMinutes: 12,
    proofMinutes: 14,
    failMinutes: 0,
    shelterMinutes: 0,
    events: [
      { minute: 3, kind: 'drought', on: true, text: 'Засуха: фермы отдают меньше, амбар сохнет.' },
      { minute: 5, kind: 'blight', apples: 10, text: 'Чума прошла трактом и попортила яблоки.' },
      { minute: 8, kind: 'drought', on: false, text: 'Дождь вернулся. Засуха отступила.' },
    ],
    bot: {
      tax: 'none',
      ration: 'half',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'shack', max: 1 },
      ],
    },
  },
  {
    id: 'dvoe',
    title: 'Два соседа',
    intro:
      'Тракт сужается. Слева купец, справа воевода: оба неспешные, но их двое. Останется тот, у кого устоит главное здание. Это последняя глава дороги.',
    objective: 'Завоюйте оба соседних посада',
    bonus: 'В живых остались хотя бы двое солдат',
    goal: { kind: 'conquest' },
    bonusKind: 'soldiers',
    seed: 4110,
    setup: match({
      ai: 2,
      victory: 'conquest',
      profiles: [
        { difficulty: 'easy', personality: 'warlord' },
        { difficulty: 'easy', personality: 'merchant' },
      ],
    }),
    parMinutes: 42,
    proofMinutes: 46,
    failMinutes: 0,
    shelterMinutes: 0,
    events: [{ minute: 4, kind: 'log', text: 'Оба соседа ещё копят силы.' }],
    bot: {
      tax: 'none',
      buildings: [
        { type: 'granary', max: 1 },
        { type: 'stockpile', max: 1 },
        { type: 'orchard', max: 1 },
        { type: 'woodcutter', max: 1 },
        { type: 'barracks', max: 1 },
      ],
      train: [{ weapon: 'club', count: 10, keepPeople: 1 }],
      attack: 'raid',
      attackSoldiers: 6,
      attackMinute: 5,
    },
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}

export function scenarioIndex(id: string): number {
  return SCENARIOS.findIndex((scenario) => scenario.id === id);
}

export function createCampaignGame(scenario: Scenario): GameState {
  const state = createGame(scenario.seed, { ai: scenario.setup.ai, setup: scenario.setup });
  prepare(scenario, state);
  state.message = '';
  state.log = [scenario.objective];
  return state;
}

function prepare(scenario: Scenario, state: GameState) {
  const keep = playerKeep(state, 0);
  if (scenario.id === 'korm') calm(state);
  if (scenario.id === 'kamen') {
    calm(state);
    grant(state, 0, 100, { wood: 48, stone: 10, apples: 80, iron: 1 });
  }
  if (scenario.id === 'nalet') {
    calm(state);
    addWolves(state, 0);
  }
  if (scenario.id === 'torg') {
    calm(state);
    setKeepLevel(state, 0, 2);
    grant(state, 0, 100, { wood: 40, stone: 10, apples: 80 });
  }
  if (scenario.id === 'hleb') {
    calm(state);
    setKeepLevel(state, 0, 3);
    grant(state, 0, 120, { wood: 80, stone: 40, apples: 90, iron: 2 });
    if (keep) paintDisc(state, keep.x + 2, keep.y - 8, 7, Terrain.Oasis);
  }
  if (scenario.id === 'stena') {
    calm(state);
    setKeepLevel(state, 0, 2);
    grant(state, 0, 80, { wood: 70, stone: 16, apples: 100 });
  }
  if (scenario.id === 'osada') {
    clearHostiles(state, 0);
    setKeepLevel(state, 0, 3);
    grant(state, 0, 160, { wood: 70, stone: 36, iron: 4, apples: 100 });
    fortify(state, 1);
  }
  if (scenario.id === 'rascvet') {
    clearHostiles(state, 0);
    grant(state, 0, 120, { wood: 56, stone: 20, apples: 90, iron: 2 });
  }
  if (scenario.id === 'suhoy') {
    calm(state);
    state.players[0].ration = 'half';
    state.players[0].tax = 'none';
    grant(state, 0, 40, { wood: 24, stone: 4, apples: 56 });
  }
  if (scenario.id === 'dvoe') {
    calm(state);
    setKeepLevel(state, 0, 2);
    grant(state, 0, 120, { wood: 64, apples: 100 });
    thinKeep(state, 2, 300);
  }
}
