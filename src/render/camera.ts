export const TILE = 32;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function focusTile(camera: Camera, tileX: number, tileY: number) {
  camera.x = (tileX + 0.5) * TILE;
  camera.y = (tileY + 0.5) * TILE;
}

export function worldToScreen(camera: Camera, viewW: number, viewH: number, worldX: number, worldY: number) {
  return {
    x: (worldX - camera.x) * camera.zoom + viewW / 2,
    y: (worldY - camera.y) * camera.zoom + viewH / 2,
  };
}

export function screenToWorld(camera: Camera, viewW: number, viewH: number, screenX: number, screenY: number) {
  return {
    x: (screenX - viewW / 2) / camera.zoom + camera.x,
    y: (screenY - viewH / 2) / camera.zoom + camera.y,
  };
}

export function screenToTile(camera: Camera, viewW: number, viewH: number, screenX: number, screenY: number) {
  const world = screenToWorld(camera, viewW, viewH, screenX, screenY);
  return { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
}
