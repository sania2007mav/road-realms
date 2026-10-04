import { BUILDINGS } from './balance';
import type { GameState } from './types';
import { Terrain } from './types';

/** Carriers and units move this much faster while the tile under them is a road. */
export const ROAD_MULT = 1.45;

export const ROAD_COST = { wood: 1 } as const;

export function onRoad(state: GameState, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= state.mapW || ty >= state.mapH) return false;
  const index = ty * state.mapW + tx;
  if (state.terrain[index] === Terrain.Road) return true;
  return (state.roads?.[index] ?? 0) === 1;
}

export function roadPace(state: GameState, x: number, y: number, speed: number): number {
  return onRoad(state, x, y) ? speed * ROAD_MULT : speed;
}

function tileFree(state: GameState, x: number, y: number): boolean {
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const def = BUILDINGS[building.type];
    if (x >= building.x && x < building.x + def.w && y >= building.y && y < building.y + def.h) return false;
  }
  return true;
}

/** Null when a dragged tile can take a road. Already-built roads are reported separately. */
export function roadError(state: GameState, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return 'Мимо карты';
  const index = y * state.mapW + x;
  const terrain = state.terrain[index];
  if (terrain === Terrain.Road) return 'Здесь уже тракт';
  if (terrain !== Terrain.Land && terrain !== Terrain.Desert && terrain !== Terrain.Oasis) return 'Дорогу кладут на обычную землю';
  if ((state.roads?.[index] ?? 0) === 1) return '';
  if (!tileFree(state, x, y)) return 'Здесь стоит постройка';
  return null;
}
