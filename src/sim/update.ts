import {
  AI_EVERY,
  BUFFER_CAP,
  BUILDINGS,
  BUILD_RADIUS,
  CLUB_COST,
  CONSUME_EVERY,
  ENEMY_KEEP_GAP,
  KEEP_UPGRADE_COST,
  KEEP_UPGRADE_TICKS,
  OX_BUFFER_CAP,
  OX_CARRY,
  OX_SPEED,
  PERSON_SPEED,
  PLAGUE_CHANCE,
  PLAGUE_TICKS,
  POP_EVERY,
  SOLDIER_SPEED,
  TAX_EVERY,
  TRAIN_COST,
  PRICES,
  RESOURCE_NAME,
  foodTypesIn,
  housingOf,
  popularityTarget,
  taxGold,
} from './balance';
import { consumeFood, totalFood } from './economy';
import { createOx, createPerson, createSoldier } from './entities';
import { rngNext } from './rng';
import type {
  Building,
  BuildingType,
  Command,
  GameState,
  Mob,
  Ox,
  Person,
  Player,
  Ration,
  Resource,
  Soldier,
  TaxId,
} from './types';
import { FOODS, RESOURCES, Terrain } from './types';
import { formationPoints } from './formation';
import { findPath } from './path';
import {
  approach,
  bowRange,
  fortDamage,
  moverOf,
  blocksMover,
  nearestBreach,
  nextAiSiege,
  onOwnTower,
  routeBlocked,
  spawnCloud,
  strikeReach,
  towerSlotFor,
  trainHall,
  updateSiege,
} from './siege';
import { terrainAt } from './world';

export function buildingCenter(building: Building): { x: number; y: number } {
  const def = BUILDINGS[building.type];
  return { x: building.x + def.w / 2, y: building.y + def.h / 2 };
}

export function buildingById(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function playerKeep(state: GameState, playerId: number): Building | undefined {
  return state.buildings.find((b) => b.playerId === playerId && b.type === 'keep' && b.hp > 0);
}

export function housingCap(state: GameState, playerId: number): number {
  let cap = 0;
  for (const building of state.buildings) {
    if (building.playerId !== playerId || !building.complete || building.hp <= 0) continue;
    cap += housingOf(building.type, building.level);
  }
  return cap;
}

export function idleCount(state: GameState, playerId: number): number {
  return state.people.filter((p) => p.playerId === playerId && p.hp > 0 && p.task.type === 'idle').length;
}

export function usedCount(state: GameState, playerId: number): number {
  return state.people.filter((p) => p.playerId === playerId && p.hp > 0 && p.task.type !== 'idle').length;
}

export function currentTarget(state: GameState, playerId: number): { value: number; reasons: { label: string; value: number }[] } {
  const player = state.players[playerId];
  return popularityTarget({
    ration: player.ration,
    foodTypes: foodTypesIn(player.stocks),
    tax: player.tax,
    beer: player.beerMood > 0,
    hunger: player.hunger,
  });
}

function takeRng(state: GameState): number {
  const next = rngNext(state.rng);
  state.rng = next.state;
  return next.value;
}

function pushLog(state: GameState, text: string) {
  state.log.push(text);
  if (state.log.length > 8) state.log.shift();
}

function note(state: GameState, text: string) {
  if (state.log.includes(text)) return;
  pushLog(state, text);
}

function moveToward(ent: { x: number; y: number }, x: number, y: number, speed: number): boolean {
  const dx = x - ent.x;
  const dy = y - ent.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed || d < 1e-6) {
    ent.x = x;
    ent.y = y;
    return true;
  }
  ent.x += (dx / d) * speed;
  ent.y += (dy / d) * speed;
  return false;
}

function walkPerson(state: GameState, person: Person, x: number, y: number, speed: number): boolean {
  return approach(state, person, x, y, speed, person.playerId, 'worker');
}

function walkOx(state: GameState, ox: Ox, x: number, y: number, speed: number): boolean {
  return approach(state, ox, x, y, speed, ox.playerId, 'worker');
}

function walkSoldier(state: GameState, soldier: Soldier, x: number, y: number, speed: number): boolean {
  return approach(state, soldier, x, y, speed, soldier.playerId, moverOf(soldier));
}

function canAfford(stocks: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  for (const key of RESOURCES) {
    if ((stocks[key] ?? 0) < (cost[key] ?? 0)) return false;
  }
  return true;
}

function pay(stocks: Record<Resource, number>, cost: Partial<Record<Resource, number>>) {
  for (const key of RESOURCES) stocks[key] -= cost[key] ?? 0;
}

function refund(stocks: Record<Resource, number>, cost: Partial<Record<Resource, number>>, ratio: number) {
  for (const key of RESOURCES) stocks[key] += Math.floor((cost[key] ?? 0) * ratio);
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function isStorage(type: BuildingType): boolean {
  return type === 'granary' || type === 'stockpile' || type === 'keep';
}

function isOrdinary(terrain: number): boolean {
  return terrain === Terrain.Land || terrain === Terrain.Desert || terrain === Terrain.Oasis;
}

export function canPlace(
  state: GameState,
  playerId: number,
  type: BuildingType,
  x: number,
  y: number,
): { ok: boolean; reason: string } {
  const player = state.players[playerId];
  if (!player || !player.alive) return { ok: false, reason: 'Поселение пало' };
  const def = BUILDINGS[type];
  if (!def || type === 'keep') return { ok: false, reason: 'Это здание нельзя поставить' };
  const keep = playerKeep(state, playerId);
  const level = keep?.level ?? 0;
  if (def.keepLevel > level) return { ok: false, reason: `Нужен уровень главного здания ${def.keepLevel}` };
  if (!canAfford(player.stocks, def.cost)) return { ok: false, reason: 'Не хватает ресурсов' };
  if (x < 0 || y < 0 || x + def.w > state.mapW || y + def.h > state.mapH) return { ok: false, reason: 'За краем карты' };

  const px = x + def.w / 2;
  const py = y + def.h / 2;
  let nearOwn = false;
  for (const building of state.buildings) {
    if (building.playerId !== playerId || !building.complete || building.hp <= 0) continue;
    const center = buildingCenter(building);
    if (Math.hypot(center.x - px, center.y - py) <= BUILD_RADIUS) nearOwn = true;
  }
  for (const building of state.buildings) {
    if (building.type !== 'keep' || building.playerId === playerId || building.hp <= 0) continue;
    const center = buildingCenter(building);
    if (Math.hypot(center.x - px, center.y - py) < ENEMY_KEEP_GAP) {
      return { ok: false, reason: 'Слишком близко к чужому поселению' };
    }
  }
  if (!nearOwn) return { ok: false, reason: 'Слишком далеко от ваших построек' };

  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const other = BUILDINGS[building.type];
    if (rectsOverlap(x, y, def.w, def.h, building.x, building.y, other.w, other.h)) {
      return { ok: false, reason: 'Место занято' };
    }
  }

  for (let ty = y; ty < y + def.h; ty++) {
    for (let tx = x; tx < x + def.w; tx++) {
      const terrain = terrainAt(state, tx, ty);
      if (terrain === Terrain.Road) return { ok: false, reason: 'Нельзя строить на тракте' };
      if (def.terrain) {
        if (!def.terrain.some((tile) => tile === terrain)) return { ok: false, reason: 'Неподходящая земля' };
      } else if (!isOrdinary(terrain)) {
        return { ok: false, reason: 'Неподходящая земля' };
      }
    }
  }

  if (def.nearTerrain != null) {
    const cx = x + def.w / 2;
    const cy = y + def.h / 2;
    if (!nearestTerrainTile(state, cx, cy, def.nearTerrain, workRange(def))) {
      return { ok: false, reason: def.nearHint || 'Неподходящее место' };
    }
  }

  if (def.needsDeer) {
    const deer = state.mobs.some((mob) => mob.kind === 'deer' && Math.hypot(mob.homeX - px, mob.homeY - py) <= 14);
    if (!deer) return { ok: false, reason: 'Поблизости нет оленей' };
  }

  if (type === 'oil') {
    const beside = state.buildings.some((building) => {
      if (building.playerId !== playerId || !building.complete || building.hp <= 0) return false;
      if (building.type !== 'woodtower' && building.type !== 'stonetower') return false;
      const other = BUILDINGS[building.type];
      const xOverlap = x < building.x + other.w && x + def.w > building.x;
      const yOverlap = y < building.y + other.h && y + def.h > building.y;
      const xAdj = x + def.w === building.x || building.x + other.w === x;
      const yAdj = y + def.h === building.y || building.y + other.h === y;
      return (xAdj && yOverlap) || (yAdj && xOverlap);
    });
    if (!beside) return { ok: false, reason: 'Котёл ставят у башни' };
  }

  return { ok: true, reason: '' };
}

export function suggestedTile(state: GameState, playerId: number, type: BuildingType): { x: number; y: number } | null {
  const keep = playerKeep(state, playerId);
  const originX = keep ? keep.x : state.players[playerId].spawnX;
  const originY = keep ? keep.y : state.players[playerId].spawnY;
  for (let r = 0; r <= 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = originX + dx;
        const y = originY + dy;
        if (canPlace(state, playerId, type, x, y).ok) return { x, y };
      }
    }
  }
  return null;
}

function releasePerson(state: GameState, person: Person) {
  if (person.task.type === 'work' || person.task.type === 'build') {
    const building = buildingById(state, person.task.buildingId);
    if (building) building.workerIds = building.workerIds.filter((id) => id !== person.id);
  }
  if (person.cargo) {
    state.players[person.playerId].stocks[person.cargo] += person.cargoQty;
    person.cargo = null;
    person.cargoQty = 0;
  }
  person.destBuildingId = 0;
  person.task = { type: 'idle' };
  person.idlePhase = 1;
  person.flee = false;
}

function countType(state: GameState, playerId: number, type: BuildingType): number {
  return state.buildings.filter((b) => b.playerId === playerId && b.type === type && b.hp > 0).length;
}

export function applyCommand(state: GameState, command: Command): boolean {
  const player = state.players[command.playerId];
  if (!player || !player.alive) {
    state.message = 'Поселение пало';
    return false;
  }

  if (command.kind === 'place') {
    const check = canPlace(state, command.playerId, command.building, command.x, command.y);
    if (!check.ok) {
      state.message = check.reason;
      return false;
    }
    pay(player.stocks, BUILDINGS[command.building].cost);
    const building = {
      id: state.nextId++,
      playerId: command.playerId,
      type: command.building,
      x: command.x,
      y: command.y,
      complete: false,
      buildProgress: 0,
      workerIds: [] as number[],
      level: 1,
      hp: BUILDINGS[command.building].hp,
      maxHp: BUILDINGS[command.building].hp,
      buffer: 0,
      bufferRes: null,
      input: 0,
      inputRes: null,
      work: 0,
      plague: 0,
      upgrading: false,
      seal: 0,
    };
    state.buildings.push(building);
    state.message = `Строим: ${BUILDINGS[command.building].name}`;
    return true;
  }

  if (command.kind === 'assign') {
    const building = buildingById(state, command.buildingId);
    if (!building || building.playerId !== command.playerId || building.hp <= 0) {
      state.message = 'Нет такой постройки';
      return false;
    }
    const def = BUILDINGS[building.type];
    if (!building.complete) {
      state.message = 'Сначала достройте';
      return false;
    }
    if (command.delta < 0) {
      const workerId = building.workerIds[building.workerIds.length - 1];
      const worker = state.people.find((p) => p.id === workerId);
      if (!worker) {
        state.message = 'Здесь некого снять';
        return false;
      }
      releasePerson(state, worker);
      state.message = 'Человек свободен';
      return true;
    }
    if (def.workers <= 0) {
      state.message = 'Здесь не нужны работники';
      return false;
    }
    if (building.workerIds.length >= def.workers) {
      state.message = 'Все места заняты';
      return false;
    }
    const idle = state.people.find((p) => p.playerId === command.playerId && p.hp > 0 && p.task.type === 'idle');
    if (!idle) {
      state.message = 'Нет свободных людей';
      note(state, 'нет свободных людей');
      return false;
    }
    idle.task = { type: 'work', buildingId: building.id, mode: 'goto', targetId: 0 };
    idle.flee = false;
    building.workerIds.push(idle.id);
    state.message = `${def.name}: человек назначен`;
    return true;
  }

  if (command.kind === 'ration') {
    player.ration = command.ration;
    state.message = 'Паёк изменён';
    return true;
  }

  if (command.kind === 'tax') {
    player.tax = command.tax;
    state.message = 'Налог изменён';
    return true;
  }

  if (command.kind === 'upgrade') {
    const keep = buildingById(state, command.buildingId);
    if (!keep || keep.type !== 'keep' || keep.playerId !== command.playerId || keep.hp <= 0) {
      state.message = 'Нечего улучшать';
      return false;
    }
    if (keep.level >= 5) {
      state.message = 'Главное здание уже максимального уровня';
      return false;
    }
    if (keep.upgrading) {
      state.message = 'Улучшение уже идёт';
      return false;
    }
    const cost = KEEP_UPGRADE_COST[keep.level];
    if (!cost || !canAfford(player.stocks, cost)) {
      state.message = 'Не хватает ресурсов на улучшение';
      return false;
    }
    pay(player.stocks, cost);
    keep.upgrading = true;
    keep.buildProgress = 0;
    state.message = 'Улучшаем главное здание';
    return true;
  }

  if (command.kind === 'market') {
    const market = state.buildings.find(
      (b) => b.playerId === command.playerId && b.type === 'market' && b.complete && b.hp > 0 && b.workerIds.length > 0,
    );
    if (!market) {
      state.message = 'Нужен рынок с торговцем';
      return false;
    }
    const qty = Math.max(1, Math.min(20, Math.floor(command.qty)));
    const price = command.mode === 'buy' ? PRICES[command.resource].buy : PRICES[command.resource].sell;
    if (command.mode === 'buy') {
      const cost = price * qty;
      if (player.gold < cost) {
        state.message = 'Не хватает золота';
        return false;
      }
      player.gold -= cost;
      player.stocks[command.resource] += qty;
      state.message = `Куплено: ${qty}`;
      return true;
    }
    if (player.stocks[command.resource] < qty) {
      state.message = 'Нечего продать';
      return false;
    }
    player.stocks[command.resource] -= qty;
    player.gold += price * qty;
    state.message = `Продано: ${qty}`;
    return true;
  }

  if (command.kind === 'train') {
    const hall = trainHall(command.weapon);
    const yard = state.buildings.find((b) => b.playerId === command.playerId && b.type === hall && b.complete && b.hp > 0);
    if (!yard) {
      state.message = hall === 'guild' ? 'Сначала постройте гильдию инженеров' : 'Сначала постройте казарму';
      return false;
    }
    const cost = TRAIN_COST[command.weapon];
    if (!canAfford(player.stocks, cost)) {
      state.message = 'Не хватает ресурсов на отряд';
      return false;
    }
    const idle = state.people.find((p) => p.playerId === command.playerId && p.hp > 0 && p.task.type === 'idle');
    if (!idle) {
      state.message = 'Нет свободных людей';
      note(state, 'нет свободных людей');
      return false;
    }
    pay(player.stocks, cost);
    const center = buildingCenter(yard);
    createSoldier(state, command.playerId, center.x, center.y + 1, command.weapon);
    state.people = state.people.filter((p) => p.id !== idle.id);
    const trained: Record<string, string> = {
      club: 'Обучен ополченец',
      sword: 'Обучен мечник',
      bow: 'Обучен лучник',
      engineer: 'Обучен инженер',
      ladder: 'Обучен лестничник',
      ram: 'Собран таран',
      catapult: 'Собрана катапульта',
    };
    state.message = trained[command.weapon] ?? 'Отряд готов';
    return true;
  }

  if (command.kind === 'cow') {
    const dairy = state.buildings.some((b) => b.playerId === command.playerId && b.type === 'dairy' && b.complete && b.hp > 0);
    const catapult = state.soldiers.find(
      (s) => s.id === command.soldierId && s.playerId === command.playerId && s.hp > 0 && s.weapon === 'catapult',
    );
    if (!dairy || !catapult) {
      state.message = 'Нужны ферма и катапульта';
      return false;
    }
    spawnCloud(state, command.playerId, command.x, command.y);
    state.message = 'Катапульта метнула больную корову';
    return true;
  }

  if (command.kind === 'order') {
    const keep = nearestEnemyKeep(state, command.playerId, player.spawnX, player.spawnY);
    for (const soldier of state.soldiers) {
      if (soldier.playerId !== command.playerId || soldier.hp <= 0) continue;
      soldier.order = command.order;
      soldier.raidTargetId = command.order === 'raid' && keep ? keep.id : 0;
      soldier.waypoints = [];
      soldier.waypointI = 0;
      soldier.targetKind = 'none';
      soldier.targetId = 0;
    }
    state.message = command.order === 'raid' ? 'Солдаты идут в набег' : 'Солдаты обороняют посад';
    return true;
  }

  if (command.kind === 'army') {
    const squad = command.ids
      .map((id) => state.soldiers.find((s) => s.id === id && s.playerId === command.playerId && s.hp > 0))
      .filter((s): s is Soldier => !!s)
      .sort((a, b) => a.id - b.id);
    if (!squad.length) {
      state.message = 'Нет выбранных солдат';
      return false;
    }
    if (command.mode === 'hold') {
      for (const soldier of squad) {
        soldier.order = 'hold';
        soldier.anchorX = soldier.x;
        soldier.anchorY = soldier.y;
        soldier.waypoints = [];
        soldier.waypointI = 0;
        soldier.targetKind = 'none';
        soldier.targetId = 0;
      }
      state.message = 'Войско стоит';
      return true;
    }
    if (command.mode === 'attack') {
      for (const soldier of squad) {
        soldier.order = 'attack';
        soldier.targetKind = command.target === 'none' ? 'mob' : command.target;
        soldier.targetId = command.targetId;
        soldier.destX = command.x;
        soldier.destY = command.y;
        soldier.waypoints = [];
        soldier.waypointI = 0;
      }
      state.message = 'Войско атакует';
      return true;
    }
    const keep = playerKeep(state, command.playerId);
    const home = keep ? buildingCenter(keep) : { x: command.x, y: command.y };
    const goal = command.mode === 'home' ? { x: home.x, y: home.y + 1.6 } : { x: command.x, y: command.y };
    const spots = formationPoints(squad.length, goal.x, goal.y);
    squad.forEach((soldier, index) => {
      const spot = spots[index];
      soldier.order = command.mode === 'home' ? 'home' : command.mode;
      soldier.destX = spot.x;
      soldier.destY = spot.y;
      soldier.anchorX = spot.x;
      soldier.anchorY = spot.y;
      soldier.targetKind = 'none';
      soldier.targetId = 0;
      const path = findPath(state, soldier.x, soldier.y, spot.x, spot.y, {
        blocked: (x, y) => routeBlocked(state, x, y, soldier.playerId, moverOf(soldier)),
      });
      soldier.waypoints = [];
      for (const step of path) soldier.waypoints.push(step.x, step.y);
      soldier.waypointI = 0;
    });
    state.message = command.mode === 'attackmove' ? 'Атака области' : command.mode === 'home' ? 'Войско возвращается' : 'Войско идёт';
    return true;
  }

  if (command.kind === 'demolish') {
    const building = buildingById(state, command.buildingId);
    if (!building || building.playerId !== command.playerId || building.type === 'keep') {
      state.message = 'Нельзя снести';
      return false;
    }
    const ratio = building.complete ? 0.5 : 1;
    refund(player.stocks, BUILDINGS[building.type].cost, ratio);
    if (building.upgrading) refund(player.stocks, KEEP_UPGRADE_COST[building.level] ?? {}, 1);
    for (const person of state.people) {
      if (person.task.type !== 'idle' && person.task.buildingId === building.id) releasePerson(state, person);
    }
    state.oxen = state.oxen.filter((ox) => ox.buildingId !== building.id);
    state.buildings = state.buildings.filter((b) => b.id !== building.id);
    state.message = 'Постройка снесена';
    return true;
  }

  return false;
}

function planAi(state: GameState) {
  if (state.tick % AI_EVERY !== 0) return;
  for (const player of state.players) {
    if (!player.isAi || !player.alive) continue;
    const command = nextAiCommand(state, player);
    if (command) applyCommand(state, command);
  }
}

function nextAiCommand(state: GameState, player: Player): Command | null {
  const id = player.id;
  const place = (type: BuildingType): Command | null => {
    const tile = suggestedTile(state, id, type);
    if (!tile) return null;
    return { kind: 'place', playerId: id, building: type, x: tile.x, y: tile.y };
  };
  const missing = (type: BuildingType) => countType(state, id, type) === 0;

  if (missing('stockpile')) return place('stockpile');
  if (missing('granary')) return place('granary');
  if (missing('woodcutter')) return place('woodcutter');

  const staff = state.buildings.find((b) => {
    if (b.playerId !== id || !b.complete || b.hp <= 0) return false;
    const workers = BUILDINGS[b.type].workers;
    return workers > 0 && b.workerIds.length < workers && idleCount(state, id) > 0;
  });
  if (staff) return { kind: 'assign', playerId: id, buildingId: staff.id, delta: 1 };

  if (missing('orchard')) return place('orchard');

  const cap = housingCap(state, id);
  const people = state.people.filter((p) => p.playerId === id && p.hp > 0).length;
  if (cap - people < 2) {
    const housing: BuildingType[] = ['highrise', 'khrush', 'house', 'cabin', 'shack'];
    for (const type of housing) {
      const tile = suggestedTile(state, id, type);
      if (tile) return { kind: 'place', playerId: id, building: type, x: tile.x, y: tile.y };
    }
  }

  if (missing('hunter')) return place('hunter');

  const food = totalFood(player.stocks);
  const types = foodTypesIn(player.stocks);
  let ration: Ration = 'half';
  if (!player.hunger && types >= 2 && food > 50) ration = 'double';
  else if (!player.hunger && food > 18) ration = 'normal';
  if (ration !== player.ration) return { kind: 'ration', playerId: id, ration };

  let tax: TaxId = 'low';
  if (player.popularity >= 25) tax = 'high';
  else if (player.popularity >= 12) tax = 'normal';
  else if (player.popularity < 0) tax = 'none';
  if (tax !== player.tax) return { kind: 'tax', playerId: id, tax };

  if (missing('quarry')) return place('quarry');
  if (missing('wheat')) return place('wheat');

  const keep = playerKeep(state, id);
  if (keep && !keep.upgrading && keep.level < 5) {
    const cost = KEEP_UPGRADE_COST[keep.level];
    if (cost && canAfford(player.stocks, cost)) return { kind: 'upgrade', playerId: id, buildingId: keep.id };
  }

  const later: BuildingType[] = ['mill', 'hop', 'dairy', 'brewery', 'bakery', 'tavern', 'market', 'mine', 'pitch', 'barracks'];
  for (const type of later) {
    if (missing(type)) {
      const cmd = place(type);
      if (cmd) return cmd;
    }
  }

  const barracks = state.buildings.find((b) => b.playerId === id && b.type === 'barracks' && b.complete && b.hp > 0);
  const soldiers = state.soldiers.filter((s) => s.playerId === id && s.hp > 0).length;
  if (barracks && soldiers < 3 && idleCount(state, id) >= 2 && canAfford(player.stocks, CLUB_COST)) {
    return { kind: 'train', playerId: id, weapon: 'club' };
  }
  const siege = nextAiSiege(state, player, canPlace, canAfford, idleCount(state, id));
  if (siege) return siege;
  if (state.tick > 0 && state.tick % 800 === 0 && soldiers >= 2) {
    return { kind: 'order', playerId: id, order: 'raid' };
  }
  return null;
}

function nearestIdle(state: GameState, building: Building): Person | null {
  const center = buildingCenter(building);
  let best: Person | null = null;
  let bestD = 1e9;
  for (const person of state.people) {
    if (person.playerId !== building.playerId || person.hp <= 0 || person.task.type !== 'idle') continue;
    const d = Math.hypot(person.x - center.x, person.y - center.y);
    if (!best || d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && person.id < best.id)) {
      best = person;
      bestD = d;
    }
  }
  return best;
}

function needsBuilder(building: Building): boolean {
  return building.hp > 0 && (!building.complete || building.upgrading);
}

function assignBuilders(state: GameState) {
  const sites = state.buildings.filter(needsBuilder).sort((a, b) => a.id - b.id);
  for (const site of sites) {
    const have = state.people.filter(
      (p) => p.hp > 0 && p.task.type === 'build' && p.task.buildingId === site.id,
    ).length;
    if (have >= 1) continue;
    const idle = nearestIdle(state, site);
    if (!idle) continue;
    idle.task = { type: 'build', buildingId: site.id };
    idle.flee = false;
  }
}

function updatePeople(state: GameState) {
  assignBuilders(state);
  for (const person of state.people) {
    if (person.hp <= 0) continue;
    const threat = nearestMob(state, person.x, person.y, person.flee ? 3.3 : 2.15, false);
    if (person.flee) {
      const keep = playerKeep(state, person.playerId);
      if (keep) {
        const center = buildingCenter(keep);
        walkPerson(state, person, center.x, center.y + 1.5, PERSON_SPEED * 1.15);
      }
      if (!threat) person.flee = false;
      continue;
    }
    if (threat && person.task.type !== 'idle') {
      person.flee = true;
      continue;
    }
    if (person.task.type === 'idle') updateIdle(state, person);
    else if (person.task.type === 'build') updateBuilder(state, person);
    else updateWorker(state, person);
  }
}

function updateIdle(state: GameState, person: Person) {
  const keep = playerKeep(state, person.playerId);
  if (!keep) return;
  const center = buildingCenter(keep);
  person.idlePhase -= 1;
  if (person.idlePhase <= 0) {
    person.destX = center.x + (takeRng(state) - 0.5) * 2.6;
    person.destY = center.y + 1.6 + (takeRng(state) - 0.5) * 1.1;
    person.idlePhase = 28 + Math.floor(takeRng(state) * 36);
  }
  walkPerson(state, person, person.destX, person.destY, PERSON_SPEED * 0.55);
}

function updateBuilder(state: GameState, person: Person) {
  if (person.task.type !== 'build') return;
  const building = buildingById(state, person.task.buildingId);
  if (!building || !needsBuilder(building)) {
    person.task = { type: 'idle' };
    person.idlePhase = 1;
    return;
  }
  const center = buildingCenter(building);
  if (!walkPerson(state, person, center.x, center.y, PERSON_SPEED)) return;
  building.buildProgress += 1;
  const need = building.upgrading ? KEEP_UPGRADE_TICKS : BUILDINGS[building.type].buildTicks;
  if (building.buildProgress < need) return;
  building.buildProgress = 0;
  if (building.upgrading) {
    building.level += 1;
    building.upgrading = false;
    building.maxHp += 90;
    building.hp = building.maxHp;
    pushLog(state, `${state.players[building.playerId].name}: главное здание улучшено`);
  } else {
    building.complete = true;
    building.hp = building.maxHp;
    pushLog(state, `Готово: ${BUILDINGS[building.type].name}`);
  }
  person.task = { type: 'idle' };
  person.idlePhase = 1;
}

interface Dropoff {
  buildingId: number;
  x: number;
  y: number;
}

function nearestOf(
  state: GameState,
  playerId: number,
  types: BuildingType[],
  x: number,
  y: number,
  inputCap: number,
): Building | null {
  let best: Building | null = null;
  let bestD = 1e9;
  for (const building of state.buildings) {
    if (building.playerId !== playerId || !building.complete || building.hp <= 0) continue;
    if (!types.includes(building.type)) continue;
    if (inputCap < 900 && building.input >= inputCap) continue;
    const center = buildingCenter(building);
    const d = Math.hypot(center.x - x, center.y - y);
    if (d < bestD) {
      best = building;
      bestD = d;
    }
  }
  return best;
}

function chooseDropoff(state: GameState, playerId: number, res: Resource, x: number, y: number): Dropoff | null {
  const prefer =
    res === 'wheat'
      ? { types: ['mill'] as BuildingType[], cap: 4 }
      : res === 'flour'
        ? { types: ['bakery'] as BuildingType[], cap: 4 }
        : res === 'hops'
          ? { types: ['brewery'] as BuildingType[], cap: 4 }
          : res === 'beer'
            ? { types: ['tavern'] as BuildingType[], cap: 4 }
            : null;
  if (prefer) {
    const target = nearestOf(state, playerId, prefer.types, x, y, prefer.cap);
    if (target) {
      const center = buildingCenter(target);
      return { buildingId: target.id, x: center.x, y: center.y };
    }
  }
  const storage: BuildingType = (FOODS as readonly string[]).includes(res) ? 'granary' : 'stockpile';
  const store = nearestOf(state, playerId, [storage], x, y, 999);
  if (!store) return null;
  const center = buildingCenter(store);
  return { buildingId: store.id, x: center.x, y: center.y };
}

function giveCargo(state: GameState, playerId: number, buildingId: number, res: Resource, qty: number) {
  const building = buildingById(state, buildingId);
  if (!building || isStorage(building.type)) {
    state.players[playerId].stocks[res] += qty;
    return;
  }
  building.input += qty;
  building.inputRes = res;
}

function producersOf(resource: Resource): BuildingType[] {
  if (resource === 'wheat') return ['wheat'];
  if (resource === 'flour') return ['mill'];
  if (resource === 'hops') return ['hop'];
  if (resource === 'beer') return ['brewery'];
  return [];
}

function findInputSource(state: GameState, playerId: number, building: Building, need: Resource): number | null {
  const here = buildingCenter(building);
  let best: Building | null = null;
  let bestD = 1e9;
  for (const other of state.buildings) {
    if (other.playerId !== playerId || !other.complete || other.hp <= 0) continue;
    if (!producersOf(need).includes(other.type)) continue;
    if (other.buffer <= 0 || other.bufferRes !== need) continue;
    const center = buildingCenter(other);
    const d = Math.hypot(center.x - here.x, center.y - here.y);
    if (d < bestD) {
      best = other;
      bestD = d;
    }
  }
  if (best) return best.id;
  if (state.players[playerId].stocks[need] > 0) {
    const store = nearestOf(state, playerId, ['stockpile'], here.x, here.y, 999);
    if (store) return store.id;
  }
  return null;
}

function ruRes(res: Resource): string {
  const name = RESOURCE_NAME[res];
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Circle around the footprint centre. The placement ghost draws this same radius. */
export function workRange(def: { w: number; h: number; nearRadius: number }): number {
  return def.nearRadius + Math.max(def.w, def.h) / 2;
}

function nearestTerrainTile(
  state: GameState,
  x: number,
  y: number,
  terrain: number,
  radius: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = radius + 0.05;
  const x0 = Math.max(0, Math.floor(x - radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const x1 = Math.min(state.mapW - 1, Math.ceil(x + radius));
  const y1 = Math.min(state.mapH - 1, Math.ceil(y + radius));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (terrainAt(state, tx, ty) !== terrain) continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d <= bestD) {
        best = { x: tx, y: ty };
        bestD = d;
      }
    }
  }
  return best;
}

function insideBuilding(person: Person, building: Building): boolean {
  const def = BUILDINGS[building.type];
  return (
    person.x >= building.x - 0.2 &&
    person.x <= building.x + def.w + 0.2 &&
    person.y >= building.y - 0.2 &&
    person.y <= building.y + def.h + 0.2
  );
}

/** Where the worker should stand so the job is visible: among the trees, at the rock, or beside the deer. */
export function laborSpot(state: GameState, building: Building): { x: number; y: number } {
  const def = BUILDINGS[building.type];
  const porch = { x: building.x + def.w / 2, y: building.y + def.h - 0.45 };
  if (building.type === 'orchard' || building.type === 'wheat' || building.type === 'hop' || building.type === 'dairy') {
    const cols = Math.max(1, def.w - 1);
    const rows = Math.max(1, def.h - 1);
    const col = Math.floor(state.tick / 36) % cols;
    const row = Math.floor(state.tick / 72) % rows;
    return {
      x: building.x + 0.65 + (col * (def.w - 1.1)) / cols,
      y: building.y + 0.7 + (row * (def.h - 1.2)) / rows,
    };
  }
  if (building.type === 'woodcutter') {
    const tree = nearestTerrainTile(state, porch.x, porch.y, Terrain.Forest, workRange(def));
    if (tree) return { x: tree.x + 0.5, y: tree.y + 0.5 };
    return porch;
  }
  if (building.type === 'hunter') {
    const deer = nearestDeer(state, porch.x, porch.y, 12);
    if (deer) return { x: deer.x, y: deer.y };
    return porch;
  }
  if (building.type === 'quarry' || building.type === 'mine' || building.type === 'pitch') {
    const terrain = building.type === 'quarry' ? Terrain.Limestone : building.type === 'mine' ? Terrain.Iron : Terrain.Swamp;
    const node = nearestTerrainTile(state, porch.x, porch.y, terrain, 2.8);
    if (node) return { x: node.x + 0.5, y: node.y + 0.5 };
    return porch;
  }
  return porch;
}

export function stallReason(state: GameState, building: Building): string | null {
  const def = BUILDINGS[building.type];
  const porch = { x: building.x + def.w / 2, y: building.y + def.h / 2 };
  if (building.type === 'woodcutter' && !nearestTerrainTile(state, porch.x, porch.y, Terrain.Forest, workRange(def))) {
    return 'ждёт: нет леса рядом';
  }
  if (building.type === 'hunter' && !nearestDeer(state, porch.x, porch.y, 12)) return 'ждёт: нет оленей рядом';
  if (building.type === 'quarry' && !nearestTerrainTile(state, porch.x, porch.y, Terrain.Limestone, 2.8)) return 'ждёт: нет камня рядом';
  if (building.type === 'mine' && !nearestTerrainTile(state, porch.x, porch.y, Terrain.Iron, 2.8)) return 'ждёт: нет железа рядом';
  if (building.type === 'pitch' && !nearestTerrainTile(state, porch.x, porch.y, Terrain.Swamp, 2.8)) return 'ждёт: нет болота рядом';
  if (def.output && (def.hauler === 'person' || def.hauler === 'ox')) {
    const drop = chooseDropoff(state, building.playerId, def.output, porch.x, porch.y);
    if (!drop) return (FOODS as readonly string[]).includes(def.output) ? 'ждёт: нет амбара' : 'ждёт: нет склада';
  }
  return null;
}

export function workerStatus(state: GameState, person: Person): string {
  if (person.hp <= 0) return 'не может работать';
  if (person.task.type === 'idle') return 'без дела';
  if (person.task.type === 'build') {
    const site = buildingById(state, person.task.buildingId);
    return site ? `строит: ${BUILDINGS[site.type].name}` : 'строит';
  }
  const building = buildingById(state, person.task.buildingId);
  if (!building) return 'идёт на работу';
  const task = person.task;
  if (task.mode === 'goto') return 'идёт на работу';
  if (task.mode === 'fetch') return 'идёт за сырьём';
  if (task.mode === 'return') return `несёт ${person.cargo ? ruRes(person.cargo) : 'груз'} на работу`;
  if (task.mode === 'deliver') {
    if (!person.cargo) return 'идёт на работу';
    const food = (FOODS as readonly string[]).includes(person.cargo);
    const dest = person.destBuildingId ? buildingById(state, person.destBuildingId) : undefined;
    if (!dest && person.destBuildingId === 0) {
      const drop = chooseDropoff(state, person.playerId, person.cargo, person.x, person.y);
      if (!drop) return food ? 'ждёт: нет амбара' : 'ждёт: нет склада';
    }
    const where = !dest
      ? food
        ? 'амбар'
        : 'склад'
      : dest.type === 'granary'
        ? 'амбар'
        : dest.type === 'stockpile'
          ? 'склад'
          : BUILDINGS[dest.type].name;
    return `несёт ${ruRes(person.cargo)} в ${where}`;
  }
  const stall = stallReason(state, building);
  if (stall) return stall;
  if (building.type === 'hunter') {
    const deer = nearestDeer(state, person.x, person.y, 12);
    if (deer && Math.hypot(person.x - deer.x, person.y - deer.y) > 0.7) return 'идёт за оленем';
  }
  if (building.type === 'woodcutter') {
    const tree = nearestTerrainTile(state, person.x, person.y, Terrain.Forest, 1.2);
    if (!tree) return 'идёт к лесу';
  }
  return 'работает';
}

export function buildingWarning(state: GameState, building: Building): string | null {
  if (!building.complete || building.hp <= 0) return null;
  if (building.seal === 1) return 'стена отрезала путь';
  for (const id of building.workerIds) {
    const person = state.people.find((p) => p.id === id && p.hp > 0);
    if (!person || person.task.type !== 'work') continue;
    const status = workerStatus(state, person);
    if (status.startsWith('ждёт')) return status;
  }
  const def = BUILDINGS[building.type];
  if (def.workers > 0 && building.workerIds.length < def.workers && idleCount(state, building.playerId) === 0) {
    return 'нет свободных людей';
  }
  return null;
}

function updateWorker(state: GameState, person: Person) {
  if (person.task.type !== 'work') return;
  const building = buildingById(state, person.task.buildingId);
  if (!building || !building.complete || building.hp <= 0) {
    releasePerson(state, person);
    return;
  }
  const def = BUILDINGS[building.type];
  const center = buildingCenter(building);
  const task = person.task;
  const spot = laborSpot(state, building);

  if (task.mode === 'goto') {
    if (!walkPerson(state, person, spot.x, spot.y, PERSON_SPEED)) return;
    task.mode = 'labor';
  }
  if (task.mode === 'fetch') {
    const src = buildingById(state, task.targetId);
    if (!src || src.hp <= 0 || !def.input) {
      task.mode = 'labor';
      return;
    }
    const srcCenter = buildingCenter(src);
    if (!walkPerson(state, person, srcCenter.x, srcCenter.y, PERSON_SPEED)) return;
    const need = def.input;
    if (isStorage(src.type)) {
      const player = state.players[person.playerId];
      if (player.stocks[need] > 0) {
        player.stocks[need] -= 1;
        person.cargo = need;
        person.cargoQty = 1;
        task.mode = 'return';
      } else task.mode = 'labor';
    } else if (src.buffer > 0 && src.bufferRes === need) {
      src.buffer -= 1;
      if (src.buffer <= 0) src.bufferRes = null;
      person.cargo = need;
      person.cargoQty = 1;
      task.mode = 'return';
    } else task.mode = 'labor';
    return;
  }
  if (task.mode === 'return') {
    if (!walkPerson(state, person, center.x, center.y, PERSON_SPEED)) return;
    if (person.cargo) {
      building.input += person.cargoQty;
      building.inputRes = person.cargo;
      person.cargo = null;
      person.cargoQty = 0;
    }
    task.mode = 'labor';
    return;
  }
  if (task.mode === 'deliver') {
    if (!person.cargo) {
      task.mode = 'goto';
      return;
    }
    if (person.destBuildingId === 0) {
      const drop = chooseDropoff(state, person.playerId, person.cargo, person.x, person.y);
      if (!drop) {
        const waiting = (FOODS as readonly string[]).includes(person.cargo) ? 'ждёт: нет амбара' : 'ждёт: нет склада';
        building.buffer += person.cargoQty;
        building.bufferRes = person.cargo;
        person.cargo = null;
        person.cargoQty = 0;
        task.mode = 'labor';
        note(state, `${def.name}: ${waiting}`);
        return;
      }
      person.destX = drop.x;
      person.destY = drop.y;
      person.destBuildingId = drop.buildingId;
    }
    if (!walkPerson(state, person, person.destX, person.destY, PERSON_SPEED)) return;
    giveCargo(state, person.playerId, person.destBuildingId, person.cargo, person.cargoQty);
    person.cargo = null;
    person.cargoQty = 0;
    person.destBuildingId = 0;
    task.mode = 'goto';
    return;
  }

  const stall = stallReason(state, building);
  if (stall) {
    note(state, `${def.name}: ${stall}`);
    if (Math.hypot(person.x - spot.x, person.y - spot.y) > 0.4) walkPerson(state, person, spot.x, spot.y, PERSON_SPEED);
    return;
  }

  if (def.hauler === 'person' && building.buffer > 0 && building.bufferRes) {
    const load = Math.min(building.buffer, Math.max(1, def.carry));
    person.cargo = building.bufferRes;
    person.cargoQty = load;
    building.buffer -= load;
    if (building.buffer <= 0) {
      building.buffer = 0;
      building.bufferRes = null;
    }
    person.destBuildingId = 0;
    task.mode = 'deliver';
    return;
  }

  if (def.input && building.input <= 0) {
    const srcId = findInputSource(state, person.playerId, building, def.input);
    if (srcId) {
      task.mode = 'fetch';
      task.targetId = srcId;
    }
    return;
  }

  const dist = Math.hypot(person.x - spot.x, person.y - spot.y);
  if (dist > 0.42) {
    walkPerson(state, person, spot.x, spot.y, PERSON_SPEED);
    if (!insideBuilding(person, building)) return;
  }

  if (building.plague > 0) {
    building.plague -= 1;
    return;
  }
  if (def.cycle <= 0) return;
  if (building.type === 'hunter' && !nearestDeer(state, center.x, center.y, 12)) return;

  const cap = def.hauler === 'ox' ? OX_BUFFER_CAP : BUFFER_CAP;
  if (def.output && building.buffer >= cap) return;

  building.work += 1;
  if (building.work < def.cycle) return;
  building.work = 0;
  if (def.input) {
    if (building.input <= 0) return;
    building.input -= 1;
    if (building.input <= 0) building.inputRes = null;
  }
  if (building.type === 'dairy' && takeRng(state) < PLAGUE_CHANCE) {
    building.plague = PLAGUE_TICKS;
    pushLog(state, 'Чума на молочной ферме');
    return;
  }
  if (building.type === 'hunter') {
    const deer = nearestDeer(state, center.x, center.y, 12);
    if (!deer) return;
    deer.hp -= 4;
    if (deer.hp <= 0) {
      deer.alive = false;
      deer.respawn = state.tick + 320;
    }
  }
  if (building.type === 'tavern') {
    state.players[person.playerId].beerMood = 240;
    return;
  }
  if (def.output) {
    building.buffer += def.outputQty;
    building.bufferRes = def.output;
  }
}

function updateOxen(state: GameState) {
  for (const building of state.buildings) {
    if (!building.complete || building.hp <= 0) continue;
    if (building.type !== 'quarry' && building.type !== 'mine') continue;
    if (state.oxen.some((ox) => ox.buildingId === building.id)) continue;
    const center = buildingCenter(building);
    createOx(state, building.playerId, building.id, center.x, center.y);
  }
  for (const ox of state.oxen) {
    const building = buildingById(state, ox.buildingId);
    if (!building || building.hp <= 0) continue;
    const center = buildingCenter(building);
    if (ox.mode === 'load') {
      if (!walkOx(state, ox, center.x + 0.6, center.y, OX_SPEED)) continue;
      if (building.buffer > 0 && building.bufferRes) {
        const amount = Math.min(OX_CARRY, building.buffer);
        ox.cargo = building.bufferRes;
        ox.cargoQty = amount;
        building.buffer -= amount;
        if (building.buffer <= 0) building.bufferRes = null;
        ox.mode = 'deliver';
        ox.destBuildingId = 0;
      }
      continue;
    }
    if (!ox.cargo) {
      ox.mode = 'load';
      continue;
    }
    if (ox.destBuildingId === 0) {
      const drop = chooseDropoff(state, ox.playerId, ox.cargo, ox.x, ox.y);
      if (!drop) {
        building.buffer += ox.cargoQty;
        building.bufferRes = ox.cargo;
        ox.cargo = null;
        ox.cargoQty = 0;
        ox.mode = 'load';
        continue;
      }
      ox.destX = drop.x;
      ox.destY = drop.y;
      ox.destBuildingId = drop.buildingId;
    }
    if (!walkOx(state, ox, ox.destX, ox.destY, OX_SPEED)) continue;
    giveCargo(state, ox.playerId, ox.destBuildingId, ox.cargo, ox.cargoQty);
    ox.cargo = null;
    ox.cargoQty = 0;
    ox.destBuildingId = 0;
    ox.mode = 'load';
  }
  state.oxen = state.oxen.filter((ox) => {
    const building = buildingById(state, ox.buildingId);
    return !!building && building.hp > 0;
  });
}

function nearestDeer(state: GameState, x: number, y: number, range: number): Mob | null {
  let best: Mob | null = null;
  let bestD = range;
  for (const mob of state.mobs) {
    if (!mob.alive || mob.kind !== 'deer') continue;
    const d = Math.hypot(mob.x - x, mob.y - y);
    if (d <= bestD) {
      best = mob;
      bestD = d;
    }
  }
  return best;
}

function nearestMob(state: GameState, x: number, y: number, range: number, deer: boolean): Mob | null {
  let best: Mob | null = null;
  let bestD = range;
  for (const mob of state.mobs) {
    if (!mob.alive) continue;
    if (deer ? mob.kind !== 'deer' : mob.kind === 'deer') continue;
    const d = Math.hypot(mob.x - x, mob.y - y);
    if (d <= bestD) {
      best = mob;
      bestD = d;
    }
  }
  return best;
}

const MOB_SPEED: Record<Mob['kind'], number> = { wolf: 0.09, bear: 0.055, bandit: 0.08, deer: 0.07 };
const MOB_AGGRO: Record<Mob['kind'], number> = { wolf: 4.6, bear: 3.4, bandit: 5.4, deer: 0 };

function roam(state: GameState, mob: Mob, radius: number, speed: number) {
  mob.wander -= 1;
  if (mob.wander <= 0) {
    mob.destX = mob.homeX + (takeRng(state) - 0.5) * radius * 2;
    mob.destY = mob.homeY + (takeRng(state) - 0.5) * radius * 2;
    mob.wander = 24 + Math.floor(takeRng(state) * 48);
  }
  if (Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY) > radius + 1.2) {
    moveToward(mob, mob.homeX, mob.homeY, speed);
    return;
  }
  moveToward(mob, mob.destX, mob.destY, speed);
}

function nearestEnemyKeep(state: GameState, playerId: number, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestD = 1e9;
  for (const building of state.buildings) {
    if (building.type !== 'keep' || building.playerId === playerId || building.hp <= 0) continue;
    if (!state.players[building.playerId]?.alive) continue;
    const center = buildingCenter(building);
    const d = Math.hypot(center.x - x, center.y - y);
    if (d < bestD) {
      best = building;
      bestD = d;
    }
  }
  return best;
}

function destroyKeep(state: GameState, keep: Building) {
  if (keep.hp <= 0) return;
  keep.hp = 0;
  keep.complete = false;
  const player = state.players[keep.playerId];
  if (!player || !player.alive) return;
  player.alive = false;
  for (const person of state.people) if (person.playerId === player.id) person.hp = 0;
  for (const soldier of state.soldiers) if (soldier.playerId === player.id) soldier.hp = 0;
  pushLog(state, `${player.name} пал`);
}

function updateCombat(state: GameState) {
  for (const mob of state.mobs) {
    if (!mob.alive) {
      if (mob.respawn > 0 && state.tick >= mob.respawn) {
        mob.alive = true;
        mob.hp = mob.maxHp;
        mob.x = mob.homeX;
        mob.y = mob.homeY;
        mob.respawn = 0;
      }
      continue;
    }
    if (mob.kind === 'deer') {
      const scare = nearestPersonOrSoldier(state, mob.x, mob.y, 2.5);
      if (scare) {
        const dx = mob.x - scare.x;
        const dy = mob.y - scare.y;
        const d = Math.hypot(dx, dy) || 1;
        moveToward(mob, mob.homeX + (dx / d) * 2, mob.homeY + (dy / d) * 2, MOB_SPEED.deer);
      } else roam(state, mob, 2.2, MOB_SPEED.deer * 0.65);
      continue;
    }
    const victim = nearestPersonOrSoldier(state, mob.x, mob.y, MOB_AGGRO[mob.kind]);
    if (!victim) {
      roam(state, mob, 3.2, MOB_SPEED[mob.kind] * 0.55);
      continue;
    }
    const d = Math.hypot(victim.x - mob.x, victim.y - mob.y);
    if (d < 0.72) {
      if (state.tick % 15 === 0) {
        if (victim.person) {
          victim.person.hp -= mob.dmg;
          if (victim.person.hp <= 0) {
            releasePerson(state, victim.person);
            pushLog(state, 'Человека задрал зверь');
          }
        } else if (victim.soldier) {
          victim.soldier.hp -= mob.dmg;
        }
      }
    } else moveToward(mob, victim.x, victim.y, MOB_SPEED[mob.kind]);
  }

  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0) continue;
    updateSoldier(state, soldier);
  }
}

interface Actor {
  x: number;
  y: number;
  hp: number;
  person: Person | null;
  soldier: Soldier | null;
  mob: Mob | null;
}

function nearestPersonOrSoldier(state: GameState, x: number, y: number, range: number): (Actor & { hp: number }) | null {
  let best: Actor | null = null;
  let bestD = range;
  for (const person of state.people) {
    if (person.hp <= 0) continue;
    const d = Math.hypot(person.x - x, person.y - y);
    if (d <= bestD) {
      bestD = d;
      best = { x: person.x, y: person.y, hp: person.hp, person, soldier: null, mob: null };
    }
  }
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0) continue;
    const d = Math.hypot(soldier.x - x, soldier.y - y);
    if (d <= bestD) {
      bestD = d;
      best = { x: soldier.x, y: soldier.y, hp: soldier.hp, person: null, soldier, mob: null };
    }
  }
  return best;
}

interface Threat {
  kind: 'mob' | 'soldier' | 'building';
  id: number;
  x: number;
  y: number;
  d: number;
}

function rectDistance(x: number, y: number, bx: number, by: number, bw: number, bh: number): number {
  const cx = Math.max(bx, Math.min(bx + bw, x));
  const cy = Math.max(by, Math.min(by + bh, y));
  return Math.hypot(x - cx, y - cy);
}

function nearestThreat(state: GameState, x: number, y: number, range: number, playerId: number): Threat | null {
  let best: Threat | null = null;
  const consider = (threat: Threat) => {
    if (threat.d > range) return;
    if (!best || threat.d < best.d - 1e-9 || (Math.abs(threat.d - best.d) <= 1e-9 && threat.id < best.id)) best = threat;
  };
  for (const other of state.soldiers) {
    if (other.hp <= 0 || other.playerId === playerId) continue;
    if (!state.players[other.playerId]?.alive) continue;
    consider({ kind: 'soldier', id: other.id, x: other.x, y: other.y, d: Math.hypot(other.x - x, other.y - y) });
  }
  for (const mob of state.mobs) {
    if (!mob.alive || mob.kind === 'deer') continue;
    consider({ kind: 'mob', id: mob.id, x: mob.x, y: mob.y, d: Math.hypot(mob.x - x, mob.y - y) });
  }
  for (const building of state.buildings) {
    if (building.hp <= 0 || building.playerId === playerId) continue;
    if (!state.players[building.playerId]?.alive) continue;
    const def = BUILDINGS[building.type];
    const center = buildingCenter(building);
    consider({
      kind: 'building',
      id: building.id,
      x: center.x,
      y: center.y,
      d: rectDistance(x, y, building.x, building.y, def.w, def.h),
    });
  }
  return best;
}

function ensureSoldier(soldier: Soldier) {
  if (!soldier.waypoints) soldier.waypoints = [];
  if (soldier.waypointI == null) soldier.waypointI = 0;
  if (soldier.destX == null) soldier.destX = soldier.x;
  if (soldier.destY == null) soldier.destY = soldier.y;
  if (soldier.anchorX == null) soldier.anchorX = soldier.x;
  if (soldier.anchorY == null) soldier.anchorY = soldier.y;
  if (!soldier.targetKind) soldier.targetKind = 'none';
}

function followPath(state: GameState, soldier: Soldier): boolean {
  while (soldier.waypointI + 1 < soldier.waypoints.length) {
    const x = soldier.waypoints[soldier.waypointI];
    const y = soldier.waypoints[soldier.waypointI + 1];
    if (Math.hypot(soldier.x - x, soldier.y - y) < 0.28) {
      soldier.waypointI += 2;
      continue;
    }
    walkSoldier(state, soldier, x, y, SOLDIER_SPEED);
    return false;
  }
  return walkSoldier(state, soldier, soldier.destX, soldier.destY, SOLDIER_SPEED);
}

function fightThreat(state: GameState, soldier: Soldier, threat: Threat) {
  if (threat.kind === 'mob') {
    const mob = state.mobs.find((m) => m.id === threat.id && m.alive);
    if (!mob) return;
    strikeMob(state, soldier, mob);
    return;
  }
  if (threat.kind === 'soldier') {
    const other = state.soldiers.find((s) => s.id === threat.id && s.hp > 0);
    if (!other) return;
    strikeSoldier(state, soldier, other);
    return;
  }
  const building = buildingById(state, threat.id);
  if (!building || building.hp <= 0) return;
  strikeBuilding(state, soldier, building);
}

function strikeBuilding(state: GameState, soldier: Soldier, building: Building) {
  const center = buildingCenter(building);
  const def = BUILDINGS[building.type];
  const reach = strikeReach(soldier.weapon, building.type, Math.max(def.w, def.h));
  if (Math.hypot(center.x - soldier.x, center.y - soldier.y) > reach) {
    walkSoldier(state, soldier, center.x, center.y, SOLDIER_SPEED);
    return;
  }
  if (state.tick % 12 !== 0) return;
  const bonus = fortDamage(soldier.weapon, building.type);
  building.hp -= bonus < 0 ? soldier.dmg : bonus;
  if (building.hp <= 0 && building.type === 'keep') destroyKeep(state, building);
  else if (building.hp <= 0 && building.type === 'moat') pushLog(state, 'Ров засыпан');
}

function resolveTarget(state: GameState, soldier: Soldier): Threat | null {
  if (soldier.targetKind === 'soldier') {
    const other = state.soldiers.find((s) => s.id === soldier.targetId && s.hp > 0);
    if (!other) return null;
    return { kind: 'soldier', id: other.id, x: other.x, y: other.y, d: 0 };
  }
  if (soldier.targetKind === 'mob') {
    const mob = state.mobs.find((m) => m.id === soldier.targetId && m.alive);
    if (!mob) return null;
    return { kind: 'mob', id: mob.id, x: mob.x, y: mob.y, d: 0 };
  }
  if (soldier.targetKind === 'building') {
    const building = buildingById(state, soldier.targetId);
    if (!building || building.hp <= 0) return null;
    const center = buildingCenter(building);
    return { kind: 'building', id: building.id, x: center.x, y: center.y, d: 0 };
  }
  return null;
}

function updateDirected(state: GameState, soldier: Soldier) {
  ensureSoldier(soldier);
  if (soldier.order === 'hold') {
    const foe = nearestThreat(state, soldier.anchorX, soldier.anchorY, 2.6, soldier.playerId);
    if (foe) {
      fightThreat(state, soldier, foe);
      return;
    }
    if (Math.hypot(soldier.x - soldier.anchorX, soldier.y - soldier.anchorY) > 0.25) {
      walkSoldier(state, soldier, soldier.anchorX, soldier.anchorY, SOLDIER_SPEED);
    }
    return;
  }
  if (soldier.order === 'attack') {
    const foe = resolveTarget(state, soldier);
    if (!foe) {
      soldier.order = 'hold';
      soldier.anchorX = soldier.x;
      soldier.anchorY = soldier.y;
      return;
    }
    fightThreat(state, soldier, foe);
    return;
  }
  if (soldier.order === 'attackmove') {
    const near = nearestThreat(state, soldier.x, soldier.y, 2.4, soldier.playerId);
    const area = nearestThreat(state, soldier.destX, soldier.destY, 4.5, soldier.playerId);
    const foe = near ?? area;
    if (foe) {
      fightThreat(state, soldier, foe);
      return;
    }
    if (followPath(state, soldier)) {
      soldier.order = 'hold';
      soldier.anchorX = soldier.destX;
      soldier.anchorY = soldier.destY;
    }
    return;
  }
  if (followPath(state, soldier)) {
    if (soldier.order === 'home') soldier.order = 'defend';
    else {
      soldier.order = 'hold';
      soldier.anchorX = soldier.destX;
      soldier.anchorY = soldier.destY;
    }
  }
}

function updateSoldier(state: GameState, soldier: Soldier) {
  if (soldier.order === 'move' || soldier.order === 'hold' || soldier.order === 'attack' || soldier.order === 'attackmove' || soldier.order === 'home') {
    updateDirected(state, soldier);
    return;
  }
  const bow = soldier.weapon === 'bow' && soldier.order !== 'raid';
  const closeMob = nearestMob(state, soldier.x, soldier.y, soldier.order === 'raid' ? 1.2 : bow ? bowRange(state, soldier) : 9, false);
  const closeEnemy = nearestEnemySoldier(state, soldier, soldier.order === 'raid' ? 1.2 : bow ? bowRange(state, soldier) : 8);
  if (soldier.order === 'raid') {
    if (closeMob && Math.hypot(closeMob.x - soldier.x, closeMob.y - soldier.y) < 1.25) {
      strikeMob(state, soldier, closeMob);
      return;
    }
    if (closeEnemy && Math.hypot(closeEnemy.x - soldier.x, closeEnemy.y - soldier.y) < 1.25) {
      strikeSoldier(state, soldier, closeEnemy);
      return;
    }
    const keep =
      (soldier.raidTargetId && buildingById(state, soldier.raidTargetId)) ||
      nearestEnemyKeep(state, soldier.playerId, soldier.x, soldier.y);
    if (!keep || keep.hp <= 0 || keep.type !== 'keep') {
      soldier.order = 'defend';
      return;
    }
    soldier.raidTargetId = keep.id;
    const center = buildingCenter(keep);
    const breach = nearestBreach(state, soldier, center.x, center.y);
    const dx = center.x - soldier.x;
    const dy = center.y - soldier.y;
    const dist = Math.hypot(dx, dy) || 1;
    const aheadX = Math.floor(soldier.x + (dx / dist) * Math.min(SOLDIER_SPEED, dist));
    const aheadY = Math.floor(soldier.y + (dy / dist) * Math.min(SOLDIER_SPEED, dist));
    const wallAhead = blocksMover(state, aheadX, aheadY, soldier.playerId, moverOf(soldier));
    if (breach && (soldier.weapon === 'ram' || soldier.weapon === 'catapult' || wallAhead)) {
      strikeBuilding(state, soldier, breach);
      return;
    }
    if (Math.hypot(center.x - soldier.x, center.y - soldier.y) < 1.3) {
      if (state.tick % 12 === 0) {
        keep.hp -= soldier.dmg;
        if (keep.hp <= 0) destroyKeep(state, keep);
      }
    } else walkSoldier(state, soldier, center.x, center.y, SOLDIER_SPEED);
    return;
  }
  if (closeMob) {
    strikeMob(state, soldier, closeMob);
    return;
  }
  if (closeEnemy) {
    strikeSoldier(state, soldier, closeEnemy);
    return;
  }
  if (soldier.weapon === 'bow') {
    const slot = towerSlotFor(state, soldier);
    if (slot) {
      walkSoldier(state, soldier, slot.x, slot.y, SOLDIER_SPEED);
      return;
    }
  }
  const keep = playerKeep(state, soldier.playerId);
  if (!keep) return;
  const center = buildingCenter(keep);
  if (Math.hypot(center.x - soldier.x, center.y - soldier.y) > 3.2) {
    walkSoldier(state, soldier, center.x, center.y + 2, SOLDIER_SPEED);
  }
}

function nearestEnemySoldier(state: GameState, soldier: Soldier, range: number): Soldier | null {
  let best: Soldier | null = null;
  let bestD = range;
  for (const other of state.soldiers) {
    if (other.hp <= 0 || other.playerId === soldier.playerId) continue;
    if (!state.players[other.playerId]?.alive) continue;
    const d = Math.hypot(other.x - soldier.x, other.y - soldier.y);
    if (d <= bestD) {
      best = other;
      bestD = d;
    }
  }
  return best;
}

function strikeMob(state: GameState, soldier: Soldier, mob: Mob) {
  const d = Math.hypot(mob.x - soldier.x, mob.y - soldier.y);
  if (d > 0.7) {
    walkSoldier(state, soldier, mob.x, mob.y, SOLDIER_SPEED);
    return;
  }
  if (state.tick % 12 !== 0) return;
  mob.hp -= soldier.dmg;
  if (mob.hp <= 0) {
    mob.alive = false;
    mob.respawn = state.tick + 800;
  }
}

function strikeSoldier(state: GameState, soldier: Soldier, other: Soldier) {
  const d = Math.hypot(other.x - soldier.x, other.y - soldier.y);
  const range = soldier.weapon === 'bow' ? bowRange(state, soldier) : 0.7;
  if (d > range) {
    walkSoldier(state, soldier, other.x, other.y, SOLDIER_SPEED);
    return;
  }
  if (state.tick % 12 !== 0) return;
  const dealt = onOwnTower(state, other) ? Math.max(1, Math.floor(soldier.dmg * 0.5)) : soldier.dmg;
  other.hp -= dealt;
}

function updateEconomy(state: GameState) {
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.beerMood > 0) player.beerMood -= 1;
    const people = state.people.filter((p) => p.playerId === player.id && p.hp > 0).length;
    if (state.tick > 0 && state.tick % CONSUME_EVERY === 0) {
      const meal = consumeFood(player.stocks, people, player.ration);
      player.stocks = meal.stocks;
      player.hunger = meal.hunger;
    }
    if (state.tick > 0 && state.tick % TAX_EVERY === 0) {
      player.gold += taxGold(people, player.tax);
    }
    if (state.tick > 0 && state.tick % POP_EVERY === 0) {
      const target = popularityTarget({
        ration: player.ration,
        foodTypes: foodTypesIn(player.stocks),
        tax: player.tax,
        beer: player.beerMood > 0,
        hunger: player.hunger,
      }).value;
      if (player.popularity < target) player.popularity += 1;
      else if (player.popularity > target) player.popularity -= 1;
    }
    migrate(state, player);
    relieveDeadEnd(state, player);
  }
}

/**
 * A settlement must stay playable.
 * With no woodcutter and fewer than 3 wood, the keep drips one log a minute, up to the hut's price.
 * With nobody left, the keep takes in one settler after a short wait. Same rule on every client.
 */
function relieveDeadEnd(state: GameState, player: Player) {
  if (state.tick <= 0) return;
  const cutter = state.buildings.some((b) => b.playerId === player.id && b.type === 'woodcutter' && b.hp > 0);
  if (!cutter && state.tick % 60 === 0 && (player.stocks.wood ?? 0) < 3) {
    player.stocks.wood = (player.stocks.wood ?? 0) + 1;
    note(state, 'Главное здание отдало брёвна на хижину лесоруба');
  }
}

function migrate(state: GameState, player: Player) {
  const people = state.people.filter((p) => p.playerId === player.id && p.hp > 0);
  const cap = housingCap(state, player.id);
  if (people.length > cap) {
    player.migrate += 1;
    if (player.migrate >= 80) {
      player.migrate = 0;
      evict(state, player.id);
    }
    return;
  }
  if (player.popularity > 0 && people.length < cap) {
    player.migrate += 1;
    const interval = Math.max(50, 160 - player.popularity * 2);
    if (player.migrate >= interval) {
      player.migrate = 0;
      const keep = playerKeep(state, player.id);
      if (!keep) return;
      const center = buildingCenter(keep);
      createPerson(state, player.id, center.x, center.y + 1.7, state.tick % 7);
      pushLog(state, 'В поселение пришёл новый человек');
    }
    return;
  }
  if (people.length === 0) {
    const keep = playerKeep(state, player.id);
    if (!keep) return;
    player.migrate += 1;
    if (player.migrate >= 80) {
      player.migrate = 0;
      const center = buildingCenter(keep);
      createPerson(state, player.id, center.x, center.y + 1.7, state.tick % 7);
      note(state, 'В главное здание вернулся один человек');
    }
    return;
  }
  if (player.popularity < 0 && people.length > 0) {
    player.migrate += 1;
    const interval = Math.max(50, 160 + player.popularity * 2);
    if (player.migrate >= interval) {
      player.migrate = 0;
      evict(state, player.id);
      pushLog(state, 'Человек покинул поселение');
    }
    return;
  }
  player.migrate = 0;
}

function evict(state: GameState, playerId: number) {
  const mine = state.people.filter((p) => p.playerId === playerId && p.hp > 0);
  if (!mine.length) return;
  const idle = mine.find((p) => p.task.type === 'idle');
  const builder = mine.find((p) => p.task.type === 'build');
  const victim = idle ?? builder ?? mine[mine.length - 1];
  releasePerson(state, victim);
  state.people = state.people.filter((p) => p.id !== victim.id);
}

function finishOutcome(state: GameState) {
  const humans = state.players.filter((p) => !p.isAi);
  if (humans.length > 1) {
    const alive = state.players.filter((p) => p.alive);
    if (alive.length <= 1) state.outcome = 'victory';
    return;
  }
  const human = state.players[0];
  if (!human || !human.alive) {
    state.outcome = 'defeat';
    return;
  }
  if (state.players.length > 1 && state.players.every((p) => p.id === 0 || !p.alive)) state.outcome = 'victory';
}

export function step(state: GameState, commands: Command[] = [], opts?: { shelter?: boolean }): void {
  if (state.outcome !== 'playing') return;
  for (const command of commands) applyCommand(state, command);
  planAi(state);
  updatePeople(state);
  updateOxen(state);
  updateCombat(state);
  updateSiege(state, (text) => note(state, text));
  state.people = state.people.filter((p) => p.hp > 0);
  state.soldiers = state.soldiers.filter((s) => s.hp > 0);
  state.mobs = state.mobs.filter((m) => m.alive || m.respawn > 0);
  // Single-player onboarding only. Multiplayer never sets this, so every client still shares one economy.
  if (!opts?.shelter) updateEconomy(state);
  finishOutcome(state);
  state.tick += 1;
}

export function serialize(state: GameState): string {
  return JSON.stringify({
    saveVersion: state.saveVersion,
    seed: state.seed,
    tick: state.tick,
    rng: state.rng,
    mapW: state.mapW,
    mapH: state.mapH,
    roadY: state.roadY,
    terrain: Array.from(state.terrain),
    nextId: state.nextId,
    players: state.players,
    buildings: state.buildings,
    people: state.people,
    soldiers: state.soldiers,
    oxen: state.oxen,
    mobs: state.mobs,
    clouds: state.clouds ?? [],
    outcome: state.outcome,
    message: state.message,
    log: state.log,
  });
}

export function deserialize(raw: string): GameState {
  const data = JSON.parse(raw) as GameState & { terrain: number[] };
  if (data.saveVersion !== 1) throw new Error('Неизвестная версия сохранения');
  const terrain = Uint8Array.from(data.terrain);
  const clouds = data.clouds ?? [];
  for (const building of data.buildings) {
    if (building.seal == null) building.seal = 0;
  }
  return { ...data, terrain, clouds };
}
