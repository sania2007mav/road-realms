export const TILE = 32;
export const ZOOM_MAX = 2.4;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export function focusTile(camera: Camera, tileX: number, tileY: number) {
  camera.x = (tileX + 0.5) * TILE;
  camera.y = (tileY + 0.5) * TILE;
}

/** Keeps the view rectangle inside the map. Zoom cannot pull back past the point where the map fills the window. */
export function clampCamera(camera: Camera, viewW: number, viewH: number, mapWpx: number, mapHpx: number) {
  if (viewW < 2 || viewH < 2 || mapWpx < 2 || mapHpx < 2) return;
  const minZoom = Math.max(viewW / mapWpx, viewH / mapHpx) * 1.002;
  camera.zoom = Math.min(ZOOM_MAX, Math.max(minZoom, camera.zoom));
  const halfW = viewW / (2 * camera.zoom);
  const halfH = viewH / (2 * camera.zoom);
  const slackX = mapWpx - halfW * 2;
  const slackY = mapHpx - halfH * 2;
  if (slackX <= 1) camera.x = mapWpx / 2;
  else camera.x = Math.min(mapWpx - halfW, Math.max(halfW, camera.x));
  if (slackY <= 1) camera.y = mapHpx / 2;
  else camera.y = Math.min(mapHpx - halfH, Math.max(halfH, camera.y));
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
