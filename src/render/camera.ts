/** Diamond tiles, 2:1. Camera x/y is the iso-space point kept at the centre of the view. */
export const TILE_W = 64;
export const TILE_H = 32;
export const ZOOM_MAX = 2.6;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface IsoBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function tileToIso(tileX: number, tileY: number) {
  return {
    x: (tileX - tileY) * (TILE_W / 2),
    y: (tileX + tileY) * (TILE_H / 2),
  };
}

export function isoToTile(isoX: number, isoY: number) {
  const a = isoX / (TILE_W / 2);
  const b = isoY / (TILE_H / 2);
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

export function mapIsoBounds(mapW: number, mapH: number): IsoBounds {
  const pts = [tileToIso(0, 0), tileToIso(mapW, 0), tileToIso(0, mapH), tileToIso(mapW, mapH)];
  const padX = TILE_W;
  const padTop = TILE_H * 3;
  const padBottom = TILE_H;
  return {
    minX: Math.min(...pts.map((p) => p.x)) - padX,
    maxX: Math.max(...pts.map((p) => p.x)) + padX,
    minY: Math.min(...pts.map((p) => p.y)) - padTop,
    maxY: Math.max(...pts.map((p) => p.y)) + padBottom,
  };
}

export function focusTile(camera: Camera, tileX: number, tileY: number) {
  const iso = tileToIso(tileX + 0.5, tileY + 0.5);
  camera.x = iso.x;
  camera.y = iso.y;
}

/** Keeps the view inside the iso map. Zoom cannot pull back past the point where the map fills the window. */
export function clampCamera(camera: Camera, viewW: number, viewH: number, mapW: number, mapH: number) {
  if (viewW < 2 || viewH < 2 || mapW < 2 || mapH < 2) return;
  const bounds = mapIsoBounds(mapW, mapH);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const minZoom = Math.max(viewW / spanX, viewH / spanY) * 1.002;
  camera.zoom = Math.min(ZOOM_MAX, Math.max(minZoom, camera.zoom));
  const halfW = viewW / (2 * camera.zoom);
  const halfH = viewH / (2 * camera.zoom);
  const slackX = spanX - halfW * 2;
  const slackY = spanY - halfH * 2;
  if (slackX <= 1) camera.x = (bounds.minX + bounds.maxX) / 2;
  else camera.x = Math.min(bounds.maxX - halfW, Math.max(bounds.minX + halfW, camera.x));
  if (slackY <= 1) camera.y = (bounds.minY + bounds.maxY) / 2;
  else camera.y = Math.min(bounds.maxY - halfH, Math.max(bounds.minY + halfH, camera.y));
}

export function worldToScreen(camera: Camera, viewW: number, viewH: number, tileX: number, tileY: number) {
  const iso = tileToIso(tileX, tileY);
  return {
    x: (iso.x - camera.x) * camera.zoom + viewW / 2,
    y: (iso.y - camera.y) * camera.zoom + viewH / 2,
  };
}

export function screenToWorld(camera: Camera, viewW: number, viewH: number, screenX: number, screenY: number) {
  const isoX = (screenX - viewW / 2) / camera.zoom + camera.x;
  const isoY = (screenY - viewH / 2) / camera.zoom + camera.y;
  return isoToTile(isoX, isoY);
}

export function screenToTile(camera: Camera, viewW: number, viewH: number, screenX: number, screenY: number) {
  const world = screenToWorld(camera, viewW, viewH, screenX, screenY);
  return { x: Math.floor(world.x), y: Math.floor(world.y) };
}

export function screenToIso(camera: Camera, viewW: number, viewH: number, screenX: number, screenY: number) {
  return {
    x: (screenX - viewW / 2) / camera.zoom + camera.x,
    y: (screenY - viewH / 2) / camera.zoom + camera.y,
  };
}
