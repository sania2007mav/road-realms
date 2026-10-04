/** Cached building and terrain sprites. Quality is a render setting only. */

export type GfxQuality = 'high' | 'simple';

const KEY = 'dorozhnye-kraya-gfx';
const BUCKETS = [0.55, 0.75, 1, 1.15, 1.4, 1.75, 2.2, 2.8];

let quality: GfxQuality = 'high';

export function loadGfx() {
  try {
    quality = localStorage.getItem(KEY) === 'simple' ? 'simple' : 'high';
  } catch {
    quality = 'high';
  }
}

export function gfxHigh() {
  return quality === 'high';
}

export function gfxLabel() {
  return quality === 'high' ? 'Графика: высокая' : 'Графика: простая';
}

export function setGfx(next: GfxQuality): GfxQuality {
  quality = next === 'simple' ? 'simple' : 'high';
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    /* private mode */
  }
  clearSprites();
  return quality;
}

export function cycleGfx(): GfxQuality {
  return setGfx(quality === 'high' ? 'simple' : 'high');
}

export function zoomBucket(zoom: number) {
  let best = BUCKETS[0];
  let bestD = Infinity;
  const z = Math.max(0.05, zoom);
  for (const bucket of BUCKETS) {
    const d = Math.abs(Math.log(z / bucket));
    if (d < bestD) {
      bestD = d;
      best = bucket;
    }
  }
  return best;
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  minX: number;
  minY: number;
  worldW: number;
  worldH: number;
}

const cache = new Map<string, Sprite>();
let frameScale = 1;

export function clearSprites() {
  cache.clear();
}

/** Drop the cache when the zoom bucket or the device pixel ratio changes. */
export function noteGfxFrame(zoom: number, dpr: number) {
  const scale = zoomBucket(zoom) * dpr;
  if (scale !== frameScale) {
    cache.clear();
    frameScale = scale;
  }
}

export function renderSprite(
  key: string,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  draw: (ctx: CanvasRenderingContext2D) => void,
): Sprite {
  const hit = cache.get(key);
  if (hit) return hit;
  const worldW = Math.max(1, bounds.maxX - bounds.minX);
  const worldH = Math.max(1, bounds.maxY - bounds.minY);
  const canvas = document.createElement('canvas');
  const maxEdge = 2048;
  const scale = Math.min(frameScale, maxEdge / worldW, maxEdge / worldH);
  canvas.width = Math.max(1, Math.ceil(worldW * scale));
  canvas.height = Math.max(1, Math.ceil(worldH * scale));
  const ctx = canvas.getContext('2d');
  const sprite: Sprite = { canvas, minX: bounds.minX, minY: bounds.minY, worldW, worldH };
  if (!ctx) {
    cache.set(key, sprite);
    return sprite;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale);
  draw(ctx);
  cache.set(key, sprite);
  return sprite;
}

export function blitSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, ox: number, oy: number) {
  ctx.drawImage(sprite.canvas, ox + sprite.minX, oy + sprite.minY, sprite.worldW, sprite.worldH);
}
