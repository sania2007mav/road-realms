import { describe, expect, it } from 'vitest';
import { TILE, clampCamera } from '../src/render/camera';

const mapW = 180 * TILE;
const mapH = 120 * TILE;

function viewRect(camera: { x: number; y: number; zoom: number }, viewW: number, viewH: number) {
  const halfW = viewW / (2 * camera.zoom);
  const halfH = viewH / (2 * camera.zoom);
  return { left: camera.x - halfW, right: camera.x + halfW, top: camera.y - halfH, bottom: camera.y + halfH };
}

describe('камера', () => {
  it('не показывает пустоту слева от карты, когда посад у западного края', () => {
    const camera = { x: 24.5 * TILE, y: 42.5 * TILE, zoom: 0.32 };
    clampCamera(camera, 1280, 800, mapW, mapH);
    const view = viewRect(camera, 1280, 800);
    expect(view.left).toBeGreaterThanOrEqual(-0.01);
    expect(view.right).toBeLessThanOrEqual(mapW + 0.01);
    expect(view.top).toBeGreaterThanOrEqual(-0.01);
    expect(view.bottom).toBeLessThanOrEqual(mapH + 0.01);
  });

  it('не даёт отдалиться дальше границ карты', () => {
    const camera = { x: mapW / 2, y: mapH / 2, zoom: 0.05 };
    clampCamera(camera, 1280, 800, mapW, mapH);
    const view = viewRect(camera, 1280, 800);
    expect(camera.zoom).toBeGreaterThanOrEqual(Math.max(1280 / mapW, 800 / mapH));
    expect(view.left).toBeGreaterThanOrEqual(-0.01);
    expect(view.right).toBeLessThanOrEqual(mapW + 0.01);
    expect(view.top).toBeGreaterThanOrEqual(-0.01);
    expect(view.bottom).toBeLessThanOrEqual(mapH + 0.01);
  });
});
