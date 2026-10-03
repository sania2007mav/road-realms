import { BUILDINGS } from './balance';
import type { GameState } from './types';

/** Open yards. Houses, the keep, and other roofed buildings block a soldier's steps. */
const OPEN = new Set(['wheat', 'hop', 'orchard', 'quarry', 'stockpile', 'pitch']);

export function tileBlocked(state: GameState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return true;
  for (const building of state.buildings) {
    if (building.hp <= 0 || OPEN.has(building.type)) continue;
    const def = BUILDINGS[building.type];
    if (x >= building.x && x < building.x + def.w && y >= building.y && y < building.y + def.h) return true;
  }
  return false;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.414],
  [1, -1, 1.414],
  [-1, 1, 1.414],
  [-1, -1, 1.414],
];

function nearestOpen(state: GameState, x: number, y: number): { x: number; y: number } | null {
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!tileBlocked(state, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/** Tile-centre waypoints from the soldier to the goal. Empty when no route is needed or none exists. */
export function findPath(state: GameState, fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] {
  const sx = Math.max(0, Math.min(state.mapW - 1, Math.floor(fromX)));
  const sy = Math.max(0, Math.min(state.mapH - 1, Math.floor(fromY)));
  let gx = Math.floor(toX);
  let gy = Math.floor(toY);
  if (tileBlocked(state, gx, gy)) {
    const alt = nearestOpen(state, gx, gy);
    if (!alt) return [];
    gx = alt.x;
    gy = alt.y;
  }
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];

  const key = (x: number, y: number) => y * state.mapW + x;
  const startK = key(sx, sy);
  const goalK = key(gx, gy);
  const gScore = new Map<number, number>([[startK, 0]]);
  const parent = new Map<number, number>();
  const open: number[] = [startK];
  const inOpen = new Set<number>([startK]);
  const closed = new Set<number>();
  const heur = (k: number) => {
    const x = k % state.mapW;
    const y = Math.floor(k / state.mapW);
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };

  let guard = 0;
  while (open.length && guard < 5000) {
    guard += 1;
    let bestI = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = (gScore.get(open[i]) ?? 1e9) + heur(open[i]);
      if (f < bestF || (f === bestF && open[i] < open[bestI])) {
        bestF = f;
        bestI = i;
      }
    }
    const current = open.splice(bestI, 1)[0];
    inOpen.delete(current);
    if (current === goalK) break;
    if (closed.has(current)) continue;
    closed.add(current);
    const cx = current % state.mapW;
    const cy = Math.floor(current / state.mapW);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const startTile = nx === sx && ny === sy;
      if (!startTile && tileBlocked(state, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (tileBlocked(state, cx + dx, cy) || tileBlocked(state, cx, cy + dy))) continue;
      const next = key(nx, ny);
      if (closed.has(next)) continue;
      const nextG = (gScore.get(current) ?? 1e9) + cost;
      if (nextG + 1e-9 >= (gScore.get(next) ?? 1e9)) continue;
      gScore.set(next, nextG);
      parent.set(next, current);
      if (!inOpen.has(next)) {
        open.push(next);
        inOpen.add(next);
      }
    }
  }

  if (!gScore.has(goalK)) return [];
  const rev: { x: number; y: number }[] = [];
  let cursor = goalK;
  const seen = new Set<number>();
  while (cursor !== startK && !seen.has(cursor)) {
    seen.add(cursor);
    rev.push({ x: (cursor % state.mapW) + 0.5, y: Math.floor(cursor / state.mapW) + 0.5 });
    const prev = parent.get(cursor);
    if (prev == null) return [];
    cursor = prev;
  }
  rev.reverse();
  return rev;
}
