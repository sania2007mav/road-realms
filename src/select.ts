import { worldToScreen, type Camera } from './render/camera';

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Own living soldiers whose feet fall inside a screen rectangle. Workers are not in this list. */
export function soldiersInScreenRect(
  soldiers: { id: number; playerId: number; x: number; y: number; hp: number }[],
  camera: Camera,
  viewW: number,
  viewH: number,
  rect: ScreenRect,
  playerId: number,
): number[] {
  const left = Math.min(rect.left, rect.right);
  const right = Math.max(rect.left, rect.right);
  const top = Math.min(rect.top, rect.bottom);
  const bottom = Math.max(rect.top, rect.bottom);
  const ids: number[] = [];
  for (const soldier of soldiers) {
    if (soldier.playerId !== playerId || soldier.hp <= 0) continue;
    const point = worldToScreen(camera, viewW, viewH, soldier.x, soldier.y);
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) ids.push(soldier.id);
  }
  ids.sort((a, b) => a - b);
  return ids;
}
