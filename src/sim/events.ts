import { housingOf, POP_MAX, POP_MIN, PRICES, TICKS_PER_GAME_MINUTE } from './balance';
import { createMob, createPerson } from './entities';
import type { Building, Caravan, EventPace, GameState, Mob, Resource, RoadNote, RoadParty, RoadState } from './types';
import { Terrain } from './types';
import { roadCenter } from './roads';

const GOODS: Resource[] = ['wood', 'apples', 'iron'];

export function eventPace(value: unknown): EventPace {
  return value === 'rare' || value === 'normal' || value === 'often' ? value : 'off';
}

export function eventName(pace: EventPace | undefined): string {
  if (pace === 'rare') return 'редко';
  if (pace === 'often') return 'часто';
  if (pace === 'normal') return 'обычно';
  return 'выкл';
}

/** Game minutes between caravans. Fairs and raids use the same clock. */
export function eventGap(pace: EventPace): number {
  if (pace === 'often') return 4;
  if (pace === 'normal') return 8;
  if (pace === 'rare') return 14;
  return 0;
}

export function emptyRoad(players = 4): RoadState {
  return {
    caravans: [],
    fair: null,
    party: null,
    notes: [],
    anger: Array.from({ length: Math.max(1, players) }, () => -1),
    seq: 1,
  };
}

export function ensureRoad(state: GameState): RoadState {
  if (!state.road) state.road = emptyRoad(state.players.length);
  while (state.road.anger.length < state.players.length) state.road.anger.push(-1);
  return state.road;
}

function angers(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  if (state.match?.teams !== 'pairs') return true;
  const half = Math.max(1, Math.ceil(state.players.length / 2));
  return (a < half) !== (b < half);
}

function paceOf(state: GameState): EventPace {
  return eventPace(state.match?.events);
}

function roll(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  return h >>> 0;
}

function tell(state: GameState, text: string, x: number, y: number) {
  if (!state.log.includes(text)) {
    state.log.push(text);
    if (state.log.length > 8) state.log.shift();
  }
  const road = ensureRoad(state);
  const note: RoadNote = { id: road.seq++, text, x, y, until: state.tick + 180 };
  road.notes = [note, ...road.notes.filter((item) => item.until > state.tick)].slice(0, 3);
}

function keeps(state: GameState): Building[] {
  return state.buildings.filter((building) => building.type === 'keep' && building.hp > 0 && state.players[building.playerId]?.alive);
}

function center(building: Building): { x: number; y: number } {
  return { x: building.x + 1, y: building.y + 1 };
}

function peopleNow(state: GameState, playerId: number): number {
  return state.people.filter((person) => person.playerId === playerId && person.hp > 0).length;
}

function homes(state: GameState, playerId: number): number {
  let cap = 0;
  for (const building of state.buildings) {
    if (building.playerId !== playerId || !building.complete || building.hp <= 0) continue;
    cap += housingOf(building.type, building.level);
  }
  return cap;
}

/** One step of travel. Off matches leave the world untouched. */
export function moveRoad(state: GameState): void {
  if (paceOf(state) === 'off' || !state.road) return;
  const speed = 0.065;
  for (const caravan of state.road.caravans) {
    if (!caravan.alive) continue;
    const dir = caravan.toX >= caravan.x ? 1 : -1;
    caravan.x += dir * speed;
    caravan.y = roadCenter(state, caravan.x) + 0.15;
    if (Math.abs(caravan.x - caravan.toX) <= speed) {
      caravan.alive = false;
      const host = state.players[caravan.toId];
      if (host?.alive) {
        host.gold += 4;
        if (host.stats) host.stats.goldEarned += 4;
      }
      tell(state, 'Караван добрался до посада', caravan.toX, state.roadY);
    }
  }
  state.road.caravans = state.road.caravans.filter((caravan) => caravan.alive && caravan.hp > 0);
  const party = state.road.party;
  if (party) {
    const keep = keeps(state).find((building) => building.playerId === party.playerId);
    if (!keep || state.tick > party.until) {
      if (party && state.tick > party.until) tell(state, 'Путники прошли мимо: нет жилья', party.x, party.y);
      state.road.party = null;
    } else {
      const spot = center(keep);
      const dx = spot.x - party.x;
      const dy = spot.y - party.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < 1.4) {
        const room = homes(state, party.playerId) - peopleNow(state, party.playerId);
        if (room >= party.count) {
          for (let i = 0; i < party.count; i++) createPerson(state, party.playerId, spot.x + i * 0.3, spot.y + 1.2, i);
          tell(state, 'Путники остались: для них нашлось жильё', spot.x, spot.y);
          state.road.party = null;
        }
      } else {
        party.x += (dx / dist) * 0.05;
        party.y += (dy / dist) * 0.05;
      }
    }
  }
  guideRaiders(state);
}

function guideRaiders(state: GameState) {
  const road = state.road;
  if (!road) return;
  const caravan = road.caravans.find((item) => item.alive);
  for (const mob of state.mobs) {
    if (!mob.alive || !mob.raid) continue;
    if (caravan) {
      mob.destX = caravan.x;
      mob.destY = caravan.y;
      continue;
    }
    const weak = weakOutpost(state, mob);
    if (weak) {
      const spot = center(weak);
      mob.destX = spot.x;
      mob.destY = spot.y;
    }
  }
}

function weakOutpost(state: GameState, mob: Mob): Building | null {
  let best: Building | null = null;
  let bestD = 1e9;
  for (const building of state.buildings) {
    if (building.hp <= 0 || !building.complete || building.type === 'keep') continue;
    if (building.type === 'woodtower' || building.type === 'stonetower' || building.type === 'wall' || building.type === 'gate') continue;
    const spot = center(building);
    const covered = state.buildings.some((tower) => {
      if (tower.hp <= 0 || (tower.type !== 'woodtower' && tower.type !== 'stonetower')) return false;
      const place = center(tower);
      return Math.hypot(place.x - spot.x, place.y - spot.y) < 7;
    });
    if (covered) continue;
    const dist = Math.hypot(spot.x - mob.x, spot.y - mob.y);
    if (dist < bestD) {
      best = building;
      bestD = dist;
    }
  }
  return best;
}

/** Bandits already steered this tick bite a caravan or a soft building. */
export function raidStrike(state: GameState, mob: Mob): boolean {
  if (!mob.raid) return false;
  const road = state.road;
  const caravan = road?.caravans.find((item) => item.alive && Math.hypot(item.x - mob.x, item.y - mob.y) < 1.15);
  if (caravan && state.tick % 20 === 0) {
    caravan.hp -= mob.dmg;
    if (caravan.hp <= 0) {
      caravan.alive = false;
      tell(state, 'Разбойники взяли караван', caravan.x, caravan.y);
    }
  }
  const building = state.buildings.find((item) => {
    if (item.hp <= 0 || item.type === 'keep' || item.type === 'woodtower' || item.type === 'stonetower') return false;
    const spot = center(item);
    return Math.hypot(spot.x - mob.x, spot.y - mob.y) < 1.15;
  });
  if (!caravan && building && state.tick % 20 === 0) building.hp = Math.max(0, building.hp - mob.dmg);
  return true;
}

export function roadMinute(state: GameState): void {
  const pace = paceOf(state);
  if (pace === 'off') return;
  if (state.tick <= 0 || state.tick % TICKS_PER_GAME_MINUTE !== 0) return;
  const road = ensureRoad(state);
  road.notes = road.notes.filter((note) => note.until > state.tick);
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  if (minute < 12) return;
  const gap = eventGap(pace);
  if (gap > 0 && minute % gap === 0) spawnCaravan(state);
  if (gap > 0 && minute % (gap * 2) === Math.min(3, gap)) spawnFair(state);
  if (gap > 0 && minute % gap === Math.min(2, gap - 1)) spawnRaid(state);
  if (gap > 0 && minute % gap === 1) spawnParty(state);
}

function spawnCaravan(state: GameState) {
  const road = ensureRoad(state);
  if (road.caravans.length >= 2) return;
  const posts = keeps(state);
  if (posts.length < 2) return;
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  const pick = roll(state.seed, minute + 11) % posts.length;
  const from = posts[pick];
  const to = posts[(pick + 1 + (roll(state.seed, minute + 19) % (posts.length - 1))) % posts.length];
  if (!to || to.id === from.id) return;
  const spot = center(from);
  const dest = center(to);
  const rare = roll(state.seed, minute + 23) % 5 === 0;
  const caravan: Caravan = {
    id: state.nextId++,
    fromId: from.playerId,
    toId: to.playerId,
    x: spot.x,
    y: roadCenter(state, spot.x) + 0.15,
    toX: dest.x,
    hp: 40,
    gold: 36,
    wood: 10,
    apples: 8,
    iron: rare ? 2 : 1,
    weapons: rare ? 1 : 0,
    alive: true,
  };
  road.caravans.push(caravan);
  tell(state, 'По тракту идёт купеческий караван', caravan.x, caravan.y);
}

function spawnFair(state: GameState) {
  const road = ensureRoad(state);
  if (road.fair && state.tick < road.fair.until) return;
  const markets = state.buildings.filter(
    (building) => building.type === 'market' && building.complete && building.hp > 0 && state.players[building.playerId]?.alive,
  );
  if (!markets.length) return;
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  const market = markets[roll(state.seed, minute + 41) % markets.length];
  const spot = center(market);
  road.fair = { playerId: market.playerId, x: spot.x, y: spot.y, until: state.tick + 2 * TICKS_PER_GAME_MINUTE };
  const player = state.players[market.playerId];
  if (!player) return;
  player.popularity = Math.min(POP_MAX, player.popularity + 4);
  player.gold += 18;
  if (player.stats) player.stats.goldEarned += 18;
  player.stocks.weapons = (player.stocks.weapons ?? 0) + 1;
  tell(state, 'Ярмарка: настроение, золото и редкий товар', spot.x, spot.y);
}

function spawnRaid(state: GameState) {
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  const edge = roll(state.seed, minute + 7) % 2 === 0;
  let x = edge ? 2 : state.mapW - 3;
  let y = Math.round(roadCenter(state, x));
  if (!edge) {
    const forest = forestNearRoad(state, minute);
    if (forest) {
      x = forest.x;
      y = forest.y;
    }
  }
  const count = 2;
  for (let i = 0; i < count; i++) {
    const mob = createMob(state, 'bandit', x + i * 0.8, y + (i % 2));
    mob.raid = 1;
    mob.respawn = 0;
  }
  tell(state, 'С опушки вышли разбойники', x, y);
}

function forestNearRoad(state: GameState, minute: number): { x: number; y: number } | null {
  const span = 18;
  const origin = 4 + (roll(state.seed, minute + 3) % Math.max(1, state.mapW - 8));
  for (let dx = 0; dx < span; dx++) {
    const x = (origin + dx) % state.mapW;
    const row = roadCenter(state, x);
    for (const y of [row - 4, row + 4, row - 6, row + 6]) {
      if (y < 1 || y >= state.mapH - 1) continue;
      if (state.terrain[y * state.mapW + x] === Terrain.Forest) return { x, y };
    }
  }
  return null;
}

function spawnParty(state: GameState) {
  const road = ensureRoad(state);
  if (road.party) return;
  const posts = keeps(state);
  if (!posts.length) return;
  const minute = Math.floor(state.tick / TICKS_PER_GAME_MINUTE);
  const keep = posts[roll(state.seed, minute + 53) % posts.length];
  const spot = center(keep);
  const kind = roll(state.seed, minute + 59) % 2 === 0 ? 'refugees' : 'travelers';
  const party: RoadParty = {
    id: state.nextId++,
    kind,
    playerId: keep.playerId,
    x: Math.max(2, spot.x - 8),
    y: roadCenter(state, Math.max(2, spot.x - 8)),
    count: 2,
    until: state.tick + 4 * TICKS_PER_GAME_MINUTE,
  };
  road.party = party;
  tell(state, kind === 'refugees' ? 'Беженцы просят кров' : 'Путники ищут, где осесть', party.x, party.y);
}

export function caravanNear(state: GameState, playerId: number, caravan: Caravan): boolean {
  const keep = keeps(state).find((building) => building.playerId === playerId);
  if (!keep) return false;
  const spot = center(keep);
  return Math.hypot(caravan.x - spot.x, caravan.y - spot.y) < 14 || Math.abs(caravan.x - spot.x) < 10;
}

export function tradeCaravan(state: GameState, playerId: number, caravanId: number, resource: Resource, mode: 'buy' | 'sell', qty: number): boolean {
  if (paceOf(state) === 'off') return false;
  const player = state.players[playerId];
  const caravan = ensureRoad(state).caravans.find((item) => item.alive && item.id === caravanId);
  if (!player?.alive || !caravan) {
    state.message = 'Караван уже ушёл';
    return false;
  }
  if (!caravanNear(state, playerId, caravan)) {
    state.message = 'Караван слишком далеко';
    return false;
  }
  if (!GOODS.includes(resource) && resource !== 'weapons') {
    state.message = 'Этого караван не возит';
    return false;
  }
  const count = Math.max(1, Math.min(8, Math.floor(qty)));
  const price = mode === 'buy' ? PRICES[resource].buy : PRICES[resource].sell;
  const stock = cargoOf(caravan, resource);
  if (mode === 'buy') {
    if (stock < count) {
      state.message = 'В караване этого нет';
      return false;
    }
    const cost = price * count;
    if (player.gold < cost) {
      state.message = 'Не хватает золота';
      return false;
    }
    player.gold -= cost;
    caravan.gold += cost;
    setCargo(caravan, resource, stock - count);
    player.stocks[resource] = (player.stocks[resource] ?? 0) + count;
    state.message = `Куплено у каравана: ${count}`;
    return true;
  }
  if ((player.stocks[resource] ?? 0) < count) {
    state.message = 'Нечего продать';
    return false;
  }
  player.stocks[resource] -= count;
  player.gold += price * count;
  if (player.stats) player.stats.goldEarned += price * count;
  caravan.gold = Math.max(0, caravan.gold - price * count);
  setCargo(caravan, resource, stock + count);
  state.message = `Продано каравану: ${count}`;
  return true;
}

function cargoOf(caravan: Caravan, resource: Resource): number {
  if (resource === 'wood') return caravan.wood;
  if (resource === 'apples') return caravan.apples;
  if (resource === 'iron') return caravan.iron;
  if (resource === 'weapons') return caravan.weapons;
  return 0;
}

function setCargo(caravan: Caravan, resource: Resource, value: number) {
  if (resource === 'wood') caravan.wood = value;
  else if (resource === 'apples') caravan.apples = value;
  else if (resource === 'iron') caravan.iron = value;
  else if (resource === 'weapons') caravan.weapons = value;
}

export function sackCaravan(state: GameState, playerId: number, caravanId: number): boolean {
  if (paceOf(state) === 'off') return false;
  const player = state.players[playerId];
  const road = ensureRoad(state);
  const caravan = road.caravans.find((item) => item.alive && item.id === caravanId);
  if (!player?.alive || !caravan) {
    state.message = 'Караван уже ушёл';
    return false;
  }
  if (!caravanNear(state, playerId, caravan)) {
    state.message = 'Караван слишком далеко';
    return false;
  }
  player.stocks.wood = (player.stocks.wood ?? 0) + caravan.wood;
  player.stocks.apples = (player.stocks.apples ?? 0) + caravan.apples;
  player.stocks.iron = (player.stocks.iron ?? 0) + caravan.iron;
  player.stocks.weapons = (player.stocks.weapons ?? 0) + caravan.weapons;
  const loot = Math.floor(caravan.gold / 2);
  player.gold += loot;
  if (player.stats) player.stats.goldEarned += loot;
  player.popularity = Math.max(POP_MIN, player.popularity - 4);
  for (const other of [caravan.fromId, caravan.toId]) {
    if (other === playerId) continue;
    if (!state.players[other] || !angers(state, other, playerId)) continue;
    road.anger[other] = playerId;
  }
  caravan.alive = false;
  road.caravans = road.caravans.filter((item) => item.alive);
  tell(state, 'Караван разграблен. Соседи запомнят', caravan.x, caravan.y);
  state.message = 'Караван разграблен';
  return true;
}

export function hashRoad(state: GameState): string[] {
  const pace = paceOf(state);
  if (pace === 'off' || !state.road) return [];
  const parts = [`E${pace}`];
  for (const caravan of state.road.caravans) {
    parts.push(
      `V${caravan.id}|${caravan.fromId}|${caravan.toId}|${caravan.x}|${caravan.y}|${caravan.hp}|${caravan.gold}|${caravan.wood}|${caravan.apples}|${caravan.iron}|${caravan.weapons}`,
    );
  }
  if (state.road.fair) parts.push(`F${state.road.fair.playerId}|${state.road.fair.until}|${state.road.fair.x}|${state.road.fair.y}`);
  if (state.road.party) {
    const party = state.road.party;
    parts.push(`T${party.id}|${party.kind}|${party.playerId}|${party.x}|${party.y}|${party.count}|${party.until}`);
  }
  if (state.road.anger.some((value) => value >= 0)) parts.push(`A${state.road.anger.join(',')}`);
  return parts;
}
