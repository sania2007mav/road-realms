import { describe, expect, it } from 'vitest';
import { clampCamera, mapIsoBounds, screenToTile, tileToIso, worldToScreen } from '../src/render/camera';

function viewRect(camera: { x: number; y: number; zoom: number }, viewW: number, viewH: number) {
  const halfW = viewW / (2 * camera.zoom);
  const halfH = viewH / (2 * camera.zoom);
  return { left: camera.x - halfW, right: camera.x + halfW, top: camera.y - halfH, bottom: camera.y + halfH };
}

describe('изометрическая камера', () => {
  it('крутит клетку в экран и обратно', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const screen = worldToScreen(camera, 800, 600, 24.5, 42.5);
    const tile = screenToTile(camera, 800, 600, screen.x, screen.y);
    expect(tile).toEqual({ x: 24, y: 42 });
  });

  it('держит вид внутри ромба карты у западного посада', () => {
    const iso = tileToIso(24.5, 42.5);
    const camera = { x: iso.x, y: iso.y, zoom: 0.35 };
    clampCamera(camera, 1280, 800, 180, 120);
    const bounds = mapIsoBounds(180, 120);
    const view = viewRect(camera, 1280, 800);
    expect(view.left).toBeGreaterThanOrEqual(bounds.minX - 0.5);
    expect(view.right).toBeLessThanOrEqual(bounds.maxX + 0.5);
    expect(view.top).toBeGreaterThanOrEqual(bounds.minY - 0.5);
    expect(view.bottom).toBeLessThanOrEqual(bounds.maxY + 0.5);
  });

  it('не даёт отдалиться дальше ромба карты', () => {
    const bounds = mapIsoBounds(180, 120);
    const camera = { x: 0, y: 0, zoom: 0.05 };
    clampCamera(camera, 1280, 800, 180, 120);
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    expect(camera.zoom).toBeGreaterThanOrEqual(Math.max(1280 / spanX, 800 / spanY));
    const view = viewRect(camera, 1280, 800);
    expect(view.left).toBeGreaterThanOrEqual(bounds.minX - 0.5);
    expect(view.right).toBeLessThanOrEqual(bounds.maxX + 0.5);
    expect(view.top).toBeGreaterThanOrEqual(bounds.minY - 0.5);
    expect(view.bottom).toBeLessThanOrEqual(bounds.maxY + 0.5);
  });
});
