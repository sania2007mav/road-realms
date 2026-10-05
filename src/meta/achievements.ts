/** Local achievements and lifetime stats. The sim never reads this module. */

export const META_KEY = 'dorozhnye-kraya-meta';

export type AchievementGroup = 'Экономика' | 'Война' | 'Сезоны' | 'Тракт' | 'Кампания' | 'Сеть' | 'Скрытые';

export interface AchievementDef {
  id: string;
  title: string;
  detail: string;
  icon: string;
  group: AchievementGroup;
  goal: number;
  secret: boolean;
  steam: string;
  yandex: string;
}

export interface MetaScratch {
  winter: boolean;
  winterHungry: boolean;
  creditedWinter: boolean;
  winNoted: boolean;
  wallNoted: boolean;
  fairNoted: boolean;
  stormNoted: boolean;
}

export interface MetaState {
  version: 1;
  unlocked: Record<string, number>;
  best: {
    gold: number;
    pop: number;
    wood: number;
    beer: number;
    bread: number;
    soldiers: number;
    razed: number;
    roads: number;
    apples: number;
  };
  trades: number;
  tradedIds: number[];
  raids: number;
  winters: number;
  games: number;
  wins: number;
  netGames: number;
  netWins: number;
  playMs: number;
  units: Record<string, number>;
  engineerKeeps: number;
  wallWins: number;
  cruelWins: number;
  speedWins: number;
  fairs: number;
  shelters: number;
  storms: number;
  campaignFirst: boolean;
  campaignDone: boolean;
  market: boolean;
  cavalry: boolean;
  siege: boolean;
  spear: boolean;
  scratch: MetaScratch;
}

export interface ObservePulse {
  gold: number;
  pop: number;
  happy: boolean;
  wood: number;
  beer: number;
  bread: number;
  apples: number;
  market: boolean;
  soldiers: number;
  cavalry: boolean;
  siege: boolean;
  spear: boolean;
  razed: number;
  roads: number;
  season: string;
  hunger: boolean;
  storm: boolean;
  fair: boolean;
  outcome: 'playing' | 'victory' | 'defeat' | string;
  hadWall: boolean;
  wallBroken: boolean;
  engineerKeep: boolean;
  raidDown: number;
  partyJoined: boolean;
  net: boolean;
  speed: number;
  cruel: boolean;
  campaignFirst: boolean;
  campaignAll: boolean;
}

export const UNIT_NAME: Record<string, string> = {
  club: 'ополченец',
  spear: 'копейщик',
  sword: 'мечник',
  bow: 'лучник',
  light: 'лёгкая конница',
  heavy: 'тяжёлая конница',
  crossbow: 'арбалетчик',
  shield: 'щитоносец',
  horsebow: 'степной лучник',
  engineer: 'инженер',
  ladder: 'лестница',
  siegetower: 'осадная башня',
  healer: 'лекарь',
  raider: 'наёмник',
  axe: 'топорник',
  ram: 'таран',
  catapult: 'катапульта',
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'gold-400', title: 'Собрать 400 золота', detail: 'Казна выросла выше стартового запаса.', icon: '🪙', group: 'Экономика', goal: 400, secret: false, steam: 'GOLD_400', yandex: 'gold_400' },
  { id: 'gold-1000', title: 'Собрать 1000 золота', detail: 'Тысяча монет в сундуке.', icon: '💰', group: 'Экономика', goal: 1000, secret: false, steam: 'GOLD_1000', yandex: 'gold_1000' },
  { id: 'wood-200', title: 'Запасти 200 дерева', detail: 'Дров хватит на долгую зиму.', icon: '🪵', group: 'Экономика', goal: 200, secret: false, steam: 'WOOD_200', yandex: 'wood_200' },
  { id: 'bread-40', title: 'Испечь 40 хлеба', detail: 'Пекарня не простаивает.', icon: '🍞', group: 'Экономика', goal: 40, secret: false, steam: 'BREAD_40', yandex: 'bread_40' },
  { id: 'beer-20', title: 'Сварить 20 пива', detail: 'Пивоварня работает.', icon: '🍺', group: 'Экономика', goal: 20, secret: false, steam: 'BEER_20', yandex: 'beer_20' },
  { id: 'market', title: 'Построить рынок', detail: 'На тракте появилась торговля.', icon: '🏷', group: 'Экономика', goal: 1, secret: false, steam: 'MARKET', yandex: 'market' },
  { id: 'happy-100', title: '100 человек счастливы', detail: 'Сотня людей, и настроение выше нуля.', icon: '😊', group: 'Экономика', goal: 100, secret: false, steam: 'HAPPY_100', yandex: 'happy_100' },
  { id: 'spear-1', title: 'Обучить копейщика', detail: 'Первый строй с копьями.', icon: '🗡', group: 'Война', goal: 1, secret: false, steam: 'SPEAR', yandex: 'spear' },
  { id: 'company-10', title: 'Десять солдат в строю', detail: 'Одновременно десять бойцов.', icon: '🛡', group: 'Война', goal: 10, secret: false, steam: 'COMPANY', yandex: 'company' },
  { id: 'cavalry', title: 'Поднять конницу', detail: 'Всадник выехал со двора.', icon: '🐴', group: 'Война', goal: 1, secret: false, steam: 'CAVALRY', yandex: 'cavalry' },
  { id: 'siege', title: 'Привезти осадную машину', detail: 'Таран, катапульта или башня.', icon: '🪵', group: 'Война', goal: 1, secret: false, steam: 'SIEGE', yandex: 'siege' },
  { id: 'razed-3', title: 'Три вражеских руины', detail: 'Снесено три чужих строения.', icon: '🔥', group: 'Война', goal: 3, secret: false, steam: 'RAZED_3', yandex: 'razed_3' },
  { id: 'wall-win', title: 'Победа без потерь стены', detail: 'Стена стояла до конца боя.', icon: '🧱', group: 'Война', goal: 1, secret: false, steam: 'WALL_WIN', yandex: 'wall_win' },
  { id: 'engineer-keep', title: 'Взять замок инженерами', detail: 'Инженер добил чужой замок.', icon: '⚙', group: 'Война', goal: 1, secret: false, steam: 'ENGINEER_KEEP', yandex: 'engineer_keep' },
  { id: 'winter-fed', title: 'Пережить зиму без голода', detail: 'Зима прошла, и люди не голодали.', icon: '❄', group: 'Сезоны', goal: 1, secret: false, steam: 'WINTER_FED', yandex: 'winter_fed' },
  { id: 'storm', title: 'Пережить грозу', detail: 'Гроза прошла над посадом.', icon: '⛈', group: 'Сезоны', goal: 1, secret: false, steam: 'STORM', yandex: 'storm' },
  { id: 'apples-200', title: 'Собрать 200 яблок', detail: 'Сады отдали урожай сверх стартовой корзины.', icon: '🍎', group: 'Сезоны', goal: 200, secret: false, steam: 'APPLES_200', yandex: 'apples_200' },
  { id: 'seasons-loop', title: 'Дождаться весны', detail: 'После сытой зимы снова весна.', icon: '❀', group: 'Сезоны', goal: 1, secret: false, steam: 'SPRING', yandex: 'spring' },
  { id: 'trade-1', title: 'Сделка с караваном', detail: 'Первая торговля на тракте.', icon: '🛒', group: 'Тракт', goal: 1, secret: false, steam: 'TRADE_1', yandex: 'trade_1' },
  { id: 'trade-10', title: 'Торговать с 10 караванами', detail: 'Десять разных караванов.', icon: '🐪', group: 'Тракт', goal: 10, secret: false, steam: 'TRADE_10', yandex: 'trade_10' },
  { id: 'raid-1', title: 'Отбить налёт', detail: 'Разбойники не ушли с добычей.', icon: '⚔', group: 'Тракт', goal: 1, secret: false, steam: 'RAID_1', yandex: 'raid_1' },
  { id: 'raid-3', title: 'Отбить три налёта', detail: 'Тракт снова тихий.', icon: '🛡', group: 'Тракт', goal: 3, secret: false, steam: 'RAID_3', yandex: 'raid_3' },
  { id: 'fair', title: 'Застать ярмарку', detail: 'Ярмарка открылась в посаде.', icon: '🎪', group: 'Тракт', goal: 1, secret: false, steam: 'FAIR', yandex: 'fair' },
  { id: 'shelter', title: 'Принять путников', detail: 'Беженцы вошли в дома.', icon: '👣', group: 'Тракт', goal: 1, secret: false, steam: 'SHELTER', yandex: 'shelter' },
  { id: 'campaign-first', title: 'Пройти первую стоянку', detail: 'Кампания начата победой.', icon: '🚩', group: 'Кампания', goal: 1, secret: false, steam: 'CAMP_1', yandex: 'camp_1' },
  { id: 'campaign-all', title: 'Закончить кампанию', detail: 'Все стоянки пройдены.', icon: '👑', group: 'Кампания', goal: 1, secret: false, steam: 'CAMP_ALL', yandex: 'camp_all' },
  { id: 'net-play', title: 'Сыграть по сети', detail: 'Партия с другим игроком.', icon: '🌐', group: 'Сеть', goal: 1, secret: false, steam: 'NET_PLAY', yandex: 'net_play' },
  { id: 'net-win', title: 'Победа в сети', detail: 'Сетевая партия выиграна.', icon: '🏆', group: 'Сеть', goal: 1, secret: false, steam: 'NET_WIN', yandex: 'net_win' },
  { id: 'secret-road', title: 'Сорок клеток своего тракта', detail: 'Дорога длиной в сорок клеток.', icon: '🛤', group: 'Скрытые', goal: 40, secret: true, steam: 'SECRET_ROAD', yandex: 'secret_road' },
  { id: 'secret-cruel', title: 'Победить жестокого соседа', detail: 'Жестокий воевода разбит.', icon: '😈', group: 'Скрытые', goal: 1, secret: true, steam: 'SECRET_CRUEL', yandex: 'secret_cruel' },
  { id: 'secret-pace', title: 'Победа на тройной скорости', detail: 'Матч выигран на 3×.', icon: '⏩', group: 'Скрытые', goal: 1, secret: true, steam: 'SECRET_PACE', yandex: 'secret_pace' },
  { id: 'secret-time', title: 'Два часа за трактом', detail: 'Два часа за игрой.', icon: '⏳', group: 'Скрытые', goal: 1, secret: true, steam: 'SECRET_TIME', yandex: 'secret_time' },
];

const TWO_HOURS = 2 * 60 * 60 * 1000;

function scratch(): MetaScratch {
  return {
    winter: false,
    winterHungry: false,
    creditedWinter: false,
    winNoted: false,
    wallNoted: false,
    fairNoted: false,
    stormNoted: false,
  };
}

export function emptyMeta(): MetaState {
  return {
    version: 1,
    unlocked: {},
    best: { gold: 0, pop: 0, wood: 0, beer: 0, bread: 0, soldiers: 0, razed: 0, roads: 0, apples: 0 },
    trades: 0,
    tradedIds: [],
    raids: 0,
    winters: 0,
    games: 0,
    wins: 0,
    netGames: 0,
    netWins: 0,
    playMs: 0,
    units: {},
    engineerKeeps: 0,
    wallWins: 0,
    cruelWins: 0,
    speedWins: 0,
    fairs: 0,
    shelters: 0,
    storms: 0,
    campaignFirst: false,
    campaignDone: false,
    market: false,
    cavalry: false,
    siege: false,
    spear: false,
    scratch: scratch(),
  };
}

export function loadMeta(): MetaState {
  try {
    return parseMeta(globalThis.localStorage?.getItem(META_KEY) ?? null);
  } catch {
    return emptyMeta();
  }
}

export function saveMeta(meta: MetaState): void {
  try {
    globalThis.localStorage?.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* private mode */
  }
}

export function parseMeta(raw: string | null): MetaState {
  const base = emptyMeta();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<MetaState>;
    if (!data || data.version !== 1) return base;
    return {
      ...base,
      ...data,
      version: 1,
      unlocked: { ...base.unlocked, ...(data.unlocked ?? {}) },
      best: { ...base.best, ...(data.best ?? {}) },
      units: { ...base.units, ...(data.units ?? {}) },
      tradedIds: Array.isArray(data.tradedIds) ? data.tradedIds.filter((id) => Number.isFinite(id)) : [],
      scratch: { ...base.scratch, ...(data.scratch ?? {}) },
    };
  } catch {
    return base;
  }
}

export function beginMatch(meta: MetaState, net: boolean): MetaState {
  return {
    ...meta,
    games: meta.games + 1,
    netGames: meta.netGames + (net ? 1 : 0),
    scratch: scratch(),
  };
}

export function noteTrade(meta: MetaState, caravanId: number): MetaState {
  if (meta.tradedIds.includes(caravanId)) return meta;
  return { ...meta, tradedIds: [...meta.tradedIds, caravanId], trades: meta.trades + 1 };
}

export function noteUnit(meta: MetaState, weapon: string): MetaState {
  return { ...meta, units: { ...meta.units, [weapon]: (meta.units[weapon] ?? 0) + 1 } };
}

export function addPlayMs(meta: MetaState, ms: number): MetaState {
  if (ms <= 0) return meta;
  return { ...meta, playMs: meta.playMs + ms };
}

function maxBest(meta: MetaState, pulse: ObservePulse): MetaState['best'] {
  return {
    gold: Math.max(meta.best.gold, pulse.gold),
    pop: Math.max(meta.best.pop, pulse.happy ? pulse.pop : meta.best.pop),
    wood: Math.max(meta.best.wood, pulse.wood),
    beer: Math.max(meta.best.beer, pulse.beer),
    bread: Math.max(meta.best.bread, pulse.bread),
    soldiers: Math.max(meta.best.soldiers, pulse.soldiers),
    razed: Math.max(meta.best.razed, pulse.razed),
    roads: Math.max(meta.best.roads, pulse.roads),
    apples: Math.max(meta.best.apples, pulse.apples),
  };
}

export function observe(meta: MetaState, pulse: ObservePulse): { meta: MetaState; fresh: AchievementDef[] } {
  const scratchNext = { ...meta.scratch };
  let winters = meta.winters;
  if (pulse.season === 'winter') {
    if (!scratchNext.winter) {
      scratchNext.winter = true;
      scratchNext.winterHungry = false;
      scratchNext.creditedWinter = false;
    }
    if (pulse.hunger) scratchNext.winterHungry = true;
  } else if (scratchNext.winter && pulse.season === 'spring' && !scratchNext.winterHungry && !scratchNext.creditedWinter) {
    winters += 1;
    scratchNext.creditedWinter = true;
    scratchNext.winter = false;
  } else if (pulse.season !== 'spring') {
    scratchNext.winter = false;
  }

  let storms = meta.storms;
  if (pulse.storm && !scratchNext.stormNoted) {
    storms += 1;
    scratchNext.stormNoted = true;
  }
  if (!pulse.storm) scratchNext.stormNoted = false;

  let fairs = meta.fairs;
  if (pulse.fair && !scratchNext.fairNoted) {
    fairs += 1;
    scratchNext.fairNoted = true;
  }

  let wins = meta.wins;
  let netWins = meta.netWins;
  let wallWins = meta.wallWins;
  let cruelWins = meta.cruelWins;
  let speedWins = meta.speedWins;
  if (pulse.outcome === 'victory' && !scratchNext.winNoted) {
    scratchNext.winNoted = true;
    wins += 1;
    if (pulse.net) netWins += 1;
    if (pulse.hadWall && !pulse.wallBroken && !scratchNext.wallNoted) {
      wallWins += 1;
      scratchNext.wallNoted = true;
    }
    if (pulse.cruel) cruelWins += 1;
    if (pulse.speed >= 3) speedWins += 1;
  }

  const next: MetaState = {
    ...meta,
    best: maxBest(meta, pulse),
    winters,
    storms,
    fairs,
    wins,
    netWins,
    wallWins,
    cruelWins,
    speedWins,
    raids: meta.raids + Math.max(0, pulse.raidDown),
    shelters: meta.shelters + (pulse.partyJoined ? 1 : 0),
    engineerKeeps: meta.engineerKeeps + (pulse.engineerKeep ? 1 : 0),
    market: meta.market || pulse.market,
    cavalry: meta.cavalry || pulse.cavalry,
    siege: meta.siege || pulse.siege,
    spear: meta.spear || pulse.spear,
    campaignFirst: meta.campaignFirst || pulse.campaignFirst,
    campaignDone: meta.campaignDone || pulse.campaignAll,
    scratch: scratchNext,
  };
  const fresh: AchievementDef[] = [];
  const unlocked = { ...next.unlocked };
  const now = Date.now();
  for (const item of ACHIEVEMENTS) {
    if (unlocked[item.id]) continue;
    if (progressOf(next, item.id).value < item.goal) continue;
    unlocked[item.id] = now;
    fresh.push(item);
  }
  return { meta: { ...next, unlocked }, fresh };
}

export function progressOf(meta: MetaState, id: string): { value: number; goal: number } {
  const item = ACHIEVEMENTS.find((entry) => entry.id === id);
  const goal = item?.goal ?? 1;
  const value = (() => {
    switch (id) {
      case 'gold-400':
      case 'gold-1000':
        return meta.best.gold;
      case 'wood-200':
        return meta.best.wood;
      case 'bread-40':
        return meta.best.bread;
      case 'beer-20':
        return meta.best.beer;
      case 'market':
        return meta.market ? 1 : 0;
      case 'happy-100':
        return meta.best.pop;
      case 'spear-1':
        return meta.spear ? 1 : 0;
      case 'company-10':
        return meta.best.soldiers;
      case 'cavalry':
        return meta.cavalry ? 1 : 0;
      case 'siege':
        return meta.siege ? 1 : 0;
      case 'razed-3':
        return meta.best.razed;
      case 'wall-win':
        return meta.wallWins;
      case 'engineer-keep':
        return meta.engineerKeeps;
      case 'winter-fed':
      case 'seasons-loop':
        return meta.winters;
      case 'storm':
        return meta.storms;
      case 'apples-200':
        return meta.best.apples;
      case 'trade-1':
      case 'trade-10':
        return meta.trades;
      case 'raid-1':
      case 'raid-3':
        return meta.raids;
      case 'fair':
        return meta.fairs;
      case 'shelter':
        return meta.shelters;
      case 'campaign-first':
        return meta.campaignFirst ? 1 : 0;
      case 'campaign-all':
        return meta.campaignDone ? 1 : 0;
      case 'net-play':
        return meta.netGames;
      case 'net-win':
        return meta.netWins;
      case 'secret-road':
        return meta.best.roads;
      case 'secret-cruel':
        return meta.cruelWins;
      case 'secret-pace':
        return meta.speedWins;
      case 'secret-time':
        return meta.playMs >= TWO_HOURS ? 1 : 0;
      default:
        return 0;
    }
  })();
  return { value: Math.min(goal, Math.max(0, value)), goal };
}

export interface AchievementRow {
  id: string;
  title: string;
  detail: string;
  icon: string;
  group: AchievementGroup;
  secret: boolean;
  hidden: boolean;
  value: number;
  goal: number;
  done: boolean;
}

export function achievementRows(meta: MetaState): AchievementRow[] {
  return ACHIEVEMENTS.map((item) => {
    const progress = progressOf(meta, item.id);
    const done = Boolean(meta.unlocked[item.id]);
    const hidden = item.secret && !done;
    return {
      id: item.id,
      title: hidden ? 'Скрытое достижение' : item.title,
      detail: hidden ? 'Откроется само.' : item.detail,
      icon: hidden ? '?' : item.icon,
      group: item.group,
      secret: item.secret,
      hidden,
      value: hidden ? 0 : progress.value,
      goal: progress.goal,
      done,
    };
  });
}

export function unlockedCount(meta: MetaState): { done: number; total: number } {
  return { done: Object.keys(meta.unlocked).length, total: ACHIEVEMENTS.length };
}

export function favoriteUnit(meta: MetaState): string {
  let best = '';
  let count = 0;
  for (const [weapon, value] of Object.entries(meta.units)) {
    if (value > count) {
      best = weapon;
      count = value;
    }
  }
  if (!best) return 'ещё нет';
  return UNIT_NAME[best] ?? best;
}

export function formatPlay(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours} ч ${rest} мин`;
  return `${rest} мин`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);
}

export function achievementsHtml(meta: MetaState): string {
  const count = unlockedCount(meta);
  const groups: AchievementGroup[] = ['Экономика', 'Война', 'Сезоны', 'Тракт', 'Кампания', 'Сеть', 'Скрытые'];
  const rows = achievementRows(meta);
  const body = groups
    .map((group) => {
      const items = rows.filter((row) => row.group === group);
      const cards = items
        .map((row) => {
          const width = row.goal > 0 ? Math.round((row.value / row.goal) * 100) : 0;
          return `<article class="ach${row.done ? ' done' : ''}${row.hidden ? ' secret' : ''}" data-done="${row.done ? '1' : '0'}" data-testid="ach-${row.id}">
            <span class="ach-ico" aria-hidden="true">${escapeHtml(row.icon)}</span>
            <div class="ach-copy">
              <b>${escapeHtml(row.title)}</b>
              <p>${escapeHtml(row.detail)}</p>
              <small>${row.hidden ? '???' : `${row.value} / ${row.goal}`}</small>
            </div>
            <div class="ach-bar" role="progressbar" aria-valuenow="${row.value}" aria-valuemax="${row.goal}"><span style="width:${width}%"></span></div>
          </article>`;
        })
        .join('');
      return `<section class="ach-group"><h3>${group}</h3>${cards}</section>`;
    })
    .join('');
  return `<div class="card help-card">
    <header class="help-head ach-head"><h2>Достижения <span data-testid="achieve-count">${count.done} / ${count.total}</span></h2></header>
    <div class="ach-filters" role="tablist">
      <button type="button" data-filter="all" data-testid="ach-filter-all" class="on">Все</button>
      <button type="button" data-filter="done" data-testid="ach-filter-done">Полученные</button>
      <button type="button" data-filter="open" data-testid="ach-filter-open">В процессе</button>
    </div>
    <div class="help-body">${body}</div>
    <div class="actions"><button type="button" id="achieve-close" data-testid="achieve-close">Закрыть</button></div>
  </div>`;
}

export function statsHtml(meta: MetaState): string {
  const count = unlockedCount(meta);
  return `<div class="card help-card">
    <h2>Статистика</h2>
    <div class="help-body">
      <dl class="stat-list" data-testid="stats-list">
        <div><dt>Сыграно партий</dt><dd data-testid="stats-games">${meta.games}</dd></div>
        <div><dt>Побед</dt><dd data-testid="stats-wins">${meta.wins}</dd></div>
        <div><dt>Время в игре</dt><dd data-testid="stats-time">${formatPlay(meta.playMs)}</dd></div>
        <div><dt>Любимый отряд</dt><dd data-testid="stats-unit">${escapeHtml(favoriteUnit(meta))}</dd></div>
        <div><dt>Достижения</dt><dd>${count.done} / ${count.total}</dd></div>
        <div><dt>Сетевые партии</dt><dd>${meta.netGames}</dd></div>
        <div><dt>Караваны</dt><dd>${meta.trades}</dd></div>
      </dl>
    </div>
    <div class="actions"><button type="button" id="stats-close" data-testid="stats-close">Закрыть</button></div>
  </div>`;
}
