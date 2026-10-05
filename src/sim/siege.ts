import { BUILDINGS, BOW_RANGE, CLOUD_RADIUS, CLOUD_TICKS, CROSSBOW_RANGE, HORSEBOW_RANGE, LADDER_WOOD, MERC_REFRESH, PITCH_BURN, POP_MAX, POP_MIN, TOWER_RANGE } from './balance';
import { createSoldier } from './entities';
import { findPath, tileBlocked } from './path';
import { hostile } from './match';
import { roadPace } from './roads';
import type { Building, BuildingType, Command, GameState, Player, Resource, Soldier, Weapon } from './types';

export const LINE_TYPES: readonly BuildingType[] = ['palisade', 'wall', 'moat', 'pitchditch'];

const FORTS = new Set<BuildingType>(['palisade', 'wall', 'gate', 'stairs', 'woodtower', 'stonetower', 'moat']);
const BREACH = new Set<BuildingType>(['palisade', 'wall', 'gate', 'moat', 'woodtower', 'stonetower', 'stairs']);
const TOWERS = new Set<BuildingType>(['woodtower', 'stonetower']);

export type Mover = 'worker' | 'soldier' | 'bow' | 'ladder';

export function isLineBuilding(type: BuildingType): boolean {
  return type === 'palisade' || type === 'wall' || type === 'moat' || type === 'pitchditch';
}

export function isFort(type: BuildingType): boolean {
  return FORTS.has(type);
}

export function wallLine(x0: number, y0: number, x1: number, y1: number, cap = 40): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  let x = x0 | 0;
  let y = y0 | 0;
  const destX = x1 | 0;
  const destY = y1 | 0;
  const dx = Math.abs(destX - x);
  const dy = Math.abs(destY - y);
  const sx = x < destX ? 1 : -1;
  const sy = y < destY ? 1 : -1;
  let err = dx - dy;
  while (cells.length < cap) {
    cells.push({ x, y });
    if (x === destX && y === destY) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

export function moverOf(soldier: Soldier): Mover {
  if (soldier.weapon === 'ladder') return 'ladder';
  if (soldier.weapon === 'bow' || soldier.weapon === 'crossbow') return 'bow';
  return 'soldier';
}

export function trainHall(weapon: Weapon): 'barracks' | 'guild' | 'workshop' | 'chapel' {
  if (weapon === 'healer') return 'chapel';
  if (weapon === 'siegetower') return 'workshop';
  if (weapon === 'engineer' || weapon === 'ladder' || weapon === 'ram' || weapon === 'catapult') return 'guild';
  return 'barracks';
}

/** Halls that may train this weapon. Engineers and ladder crews still muster at the old guild. */
export function trainSites(weapon: Weapon): BuildingType[] {
  if (weapon === 'engineer' || weapon === 'ladder') return ['workshop', 'guild'];
  if (weapon === 'siegetower') return ['workshop'];
  if (weapon === 'healer') return ['chapel'];
  return [trainHall(weapon)];
}

function covers(building: Building, x: number, y: number): boolean {
  const def = BUILDINGS[building.type];
  return x >= building.x && x < building.x + def.w && y >= building.y && y < building.y + def.h;
}

function fortOn(state: GameState, x: number, y: number): Building | null {
  for (const building of state.buildings) {
    if (building.hp <= 0 || !building.complete || !FORTS.has(building.type)) continue;
    if (covers(building, x, y)) return building;
  }
  return null;
}

const fortMemo = new WeakMap<GameState, { tick: number; anyFort: boolean; access: Map<number, Set<number>> }>();

function fortRow(state: GameState) {
  let row = fortMemo.get(state);
  if (!row || row.tick !== state.tick) {
    row = { tick: state.tick, anyFort: false, access: new Map() };
    for (const building of state.buildings) {
      if (building.hp > 0 && building.complete && FORTS.has(building.type)) {
        row.anyFort = true;
        break;
      }
    }
    fortMemo.set(state, row);
  }
  return row;
}

export function settlementHasForts(state: GameState): boolean {
  return fortRow(state).anyFort;
}

function wallAccess(state: GameState, playerId: number): Set<number> {
  const accessCache = fortRow(state).access;
  const cached = accessCache.get(playerId);
  if (cached) return cached;
  const set = new Set<number>();
  accessCache.set(playerId, set);
  const key = (x: number, y: number) => y * state.mapW + x;
  const queue: { x: number; y: number }[] = [];
  for (const building of state.buildings) {
    if (building.playerId !== playerId || building.type !== 'stairs' || !building.complete || building.hp <= 0) continue;
    queue.push({ x: building.x, y: building.y });
    set.add(key(building.x, building.y));
  }
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const cell = queue.pop()!;
    for (const [dx, dy] of dirs) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      const id = key(nx, ny);
      if (set.has(id)) continue;
      const fort = fortOn(state, nx, ny);
      if (!fort || fort.playerId !== playerId) continue;
      if (fort.type !== 'palisade' && fort.type !== 'wall' && fort.type !== 'stairs') continue;
      set.add(id);
      queue.push({ x: nx, y: ny });
    }
  }
  return set;
}

export function onOwnTower(state: GameState, soldier: Soldier): boolean {
  if (soldier.weapon !== 'bow' && soldier.weapon !== 'crossbow') return false;
  const x = Math.floor(soldier.x);
  const y = Math.floor(soldier.y);
  const fort = fortOn(state, x, y);
  return !!fort && fort.playerId === soldier.playerId && TOWERS.has(fort.type);
}

export function bowRange(state: GameState, soldier: Soldier): number {
  if (soldier.weapon === 'horsebow') return HORSEBOW_RANGE;
  if (soldier.weapon === 'crossbow') return onOwnTower(state, soldier) ? TOWER_RANGE : CROSSBOW_RANGE;
  return onOwnTower(state, soldier) ? TOWER_RANGE : BOW_RANGE;
}

export function blocksMover(state: GameState, x: number, y: number, playerId: number, kind: Mover): boolean {
  if (!settlementHasForts(state)) return false;
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return true;
  const fort = fortOn(state, x, y);
  if (!fort) return false;
  const own = !hostile(state, fort.playerId, playerId);
  if (fort.type === 'gate' || fort.type === 'stairs') return !own;
  if (fort.type === 'moat') return !own;
  if (TOWERS.has(fort.type)) return !(own && kind === 'bow');
  if (fort.type === 'palisade' || fort.type === 'wall') {
    if (!own && kind === 'ladder') return false;
    if (own && kind === 'bow' && wallAccess(state, playerId).has(y * state.mapW + x)) return false;
    if (wallClimbed(state, x, y, playerId)) return false;
    return true;
  }
  return false;
}

export function routeBlocked(state: GameState, x: number, y: number, playerId: number, kind: Mover): boolean {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return true;
  if (fortOn(state, x, y)) return blocksMover(state, x, y, playerId, kind);
  return tileBlocked(state, x, y);
}

function ownMoat(state: GameState, x: number, y: number, playerId: number): boolean {
  const fort = fortOn(state, x, y);
  return !!fort && fort.type === 'moat' && fort.playerId === playerId;
}

function straight(ent: { x: number; y: number }, x: number, y: number, speed: number): boolean {
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

function detour(
  state: GameState,
  ent: { x: number; y: number },
  x: number,
  y: number,
  speed: number,
  playerId: number,
  kind: Mover,
): boolean {
  const blocked = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return true;
    if (kind === 'worker') return blocksMover(state, tx, ty, playerId, kind);
    return routeBlocked(state, tx, ty, playerId, kind);
  };
  const path = findPath(state, ent.x, ent.y, x, y, { blocked, limit: 800 });
  if (!path.length) return false;
  const step = path[0];
  const dx = step.x - ent.x;
  const dy = step.y - ent.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return false;
  const nx = ent.x + (dx / dist) * Math.min(speed, dist);
  const ny = ent.y + (dy / dist) * Math.min(speed, dist);
  if (blocksMover(state, Math.floor(nx), Math.floor(ny), playerId, kind)) return false;
  ent.x = nx;
  ent.y = ny;
  return Math.hypot(x - ent.x, y - ent.y) <= 1e-6;
}

/** Straight step, identical to the old walker when the next tile is not a fort. */
export function approach(
  state: GameState,
  ent: { x: number; y: number },
  x: number,
  y: number,
  speed: number,
  playerId: number,
  kind: Mover,
): boolean {
  speed = roadPace(state, ent.x, ent.y, speed);
  if (!settlementHasForts(state)) return straight(ent, x, y, speed);
  const dx = x - ent.x;
  const dy = y - ent.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed || d < 1e-6) {
    if (blocksMover(state, Math.floor(x), Math.floor(y), playerId, kind)) return detour(state, ent, x, y, speed, playerId, kind);
    ent.x = x;
    ent.y = y;
    return true;
  }
  const nx = ent.x + (dx / d) * speed;
  const ny = ent.y + (dy / d) * speed;
  const tileX = Math.floor(nx);
  const tileY = Math.floor(ny);
  if (blocksMover(state, tileX, tileY, playerId, kind)) return detour(state, ent, x, y, speed, playerId, kind);
  if (ownMoat(state, tileX, tileY, playerId)) {
    const slow = speed * 0.4;
    if (d <= slow) {
      ent.x = x;
      ent.y = y;
      return true;
    }
    ent.x += (dx / d) * slow;
    ent.y += (dy / d) * slow;
    return false;
  }
  ent.x = nx;
  ent.y = ny;
  return false;
}

export function breachTypes(type: BuildingType): boolean {
  return BREACH.has(type);
}

export function fortDamage(weapon: Weapon, type: BuildingType): number {
  if (breachTypes(type)) {
    if (weapon === 'ram') return 28;
    if (weapon === 'catapult') return 18;
    return 1;
  }
  if (weapon === 'catapult') return 10;
  return -1;
}

export function strikeReach(weapon: Weapon, type: BuildingType, footprint: number): number {
  if (weapon === 'catapult') return 8;
  if (breachTypes(type)) return 1.45;
  return footprint * 0.45 + 0.55;
}

function center(building: Building): { x: number; y: number } {
  const def = BUILDINGS[building.type];
  return { x: building.x + def.w / 2, y: building.y + def.h / 2 };
}

export function nearestBreach(state: GameState, soldier: Soldier, goalX: number, goalY: number): Building | null {
  let best: Building | null = null;
  let bestScore = Infinity;
  for (const building of state.buildings) {
    if (building.hp <= 0 || !building.complete || !hostile(state, building.playerId, soldier.playerId)) continue;
    if (!BREACH.has(building.type)) continue;
    if (!state.players[building.playerId]?.alive) continue;
    const spot = center(building);
    const along = Math.hypot(spot.x - goalX, spot.y - goalY);
    const from = Math.hypot(spot.x - soldier.x, spot.y - soldier.y);
    let score = building.hp + from * 0.5 + along * 0.15;
    if (building.type === 'gate') score -= 40;
    if (score < bestScore || (score === bestScore && best && building.id < best.id)) {
      best = building;
      bestScore = score;
    }
  }
  return best;
}

export function emptyTowerSlot(state: GameState, soldier: Soldier): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = 1e9;
  const towers = state.buildings
    .filter((b) => b.playerId === soldier.playerId && b.complete && b.hp > 0 && TOWERS.has(b.type))
    .sort((a, b) => a.id - b.id);
  for (const tower of towers) {
    const spots = [
      { x: tower.x + 0.7, y: tower.y + 0.7 },
      { x: tower.x + 1.25, y: tower.y + 1.15 },
    ];
    for (const spot of spots) {
      const taken = state.soldiers.some(
        (other) =>
          other.id !== soldier.id &&
          other.hp > 0 &&
          other.playerId === soldier.playerId &&
          Math.hypot(other.x - spot.x, other.y - spot.y) < 0.45,
      );
      if (taken) continue;
      const d = Math.hypot(soldier.x - spot.x, soldier.y - spot.y);
      if (d < bestD) {
        best = spot;
        bestD = d;
      }
    }
  }
  return best;
}

function adjacent(a: Building, b: Building): boolean {
  const da = BUILDINGS[a.type];
  const db = BUILDINGS[b.type];
  const xOverlap = a.x < b.x + db.w && a.x + da.w > b.x;
  const yOverlap = a.y < b.y + db.h && a.y + da.h > b.y;
  const xAdj = a.x + da.w === b.x || b.x + db.w === a.x;
  const yAdj = a.y + da.h === b.y || b.y + db.h === a.y;
  return (xAdj && yOverlap) || (yAdj && xOverlap);
}

function unitOn(state: GameState, x: number, y: number, range: number, enemyOf: number): boolean {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || !hostile(state, soldier.playerId, enemyOf)) continue;
    if (!state.players[soldier.playerId]?.alive) continue;
    if (Math.hypot(soldier.x - x, soldier.y - y) <= range) return true;
  }
  for (const person of state.people) {
    if (person.hp <= 0 || !hostile(state, person.playerId, enemyOf)) continue;
    if (Math.hypot(person.x - x, person.y - y) <= range) return true;
  }
  return false;
}

function burnUnit(state: GameState, x: number, y: number) {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0) continue;
    if (Math.hypot(soldier.x - x, soldier.y - y) > 0.8) continue;
    soldier.hp -= soldier.weapon === 'siegetower' ? 16 : 4;
  }
  for (const person of state.people) {
    if (person.hp <= 0) continue;
    if (Math.hypot(person.x - x, person.y - y) <= 0.8) person.hp -= 4;
  }
}

function updatePitch(state: GameState) {
  for (const ditch of state.buildings) {
    if (ditch.type !== 'pitchditch' || !ditch.complete || ditch.hp <= 0) continue;
    const spot = center(ditch);
    if (ditch.buffer > 0) {
      ditch.work -= 1;
      if (state.tick % 4 === 0) burnUnit(state, spot.x, spot.y);
      if (ditch.work <= 0) {
        ditch.buffer = 0;
        ditch.work = 0;
      }
      continue;
    }
    if (!unitOn(state, spot.x, spot.y, 1.6, ditch.playerId)) continue;
    const brazier = state.buildings.some(
      (other) =>
        other.playerId === ditch.playerId &&
        other.type === 'brazier' &&
        other.complete &&
        other.hp > 0 &&
        adjacent(ditch, other),
    );
    const archer = state.soldiers.some(
      (soldier) =>
        soldier.playerId === ditch.playerId &&
        soldier.hp > 0 &&
        soldier.weapon === 'bow' &&
        Math.hypot(soldier.x - spot.x, soldier.y - spot.y) <= 6,
    );
    if (!brazier && !archer) continue;
    ditch.buffer = 1;
    ditch.work = PITCH_BURN;
  }
}

function updateOil(state: GameState) {
  if (state.tick % 20 !== 0) return;
  for (const vat of state.buildings) {
    if (vat.type !== 'oil' || !vat.complete || vat.hp <= 0) continue;
    const player = state.players[vat.playerId];
    if (!player || !player.alive || (player.stocks.pitch ?? 0) < 1) continue;
    const tower = state.buildings.find(
      (other) =>
        other.playerId === vat.playerId &&
        other.complete &&
        other.hp > 0 &&
        TOWERS.has(other.type) &&
        adjacent(vat, other),
    );
    if (!tower) continue;
    const spot = center(tower);
    const engineer = state.soldiers.some(
      (soldier) =>
        soldier.playerId === vat.playerId &&
        soldier.hp > 0 &&
        soldier.weapon === 'engineer' &&
        Math.hypot(soldier.x - spot.x, soldier.y - spot.y) <= 4,
    );
    if (!engineer) continue;
    let hit = false;
    for (const soldier of state.soldiers) {
      if (soldier.hp <= 0 || !hostile(state, soldier.playerId, vat.playerId)) continue;
      if (!state.players[soldier.playerId]?.alive) continue;
      if (Math.hypot(soldier.x - spot.x, soldier.y - spot.y) > 1.6) continue;
      soldier.hp -= soldier.weapon === 'siegetower' ? 22 : 8;
      hit = true;
    }
    if (!hit) continue;
    player.stocks.pitch -= 1;
  }
}

function updateClouds(state: GameState) {
  const next = [];
  for (const cloud of state.clouds) {
    if (cloud.ticks % 8 === 0) {
      for (const person of state.people) {
        if (person.hp <= 0) continue;
        if (Math.hypot(person.x - cloud.x, person.y - cloud.y) <= cloud.radius) person.hp -= 1;
      }
    }
    cloud.ticks -= 1;
    if (cloud.ticks > 0) next.push(cloud);
  }
  state.clouds = next;
}

function refreshSeals(state: GameState, note: (text: string) => void) {
  if (state.tick % 60 !== 0 || !settlementHasForts(state)) return;
  const walled = new Set<number>();
  for (const building of state.buildings) {
    if (building.complete && building.hp > 0 && FORTS.has(building.type)) walled.add(building.playerId);
  }
  for (const building of state.buildings) {
    if (building.seal == null) building.seal = 0;
    if (!building.complete || building.hp <= 0 || !walled.has(building.playerId)) {
      building.seal = 0;
      continue;
    }
    if (building.type === 'keep' || FORTS.has(building.type)) {
      building.seal = 0;
      continue;
    }
    const def = BUILDINGS[building.type];
    if (def.workers <= 0 && building.workerIds.length === 0) {
      building.seal = 0;
      continue;
    }
    const keep = state.buildings.find((b) => b.playerId === building.playerId && b.type === 'keep' && b.hp > 0);
    if (!keep) continue;
    const from = center(keep);
    const to = center(building);
    const path = findPath(state, from.x, from.y, to.x, to.y, {
      blocked: (x, y) => x < 0 || y < 0 || x >= state.mapW || y >= state.mapH || blocksMover(state, x, y, building.playerId, 'worker'),
      limit: 1500,
    });
    const sealed = path.length === 0 ? 1 : 0;
    if (sealed === 1 && building.seal !== 1) note('стена отрезала путь');
    building.seal = sealed;
  }
}

export function wallClimbed(state: GameState, x: number, y: number, playerId: number): boolean {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.playerId !== playerId) continue;
    const placed = (soldier.weapon === 'ladder' && (soldier.dock ?? 0) === 1) || (soldier.weapon === 'siegetower' && (soldier.dock ?? 0) === 2);
    if (!placed) continue;
    const sx = Math.floor(soldier.x);
    const sy = Math.floor(soldier.y);
    if (Math.max(Math.abs(sx - x), Math.abs(sy - y)) <= 1) return true;
  }
  return false;
}

function nearestHostileLine(state: GameState, x: number, y: number, playerId: number, types: readonly BuildingType[], range: number): Building | null {
  let best: Building | null = null;
  let bestD = range;
  for (const building of state.buildings) {
    if (building.hp <= 0 || !building.complete || !types.includes(building.type)) continue;
    if (!hostile(state, building.playerId, playerId)) continue;
    const spot = center(building);
    const d = Math.hypot(spot.x - x, spot.y - y);
    if (d > bestD + 1e-9) continue;
    if (best && d > bestD - 1e-9 && building.id > best.id) continue;
    best = building;
    bestD = d;
  }
  return best;
}

function ladderPlanted(state: GameState, x: number, y: number): boolean {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.weapon !== 'ladder' || (soldier.dock ?? 0) !== 1) continue;
    if (Math.hypot(soldier.x - x, soldier.y - y) < 1.35) return true;
  }
  return false;
}

function updateEngineers(state: GameState, note: (text: string) => void) {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.weapon !== 'engineer') continue;
    const busy = state.soldiers.some(
      (other) => other.hp > 0 && other.id !== soldier.id && hostile(state, other.playerId, soldier.playerId) && Math.hypot(other.x - soldier.x, other.y - soldier.y) <= 1.05,
    );
    if (busy) continue;
    const moat = nearestHostileLine(state, soldier.x, soldier.y, soldier.playerId, ['moat'], 1.55);
    if (moat && state.tick % 8 === 0) {
      moat.hp -= 4;
      if (moat.hp <= 0) note('Ров засыпан');
      continue;
    }
    const wall = nearestHostileLine(state, soldier.x, soldier.y, soldier.playerId, ['palisade', 'wall'], 1.45);
    if (!wall) continue;
    const spot = center(wall);
    if (ladderPlanted(state, spot.x, spot.y)) continue;
    const owner = state.players[soldier.playerId];
    if (!owner || (owner.stocks.wood ?? 0) < LADDER_WOOD) continue;
    owner.stocks.wood -= LADDER_WOOD;
    const ladder = createSoldier(state, soldier.playerId, spot.x, spot.y, 'ladder');
    ladder.dock = 1;
    ladder.order = 'hold';
    ladder.anchorX = spot.x;
    ladder.anchorY = spot.y;
    note('Инженер поставил лестницу');
  }
}

function updateDocks(state: GameState, note: (text: string) => void) {
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || (soldier.weapon !== 'ladder' && soldier.weapon !== 'siegetower')) continue;
    const wall = nearestHostileLine(state, soldier.x, soldier.y, soldier.playerId, ['palisade', 'wall'], 1.25);
    if (wall) {
      const was = soldier.dock ?? 0;
      soldier.dock = soldier.weapon === 'ladder' ? 1 : 2;
      if (was !== 2 && soldier.weapon === 'siegetower') note('Осадная башня встала у стены');
    } else if ((soldier.dock ?? 0) > 0 && !nearestHostileLine(state, soldier.x, soldier.y, soldier.playerId, ['palisade', 'wall'], 1.8)) {
      soldier.dock = 0;
    }
  }
  if (state.tick % 18 !== 0) return;
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || soldier.weapon !== 'ladder' || (soldier.dock ?? 0) !== 1) continue;
    const pushed = state.soldiers.some(
      (other) => other.hp > 0 && other.id !== soldier.id && hostile(state, other.playerId, soldier.playerId) && Math.hypot(other.x - soldier.x, other.y - soldier.y) <= 1.25,
    );
    if (!pushed) continue;
    soldier.hp = 0;
    note('Лестницу столкнули');
  }
}

function updateMercStock(state: GameState) {
  for (const camp of state.buildings) {
    if (camp.type !== 'merccamp' || !camp.complete || camp.hp <= 0) continue;
    if ((camp.gear ?? 0) === 0) {
      camp.buffer = 2;
      camp.input = 1;
      camp.work = MERC_REFRESH;
      camp.gear = 1;
      continue;
    }
    if (camp.buffer >= 2 && camp.input >= 2) continue;
    if (camp.work > 0) {
      camp.work -= 1;
      continue;
    }
    if (camp.buffer < 2) camp.buffer += 1;
    else camp.input += 1;
    camp.work = MERC_REFRESH;
  }
}

export function updateSiege(state: GameState, note: (text: string) => void) {
  if (!state.clouds) state.clouds = [];
  updatePitch(state);
  updateOil(state);
  updateClouds(state);
  updateEngineers(state, note);
  updateDocks(state, note);
  updateMercStock(state);
  refreshSeals(state, note);
}

export function spawnCloud(state: GameState, playerId: number, x: number, y: number) {
  if (!state.clouds) state.clouds = [];
  state.clouds.push({
    id: state.nextId++,
    playerId,
    x,
    y,
    ticks: CLOUD_TICKS,
    radius: CLOUD_RADIUS,
  });
  for (const player of state.players) {
    if (!player.alive || player.id === playerId) continue;
    const near = state.people.some(
      (person) => person.playerId === player.id && person.hp > 0 && Math.hypot(person.x - x, person.y - y) <= CLOUD_RADIUS + 1,
    );
    const keep = state.buildings.some((building) => {
      if (building.playerId !== player.id || building.type !== 'keep' || building.hp <= 0) return false;
      const spot = center(building);
      return Math.hypot(spot.x - x, spot.y - y) <= CLOUD_RADIUS + 4;
    });
    if (!near && !keep) continue;
    player.popularity = Math.max(POP_MIN, Math.min(POP_MAX, player.popularity - 8));
  }
}

function ringTiles(keep: Building, radius: number): { x: number; y: number }[] {
  const cx = keep.x + 1;
  const cy = keep.y + 1;
  const tiles: { x: number; y: number }[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
      tiles.push({ x, y });
    }
  }
  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}

export function nextAiSiege(
  state: GameState,
  player: Player,
  canPlace: (state: GameState, playerId: number, type: BuildingType, x: number, y: number) => { ok: boolean },
  canAfford: (stocks: Record<Resource, number>, cost: Partial<Record<Resource, number>>) => boolean,
  idle: number,
): Command | null {
  if (state.tick < 1800) return null;
  const keep = state.buildings.find((b) => b.playerId === player.id && b.type === 'keep' && b.hp > 0);
  if (!keep || keep.level < 2) return null;
  const mine = (type: BuildingType) =>
    state.buildings.filter((b) => b.playerId === player.id && b.type === type && b.hp > 0).length;
  const ring = ringTiles(keep, 5);
  const gateTile = ring.reduce((best, tile) => (tile.y > best.y || (tile.y === best.y && tile.x < best.x) ? tile : best), ring[0]);
  if (mine('palisade') < 10) {
    for (const tile of ring) {
      if (tile.x === gateTile.x && tile.y === gateTile.y) continue;
      if (canPlace(state, player.id, 'palisade', tile.x, tile.y).ok) {
        return { kind: 'place', playerId: player.id, building: 'palisade', x: tile.x, y: tile.y };
      }
    }
  }
  if (mine('gate') < 1 && mine('palisade') >= 6 && canPlace(state, player.id, 'gate', gateTile.x, gateTile.y).ok) {
    return { kind: 'place', playerId: player.id, building: 'gate', x: gateTile.x, y: gateTile.y };
  }
  if (mine('woodtower') < 2) {
    const spots = [
      { x: keep.x - 3, y: keep.y - 3 },
      { x: keep.x + 4, y: keep.y - 3 },
      { x: keep.x - 3, y: keep.y + 4 },
    ];
    for (const spot of spots) {
      if (canPlace(state, player.id, 'woodtower', spot.x, spot.y).ok) {
        return { kind: 'place', playerId: player.id, building: 'woodtower', x: spot.x, y: spot.y };
      }
    }
  }
  if (state.tick < 3600) return null;
  if (mine('guild') < 1) {
    for (let r = 2; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = keep.x + dx;
          const y = keep.y + dy;
          if (canPlace(state, player.id, 'guild', x, y).ok) {
            return { kind: 'place', playerId: player.id, building: 'guild', x, y };
          }
        }
      }
    }
    return null;
  }
  if (state.tick < 4000) return null;
  const guild = state.buildings.some((b) => b.playerId === player.id && b.type === 'guild' && b.complete && b.hp > 0);
  const has = (weapon: Weapon) => state.soldiers.some((s) => s.playerId === player.id && s.hp > 0 && s.weapon === weapon);
  if (guild && !has('ram') && idle >= 1 && canAfford(player.stocks, { wood: 16, stone: 4 })) {
    return { kind: 'train', playerId: player.id, weapon: 'ram' };
  }
  if (state.tick >= 4400 && guild && !has('catapult') && idle >= 1 && canAfford(player.stocks, { wood: 18, stone: 10, iron: 4 })) {
    return { kind: 'train', playerId: player.id, weapon: 'catapult' };
  }
  return null;
}

export function towerSlotFor(state: GameState, soldier: Soldier): { x: number; y: number } | null {
  if (soldier.weapon !== 'bow' || onOwnTower(state, soldier)) return null;
  return emptyTowerSlot(state, soldier);
}
