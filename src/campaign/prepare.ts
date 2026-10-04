import { BUILDINGS, popularityTarget, foodTypesIn } from '../sim/balance';
import { createBuilding, createMob, createSoldier } from '../sim/entities';
import { playerKeep } from '../sim/update';
import type { BuildingType, GameState, Resource } from '../sim/types';

export function paintDisc(state: GameState, cx: number, cy: number, r: number, value: number) {
  const rr = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr) continue;
      if (Math.abs(y - state.roadY) <= 1) continue;
      state.terrain[y * state.mapW + x] = value;
    }
  }
}

export function thinKeep(state: GameState, playerId: number, hp: number) {
  const keep = playerKeep(state, playerId);
  if (!keep) return;
  keep.maxHp = hp;
  keep.hp = hp;
}

export function setKeepLevel(state: GameState, playerId: number, level: number) {
  const keep = playerKeep(state, playerId);
  if (!keep) return;
  const next = Math.max(1, Math.min(5, level));
  keep.level = next;
  keep.maxHp = BUILDINGS.keep.hp + (next - 1) * 90;
  keep.hp = keep.maxHp;
}

export function grant(state: GameState, playerId: number, gold: number, stocks: Partial<Record<Resource, number>>) {
  const player = state.players[playerId];
  if (!player) return;
  player.gold = gold;
  for (const key of Object.keys(stocks) as Resource[]) player.stocks[key] = stocks[key] ?? 0;
  player.popularity = popularityTarget({
    ration: player.ration,
    foodTypes: foodTypesIn(player.stocks),
    tax: player.tax,
    beer: false,
    hunger: false,
  }).value;
}

export function clearHostiles(state: GameState, nearPlayer = -1) {
  state.mobs = state.mobs.filter((mob) => {
    if (mob.kind === 'deer') return true;
    if (nearPlayer < 0) return false;
    const keep = playerKeep(state, nearPlayer);
    if (!keep) return false;
    return Math.hypot(mob.x - keep.x, mob.y - keep.y) > 18;
  });
}

function overlaps(state: GameState, x: number, y: number, w: number, h: number): boolean {
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const def = BUILDINGS[building.type];
    if (x < building.x + def.w && x + w > building.x && y < building.y + def.h && y + h > building.y) return true;
  }
  return false;
}

function stamp(state: GameState, playerId: number, type: BuildingType, x: number, y: number): boolean {
  const def = BUILDINGS[type];
  if (x < 0 || y < 0 || x + def.w > state.mapW || y + def.h > state.mapH) return false;
  if (Math.abs(y - state.roadY) <= 1 || Math.abs(y + def.h - 1 - state.roadY) <= 1) return false;
  if (overlaps(state, x, y, def.w, def.h)) return false;
  createBuilding(state, playerId, type, x, y, true);
  return true;
}

/** A short wall, a gate and a tower on the side facing the player. Hand-placed, so the keep level does not matter. */
export function fortify(state: GameState, playerId: number) {
  const keep = playerKeep(state, playerId);
  if (!keep) return;
  setKeepLevel(state, playerId, 2);
  const cx = keep.x + 1;
  const cy = keep.y + 1;
  const player = playerKeep(state, 0);
  const dx = Math.sign((player?.x ?? cx) - cx);
  const dy = Math.sign((player?.y ?? cy) - cy);
  const ax = dx === 0 ? 1 : 0;
  const ay = dy === 0 ? 1 : 0;
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    stamp(state, playerId, 'palisade', cx + dx * 5 + ax * i, cy + dy * 5 + ay * i);
  }
  stamp(state, playerId, 'gate', cx + dx * 5, cy + dy * 5);
  stamp(state, playerId, 'woodtower', cx + dx * 5 + ax * 6, cy + dy * 5 + ay * 6);
  const tower = state.buildings.filter((b) => b.playerId === playerId && b.type === 'woodtower').at(-1);
  if (tower) {
    const archer = createSoldier(state, playerId, tower.x + 0.5, tower.y + 0.5, 'bow');
    archer.order = 'defend';
  }
}

export function addWolves(state: GameState, playerId: number) {
  const keep = playerKeep(state, playerId);
  if (!keep) return;
  const y = keep.y + Math.sign(state.roadY - keep.y) * 14;
  createMob(state, 'wolf', keep.x - 4, y);
  createMob(state, 'wolf', keep.x + 3, y);
  createMob(state, 'bear', keep.x + 8, y + 2);
}
