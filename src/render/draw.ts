import { BUILDINGS } from '../sim/balance';
import { hash2 } from '../sim/rng';
import type { Building, BuildingType, GameState, Mob, Person, Resource } from '../sim/types';
import { Terrain } from '../sim/types';
import { buildingWarning, workRange } from '../sim/update';
import { terrainAt } from '../sim/world';
import { TILE_H, TILE_W, isoToTile, mapIsoBounds, screenToIso, tileToIso, type Camera } from './camera';
import { blitSprite, gfxHigh, noteGfxFrame, renderSprite } from './gfx';

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  ok: boolean;
}

export interface OrderMarker {
  kind: 'move' | 'attack';
  x: number;
  y: number;
  born: number;
}

export interface BattleOverlay {
  selected: ReadonlySet<number>;
  box: { x: number; y: number; w: number; h: number } | null;
  markers: readonly OrderMarker[];
}

type PropKind = 'forest' | 'lime' | 'iron' | 'swamp';

export interface TerrainBake {
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
  /** Bake is stored at this fraction of iso pixels so the bitmap stays under mobile canvas limits. */
  scale: number;
  props: { x: number; y: number; kind: PropKind }[];
}

const CARGO: Partial<Record<Resource, string>> = {
  wood: '#8a5a32',
  stone: '#d9d3c6',
  iron: '#9a4e32',
  pitch: '#1a1a1a',
  apples: '#d6453c',
  cheese: '#f2d15a',
  meat: '#a33b3b',
  bread: '#e0a15a',
  wheat: '#e6c84a',
  flour: '#f4efe2',
  hops: '#6a8f3a',
  beer: '#e0a11b',
};

type Pt = { x: number; y: number };

const lastPos = new WeakMap<object, { x: number; y: number }>();

function moving(ent: { x: number; y: number }): boolean {
  const prev = lastPos.get(ent);
  lastPos.set(ent, { x: ent.x, y: ent.y });
  if (!prev) return false;
  return Math.abs(prev.x - ent.x) > 0.0015 || Math.abs(prev.y - ent.y) > 0.0015;
}

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function rgb(r: number, g: number, b: number) {
  return `rgb(${r},${g},${b})`;
}

function smoothNoise(seed: number, x: number, y: number): number {
  const cell = 12;
  const x0 = Math.floor(x / cell);
  const y0 = Math.floor(y / cell);
  const fx = x / cell - x0;
  const fy = y / cell - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sample = (ix: number, iy: number) => (hash2(seed, ix, iy) % 1000) / 999;
  const a = sample(x0, y0) * (1 - sx) + sample(x0 + 1, y0) * sx;
  const b = sample(x0, y0 + 1) * (1 - sx) + sample(x0 + 1, y0 + 1) * sx;
  return a * (1 - sy) + b * sy;
}

function groundColor(state: GameState, x: number, y: number): string {
  const terrain = terrainAt(state, x, y);
  const dune = smoothNoise(state.seed, x, y);
  let r = 214;
  let g = 196;
  let b = 150;
  if (terrain === Terrain.Desert) {
    r = 222;
    g = 198;
    b = 142;
  } else if (terrain === Terrain.Land) {
    r = 206;
    g = 184;
    b = 128;
  } else if (terrain === Terrain.Oasis) {
    r = 78;
    g = 146;
    b = 74;
  } else if (terrain === Terrain.Forest) {
    r = 154;
    g = 132;
    b = 78;
  } else if (terrain === Terrain.Limestone) {
    r = 198;
    g = 192;
    b = 176;
  } else if (terrain === Terrain.Iron) {
    r = 148;
    g = 92;
    b = 68;
  } else if (terrain === Terrain.Swamp) {
    r = 46;
    g = 58;
    b = 44;
  } else if (terrain === Terrain.Road) {
    const edge = y === state.roadY - 1 || y === state.roadY + 1;
    r = edge ? 132 : 176;
    g = edge ? 96 : 132;
    b = edge ? 58 : 78;
  }
  let oasis = 0;
  let sand = 0;
  let forest = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const near = terrainAt(state, x + dx, y + dy);
      const weight = dx * dx + dy * dy <= 2 ? 1 : 0.45;
      if (near === Terrain.Oasis) oasis += weight;
      if (near === Terrain.Desert || near === Terrain.Land) sand += weight;
      if (near === Terrain.Forest) forest += weight;
    }
  }
  if (terrain === Terrain.Oasis && sand) {
    const t = Math.min(0.62, sand / 18);
    r = mix(r, 196, t);
    g = mix(g, 176, t);
    b = mix(b, 118, t);
  } else if ((terrain === Terrain.Land || terrain === Terrain.Desert) && (oasis || forest)) {
    const t = Math.min(0.5, (oasis + forest * 0.35) / 10);
    r = mix(r, 96, t);
    g = mix(g, 142, t);
    b = mix(b, 78, t);
  }
  const wobble = Math.round((dune - 0.5) * 16);
  return rgb(r + wobble, g + Math.round(wobble * 0.85), b + Math.round(wobble * 0.45));
}

const BAKE_SCALE = 0.25;

export function bakeTerrain(state: GameState): TerrainBake {
  const originX = state.mapH * (TILE_W / 2) + 8;
  const originY = TILE_H * 3;
  const isoW = (state.mapW + state.mapH) * (TILE_W / 2) + 16;
  const isoH = (state.mapW + state.mapH) * (TILE_H / 2) + originY + TILE_H;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(isoW * BAKE_SCALE));
  canvas.height = Math.max(1, Math.ceil(isoH * BAKE_SCALE));
  const props: TerrainBake['props'] = [];
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, originX, originY, scale: BAKE_SCALE, props };
  ctx.setTransform(BAKE_SCALE, 0, 0, BAKE_SCALE, originX * BAKE_SCALE, originY * BAKE_SCALE);
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      fillDiamond(ctx, x, y, groundColor(state, x, y), 2 / BAKE_SCALE);
      const terrain = terrainAt(state, x, y);
      if (gfxHigh()) bakeSpeck(ctx, state.seed, x, y, terrain);
      if (terrain === Terrain.Forest) props.push({ x, y, kind: 'forest' });
      else if (terrain === Terrain.Limestone) props.push({ x, y, kind: 'lime' });
      else if (terrain === Terrain.Iron) props.push({ x, y, kind: 'iron' });
      else if (terrain === Terrain.Swamp) props.push({ x, y, kind: 'swamp' });
    }
  }
  return { canvas, originX, originY, scale: BAKE_SCALE, props };
}

function diamond(x: number, y: number, w: number, h: number): Pt[] {
  return [tileToIso(x, y), tileToIso(x + w, y), tileToIso(x + w, y + h), tileToIso(x, y + h)];
}

function fillDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, seam = 1.4) {
  poly(ctx, diamond(x, y, 1, 1), color);
  const width = ctx.lineWidth;
  ctx.strokeStyle = color;
  ctx.lineWidth = seam;
  ctx.stroke();
  ctx.lineWidth = width;
}

function tileSpan(camera: Camera, viewW: number, viewH: number, mapW: number, mapH: number, margin: number) {
  const halfW = viewW / (2 * camera.zoom) + margin;
  const halfH = viewH / (2 * camera.zoom) + margin;
  const pts = [
    isoToTile(camera.x - halfW, camera.y - halfH),
    isoToTile(camera.x + halfW, camera.y - halfH),
    isoToTile(camera.x - halfW, camera.y + halfH),
    isoToTile(camera.x + halfW, camera.y + halfH),
  ];
  return {
    minX: Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))) - 1),
    maxX: Math.min(mapW, Math.ceil(Math.max(...pts.map((p) => p.x))) + 1),
    minY: Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))) - 1),
    maxY: Math.min(mapH, Math.ceil(Math.max(...pts.map((p) => p.y))) + 1),
  };
}

function poly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function lift(p: Pt, h: number): Pt {
  return { x: p.x, y: p.y - h };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

type WallMat = 'plank' | 'log' | 'plaster' | 'brick' | 'stone' | 'corrugated' | 'concrete';
type RoofMat = 'thatch' | 'shingle' | 'tile' | 'tin' | 'slab';

let caching = false;
let paintingSprite = false;
let forcedGrow = -1;

function buildNeed(building: Building) {
  if (building.upgrading) return 220;
  return BUILDINGS[building.type].buildTicks || 1;
}

function buildGrow(building: Building) {
  if (forcedGrow >= 0) return forcedGrow;
  if (building.complete && !building.upgrading) return 1;
  const t = Math.max(0, Math.min(1, building.buildProgress / buildNeed(building)));
  return 0.2 + t * 0.72;
}

function buildStage(building: Building) {
  if (building.complete && !building.upgrading) return 8;
  const t = Math.max(0, Math.min(0.999, building.buildProgress / buildNeed(building)));
  return Math.floor(t * 8);
}

function growForStage(stage: number) {
  if (stage >= 8) return 1;
  return 0.2 + ((stage + 0.5) / 8) * 0.72;
}

function clipPts(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
}

function dressFace(ctx: CanvasRenderingContext2D, gA: Pt, gB: Pt, tA: Pt, tB: Pt, mat: WallMat, light: boolean) {
  ctx.save();
  clipPts(ctx, [gA, gB, tB, tA]);
  const rows = mat === 'log' ? 5 : mat === 'corrugated' ? 8 : mat === 'concrete' ? 4 : mat === 'plaster' ? 2 : 6;
  ctx.lineWidth = mat === 'corrugated' ? 1.5 : 1;
  for (let i = 1; i < rows; i++) {
    const t = i / rows;
    const a = lerp(gA, tA, t);
    const b = lerp(gB, tB, t);
    ctx.strokeStyle = light ? 'rgba(255,248,230,0.22)' : 'rgba(0,0,0,0.2)';
    if (mat === 'log' || mat === 'corrugated') ctx.strokeStyle = light ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (mat === 'brick' || mat === 'stone' || mat === 'concrete' || mat === 'plank') {
    const cols = mat === 'concrete' ? 3 : 5;
    ctx.strokeStyle = 'rgba(40,28,18,0.38)';
    ctx.lineWidth = 1;
    for (let row = 0; row < rows; row++) {
      const y0 = row / rows;
      const y1 = (row + 1) / rows;
      const shift = mat === 'concrete' ? 0 : row % 2 === 0 ? 0 : 0.5;
      for (let c = 0; c < cols; c++) {
        const u = (c + shift) / cols;
        if (u <= 0 || u >= 1) continue;
        const a = lerp(lerp(gA, gB, u), lerp(tA, tB, u), y0);
        const b = lerp(lerp(gA, gB, u), lerp(tA, tB, u), y1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  if (mat === 'plaster') {
    ctx.strokeStyle = 'rgba(70,50,36,0.55)';
    ctx.lineWidth = 1;
    const a = lerp(lerp(gA, gB, 0.28), lerp(tA, tB, 0.28), 0.25);
    const b = lerp(lerp(gA, gB, 0.46), lerp(tA, tB, 0.46), 0.7);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + 3, (a.y + b.y) / 2);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  if (light) {
    ctx.strokeStyle = 'rgba(255,248,230,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tA.x, tA.y);
    ctx.lineTo(tB.x, tB.y);
    ctx.stroke();
  }
  ctx.restore();
}

function dressRoof(ctx: CanvasRenderingContext2D, quad: Pt[], kind: RoofMat) {
  if (!gfxHigh() || quad.length < 4) return;
  ctx.save();
  clipPts(ctx, quad);
  const rows = kind === 'tin' ? 6 : kind === 'thatch' ? 9 : 7;
  ctx.strokeStyle = kind === 'thatch' ? 'rgba(92,62,24,0.45)' : kind === 'tin' ? 'rgba(255,255,255,0.28)' : 'rgba(40,18,14,0.4)';
  ctx.lineWidth = 1;
  for (let i = 1; i < rows; i++) {
    const t = i / rows;
    const a = lerp(quad[0], quad[3], t);
    const b = lerp(quad[1], quad[2], t);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (kind === 'tile' || kind === 'shingle' || kind === 'thatch') {
      for (let c = 0; c < 5; c++) {
        const u = (c + (i % 2) * 0.5) / 5;
        if (u <= 0 || u >= 1) continue;
        const p = lerp(a, b, u);
        const q = lerp(lerp(quad[0], quad[3], (i - 1) / rows), lerp(quad[1], quad[2], (i - 1) / rows), u);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgba(255,244,220,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  ctx.lineTo(quad[1].x, quad[1].y);
  ctx.stroke();
  ctx.restore();
}

function flatRoof(box: { n: Pt; e: Pt; s: Pt; west: Pt }, wall: number): Pt[] {
  return [lift(box.n, wall), lift(box.e, wall), lift(box.s, wall), lift(box.west, wall)];
}

function paintStamp(ctx: CanvasRenderingContext2D, terrain: number, variant: number) {
  const pts = diamond(0, 0, 1, 1);
  ctx.save();
  clipPts(ctx, pts);
  const n = (i: number) => hash2(variant + 11, i, terrain + 3);
  const at = (i: number, salt: number) => {
    const u = 0.12 + (n(i + salt) % 76) / 100;
    const v = 0.12 + (n(i + salt + 9) % 76) / 100;
    return lerp(lerp(pts[0], pts[1], u), lerp(pts[3], pts[2], u), v);
  };
  if (terrain === Terrain.Desert || terrain === Terrain.Land) {
    for (let i = 0; i < 20; i++) {
      const p = at(i, 1);
      ctx.fillStyle = i % 4 === 0 ? 'rgba(110,82,48,0.35)' : 'rgba(255,244,214,0.32)';
      ctx.fillRect(p.x, p.y, 1.3, 1.3);
    }
    ctx.fillStyle = '#8d7352';
    for (let i = 0; i < 3; i++) {
      const p = at(i, 40);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 1.7, 1.1, (i - 1) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(150,110,64,0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      const a = lerp(pts[3], pts[0], 0.28 + i * 0.28);
      const b = lerp(pts[2], pts[1], 0.28 + i * 0.28);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 1.5, b.x, b.y);
      ctx.stroke();
    }
  } else if (terrain === Terrain.Oasis) {
    ctx.strokeStyle = '#2c6e38';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      const p = at(i, 2);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 1.2, p.y - 4);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 1.6, p.y - 3.2);
      ctx.stroke();
    }
    const colors = ['#e6d15a', '#e07a8a', '#f4f4f4', '#7eb6e0'];
    for (let i = 0; i < 3; i++) {
      const p = at(i, 60);
      ctx.fillStyle = colors[(variant + i) % colors.length];
      ctx.beginPath();
      ctx.arc(p.x, p.y - 1, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (terrain === Terrain.Road) {
    ctx.strokeStyle = 'rgba(58,38,18,0.5)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    const r1a = lerp(pts[0], pts[3], 0.36);
    const r1b = lerp(pts[1], pts[2], 0.36);
    const r2a = lerp(pts[0], pts[3], 0.64);
    const r2b = lerp(pts[1], pts[2], 0.64);
    ctx.moveTo(r1a.x, r1a.y);
    ctx.lineTo(r1b.x, r1b.y);
    ctx.moveTo(r2a.x, r2a.y);
    ctx.lineTo(r2b.x, r2b.y);
    ctx.stroke();
    ctx.fillStyle = '#6a543c';
    for (let i = 0; i < 3; i++) {
      const p = lerp(pts[0], pts[1], 0.18 + i * 0.28);
      const q = lerp(pts[3], pts[2], 0.22 + i * 0.26);
      ctx.fillRect(p.x - 1, p.y - 1, 2.4, 1.8);
      ctx.fillRect(q.x - 1, q.y - 1, 2.4, 1.8);
    }
  } else if (terrain === Terrain.Forest) {
    ctx.fillStyle = 'rgba(40,70,28,0.28)';
    for (let i = 0; i < 8; i++) {
      const p = at(i, 4);
      ctx.fillRect(p.x, p.y, 1.6, 1.6);
    }
  } else if (terrain === Terrain.Limestone) {
    ctx.strokeStyle = 'rgba(90,84,74,0.55)';
    ctx.lineWidth = 1;
    const a = at(1, 5);
    const b = at(2, 6);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 + 2);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (terrain === Terrain.Iron) {
    ctx.strokeStyle = '#c45a32';
    ctx.lineWidth = 1.4;
    const a = at(1, 7);
    const b = at(2, 8);
    const c = at(3, 9);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.fillStyle = '#e07a32';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (terrain === Terrain.Swamp) {
    ctx.fillStyle = 'rgba(8,10,8,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 12, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(210,220,190,0.2)';
    ctx.beginPath();
    ctx.ellipse(-3, 14, 5, 1.6, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function groundStamp(terrain: number, variant: number) {
  return renderSprite(`g|${terrain}|${variant}`, { minX: -36, minY: -4, maxX: 36, maxY: 36 }, (ctx) => {
    paintStamp(ctx, terrain, variant);
  });
}

function bakeSpeck(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, terrain: number) {
  const o = tileToIso(x + 0.5, y + 0.5);
  const n = hash2(seed, x, y);
  if (terrain === Terrain.Oasis) ctx.fillStyle = 'rgba(36,96,40,0.55)';
  else if (terrain === Terrain.Road) ctx.fillStyle = 'rgba(40,24,12,0.45)';
  else if (terrain === Terrain.Swamp) ctx.fillStyle = 'rgba(200,210,180,0.35)';
  else if (terrain === Terrain.Iron) ctx.fillStyle = 'rgba(180,70,40,0.45)';
  else ctx.fillStyle = 'rgba(255,244,214,0.28)';
  ctx.fillRect(o.x + (n % 9) - 4, o.y + ((n >> 4) % 7) - 3, 1.6, 1.6);
}

function seen(camera: Camera, viewW: number, viewH: number, x: number, y: number, margin = 80) {
  const iso = tileToIso(x, y);
  const left = camera.x - viewW / (2 * camera.zoom) - margin;
  const right = camera.x + viewW / (2 * camera.zoom) + margin;
  const top = camera.y - viewH / (2 * camera.zoom) - margin;
  const bottom = camera.y + viewH / (2 * camera.zoom) + margin;
  return iso.x >= left && iso.x <= right && iso.y >= top && iso.y <= bottom;
}

/** Front-centre of a footprint. Units south of this draw in front; units north draw behind. */
function anchorDepth(x: number, y: number, w = 0, h = 0) {
  return x + w / 2 + (y + h);
}

function unitDepth(state: GameState, x: number, y: number) {
  let depth = x + y + 0.02;
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const def = BUILDINGS[building.type];
    const inside =
      x >= building.x - 0.15 &&
      x <= building.x + def.w + 0.15 &&
      y >= building.y - 0.15 &&
      y <= building.y + def.h + 0.35;
    if (!inside) continue;
    const front = building.y + def.h * 0.48;
    if (y >= front) depth = Math.max(depth, anchorDepth(building.x, building.y, def.w, def.h) + 0.35);
  }
  return depth;
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewW: number,
  viewH: number,
  dpr: number,
  baked: TerrainBake,
  ghost: Ghost | null,
  selectedId: number | null,
  time: number,
  selectedPersonId: number | null = null,
  overlay: BattleOverlay | null = null,
) {
  noteGfxFrame(camera.zoom, dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#241c16';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(
    dpr * camera.zoom,
    0,
    0,
    dpr * camera.zoom,
    dpr * (viewW / 2 - camera.x * camera.zoom),
    dpr * (viewH / 2 - camera.y * camera.zoom),
  );
  const span = tileSpan(camera, viewW, viewH, state.mapW, state.mapH, 48);
  const close = camera.zoom >= 0.5;
  ctx.imageSmoothingEnabled = !close;
  if (!close) {
    ctx.drawImage(
      baked.canvas,
      -baked.originX,
      -baked.originY,
      baked.canvas.width / baked.scale,
      baked.canvas.height / baked.scale,
    );
  } else {
    for (let y = span.minY; y < span.maxY; y++) {
      for (let x = span.minX; x < span.maxX; x++) {
        fillDiamond(ctx, x, y, groundColor(state, x, y));
        if (!gfxHigh()) continue;
        const variant = hash2(state.seed, x, y) % 4;
        const stamp = groundStamp(terrainAt(state, x, y), variant);
        const origin = tileToIso(x, y);
        blitSprite(ctx, stamp, origin.x, origin.y);
      }
    }
  }

  type Sprite = { depth: number; draw: () => void };
  const sprites: Sprite[] = [];

  for (const prop of baked.props) {
    if (prop.x < span.minX || prop.x >= span.maxX || prop.y < span.minY || prop.y >= span.maxY) continue;
    const depth = anchorDepth(prop.x, prop.y, 1, 1) - 0.02;
    if (prop.kind === 'forest') sprites.push({ depth, draw: () => drawForestClump(ctx, state.seed, prop.x, prop.y) });
    else if (prop.kind === 'lime') sprites.push({ depth, draw: () => drawBoulders(ctx, state.seed, prop.x, prop.y, 'lime') });
    else if (prop.kind === 'iron') sprites.push({ depth, draw: () => drawBoulders(ctx, state.seed, prop.x, prop.y, 'iron') });
    else sprites.push({ depth, draw: () => drawMarsh(ctx, state.seed, prop.x, prop.y) });
  }

  for (const building of state.buildings) {
    if (building.hp <= 0 && building.type !== 'keep') continue;
    const def = BUILDINGS[building.type];
    if (!seen(camera, viewW, viewH, building.x + def.w / 2, building.y + def.h / 2, 120)) continue;
    const selected = selectedId === building.id;
    const wall = wallHeight(building);
    if (building.type === 'orchard') {
      sprites.push({
        depth: building.x + building.y - 0.5,
        draw: () => {
          ctx.save();
          if (!building.complete && !gfxHigh()) ctx.globalAlpha = 0.82;
          poly(ctx, diamond(building.x, building.y, def.w, def.h), '#3f8d48');
          if (gfxHigh()) paintOrchardFloor(ctx, building.x, building.y, def.w, def.h);
          if (gfxHigh() && !building.complete) drawScaffold(ctx, building.x, building.y, def.w, def.h, wall);
          ctx.restore();
        },
      });
      const apples = gfxHigh() || Math.floor(time / 400) % 2 === 0;
      for (let row = 0; row < def.h; row++) {
        for (let col = 0; col < def.w; col++) {
          if ((row + col) % 2 === 1 && def.w > 2) continue;
          const tx = building.x + col + 0.15;
          const ty = building.y + row + 0.1;
          sprites.push({ depth: anchorDepth(tx, ty, 0.7, 0.7), draw: () => drawTree(ctx, tx, ty, apples) });
        }
      }
    } else {
      const flat = building.type === 'wheat' || building.type === 'hop' || building.type === 'quarry' || building.type === 'stockpile' || building.type === 'pitch';
      sprites.push({
        depth: flat ? building.x + building.y - 0.4 : anchorDepth(building.x, building.y, def.w, def.h),
        draw: () => drawBuilding(ctx, building, time),
      });
    }
    sprites.push({
      depth: anchorDepth(building.x, building.y, def.w, def.h) + 0.55,
      draw: () => markBuilding(ctx, state, building, wall, selected),
    });
  }
  if (ghost) {
    const def = BUILDINGS[ghost.type];
    sprites.push({
      depth: anchorDepth(ghost.x, ghost.y, def.w, def.h) + 0.01,
      draw: () => drawGhost(ctx, ghost),
    });
  }
  for (const mob of state.mobs) {
    if (!mob.alive || !seen(camera, viewW, viewH, mob.x, mob.y)) continue;
    sprites.push({ depth: unitDepth(state, mob.x, mob.y), draw: () => drawMob(ctx, mob, moving(mob), time) });
  }
  for (const ox of state.oxen) {
    if (!seen(camera, viewW, viewH, ox.x, ox.y)) continue;
    sprites.push({ depth: unitDepth(state, ox.x, ox.y), draw: () => drawOx(ctx, ox.x, ox.y, moving(ox), time, ox.cargo) });
  }
  for (const person of state.people) {
    if (person.hp <= 0 || !seen(camera, viewW, viewH, person.x, person.y)) continue;
    sprites.push({
      depth: unitDepth(state, person.x, person.y),
      draw: () => drawPerson(ctx, state, person, moving(person), time, person.id === selectedPersonId),
    });
  }
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || !seen(camera, viewW, viewH, soldier.x, soldier.y)) continue;
    const color = state.players[soldier.playerId]?.color ?? '#eee';
    const picked = overlay?.selected.has(soldier.id) ?? false;
    sprites.push({
      depth: unitDepth(state, soldier.x, soldier.y),
      draw: () => {
        if (picked) drawFeetRing(ctx, soldier.x, soldier.y);
        drawFigure(ctx, soldier.x, soldier.y, color, moving(soldier), time, soldier.weapon === 'sword' ? 'sword' : 'club', null, false);
        if (picked) drawHpBar(ctx, soldier.x, soldier.y, soldier.maxHp > 0 ? soldier.hp / soldier.maxHp : 0);
      },
    });
  }
  sprites.sort((a, b) => a.depth - b.depth);
  for (const sprite of sprites) sprite.draw();
  if (overlay) {
    for (const marker of overlay.markers) drawOrderMarker(ctx, marker, time);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (overlay?.box) drawSelectBox(ctx, overlay.box);
}

function drawFeetRing(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const p = tileToIso(tx, ty);
  ctx.strokeStyle = '#fff4d2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, 12, 5.5, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHpBar(ctx: CanvasRenderingContext2D, tx: number, ty: number, ratio: number) {
  const p = tileToIso(tx, ty);
  const width = 16;
  const x = p.x - width / 2;
  const y = p.y - 36;
  ctx.fillStyle = 'rgba(12, 8, 6, 0.55)';
  ctx.fillRect(x - 1, y - 1, width + 2, 5);
  ctx.fillStyle = ratio <= 0.35 ? '#e15b45' : '#8dce67';
  ctx.fillRect(x, y, width * Math.max(0, Math.min(1, ratio)), 3);
}

function drawOrderMarker(ctx: CanvasRenderingContext2D, marker: OrderMarker, time: number) {
  const age = time - marker.born;
  const alpha = Math.max(0, 1 - age / 1400);
  if (alpha <= 0) return;
  const p = tileToIso(marker.x, marker.y);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (marker.kind === 'move') {
    ctx.strokeStyle = '#7dce6a';
    ctx.fillStyle = '#7dce6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 28);
    ctx.lineTo(p.x + 14, p.y - 20);
    ctx.lineTo(p.x, p.y - 12);
    ctx.closePath();
    ctx.fill();
  } else {
    const grow = 1 + (age / 1400) * 0.45;
    ctx.strokeStyle = '#e15b45';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 58 * grow, 28 * grow, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 24 * grow, 12 * grow, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectBox(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }) {
  const x = Math.min(box.x, box.x + box.w);
  const y = Math.min(box.y, box.y + box.h);
  const w = Math.abs(box.w);
  const h = Math.abs(box.h);
  ctx.save();
  ctx.fillStyle = 'rgba(242, 231, 201, 0.22)';
  ctx.fillRect(x, y, w, h);
  ctx.setLineDash([8, 5]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20, 14, 10, 0.85)';
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff4d2';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawVolume(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  wall: number,
  front: string,
  side: string,
  roof: string,
  door: boolean,
  mat?: WallMat,
) {
  const n = tileToIso(x, y);
  const e = tileToIso(x + w, y);
  const s = tileToIso(x + w, y + h);
  const west = tileToIso(x, y + h);
  const rich = gfxHigh();
  ctx.fillStyle = rich ? 'rgba(20,14,10,0.2)' : 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + 6, (w + h) * (rich ? 12 : 10), (w + h) * (rich ? 5 : 4), 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [e, s, lift(s, wall), lift(e, wall)], side);
  poly(ctx, [west, s, lift(s, wall), lift(west, wall)], front);
  poly(ctx, [lift(n, wall), lift(e, wall), lift(s, wall), lift(west, wall)], roof);
  if (rich && mat) {
    dressFace(ctx, west, s, lift(west, wall), lift(s, wall), mat, true);
    dressFace(ctx, e, s, lift(e, wall), lift(s, wall), mat, false);
    ctx.strokeStyle = 'rgba(20,14,10,0.32)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(west.x, west.y - 1);
    ctx.lineTo(s.x, s.y - 1);
    ctx.lineTo(e.x, e.y - 1);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,248,230,0.4)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(lift(n, wall).x, lift(n, wall).y);
    ctx.lineTo(lift(west, wall).x, lift(west, wall).y);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (door) {
    const a = lerp(west, s, 0.4);
    const b = lerp(west, s, 0.6);
    poly(ctx, [a, b, lift(b, wall * 0.52), lift(a, wall * 0.52)], '#3a2418');
    if (rich) {
      ctx.strokeStyle = '#c4a574';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x + 1, a.y - wall * 0.16);
      ctx.lineTo(b.x - 1, b.y - wall * 0.16);
      ctx.stroke();
      ctx.fillStyle = '#8d877c';
      ctx.fillRect(a.x - 1, a.y - wall * 0.4, 2, 2);
      ctx.fillRect(a.x - 1, a.y - wall * 0.22, 2, 2);
      ctx.fillStyle = '#e6b15a';
      ctx.fillRect(b.x - 3, b.y - wall * 0.28, 2, 2);
    }
  }
  return { n, e, s, west, wall };
}

function pane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (!gfxHigh()) {
    ctx.fillStyle = '#9fd4ea';
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.fillStyle = '#2a241c';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#b7e3f2';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(x, y, Math.max(1, w * 0.38), Math.max(1, h * 0.32));
}

function windows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, rows: number, cols: number) {
  const west = tileToIso(x, y + h);
  const south = tileToIso(x + w, y + h);
  const east = tileToIso(x + w, y);
  const pw = gfxHigh() ? 5 : 4;
  const ph = gfxHigh() ? 4 : 3;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = (col + 1) / (cols + 1);
      const base = lerp(west, south, t);
      const yy = base.y - wall * ((row + 1) / (rows + 1.4));
      pane(ctx, base.x - 2, yy, pw, ph);
      const side = lerp(south, east, t);
      pane(ctx, side.x - 2, side.y - wall * ((row + 1) / (rows + 1.4)), Math.max(3, pw - 1), ph);
    }
  }
}

function markBuilding(ctx: CanvasRenderingContext2D, state: GameState, building: Building, wall: number, selected: boolean) {
  const def = BUILDINGS[building.type];
  const n = tileToIso(building.x, building.y);
  const s = tileToIso(building.x + def.w, building.y + def.h);
  const west = tileToIso(building.x, building.y + def.h);
  const color = state.players[building.playerId]?.color ?? '#888';
  const flag = lift(n, wall + 10);
  ctx.fillStyle = color;
  ctx.fillRect(flag.x, flag.y, 3, 12);
  ctx.fillRect(flag.x, flag.y, 10, 6);
  if (selected) {
    ctx.strokeStyle = '#fff4d2';
    ctx.lineWidth = 2;
    const pts = diamond(building.x, building.y, def.w, def.h);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - wall);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y - wall);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (!building.complete || building.upgrading) {
    const need = building.upgrading ? 220 : def.buildTicks || 1;
    bar(ctx, west, s, building.buildProgress / need, '#e6b15a');
  } else if (def.cycle > 0 && building.workerIds.length > 0) {
    bar(ctx, west, s, building.work / def.cycle, '#8dce67');
  }
  if (def.workers > 0) {
    const badge = lift(tileToIso(building.x + def.w, building.y), wall + 6);
    ctx.fillStyle = '#1c1612';
    ctx.beginPath();
    ctx.arc(badge.x, badge.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = building.workerIds.length > 0 ? '#f6ead7' : '#e6b15a';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(building.workerIds.length), badge.x, badge.y + 4);
    ctx.textAlign = 'left';
  }
  if (buildingWarning(state, building)) {
    const warn = lift(s, wall + 18);
    ctx.fillStyle = '#e6b15a';
    ctx.beginPath();
    ctx.arc(warn.x, warn.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1612';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', warn.x, warn.y + 4);
    ctx.textAlign = 'left';
  }
}

function bar(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, ratio: number, color: string) {
  const t = Math.max(0, Math.min(1, ratio));
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + 5);
  ctx.lineTo(b.x, b.y + 5);
  ctx.stroke();
  const end = lerp(a, b, t);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + 5);
  ctx.lineTo(end.x, end.y + 5);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function wallHeight(building: Building): number {
  switch (building.type) {
    case 'keep':
      return 34 + building.level * 8;
    case 'shack':
      return 32;
    case 'cabin':
      return 16;
    case 'dairy':
      return 22;
    case 'house':
    case 'brewery':
      return 30;
    case 'khrush':
      return 64;
    case 'highrise':
      return 108;
    case 'granary':
      return 32;
    case 'stockpile':
      return 8;
    case 'woodcutter':
    case 'hunter':
    case 'pitch':
      return 18;
    case 'orchard':
      return 18;
    case 'wheat':
      return 6;
    case 'mill':
      return 28;
    case 'bakery':
    case 'tavern':
    case 'barracks':
      return 22;
    case 'hop':
      return 14;
    case 'quarry':
      return 10;
    case 'mine':
    case 'market':
      return 16;
    default:
      return 18;
  }
}

function cacheableBuilding(type: BuildingType) {
  return type !== 'wheat' && type !== 'hop';
}

function buildingBounds(type: BuildingType, w: number, h: number, wall: number, level: number) {
  const pts = [tileToIso(0, 0), tileToIso(w, 0), tileToIso(w, h), tileToIso(0, h)];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const extra = type === 'keep' ? 52 + level * 6 : type === 'highrise' ? 40 : type === 'shack' ? 24 : 26;
  return { minX: minX - 22, minY: minY - wall - extra, maxX: maxX + 28, maxY: maxY + 20 };
}

function takeBuildingSprite(building: Building) {
  const stage = buildStage(building);
  const def = BUILDINGS[building.type];
  const key = `b|${building.type}|${building.level}|${stage}`;
  const bounds = buildingBounds(building.type, def.w, def.h, wallHeight(building), building.level);
  return renderSprite(key, bounds, (ctx) => {
    const fake: Building = { ...building, x: 0, y: 0 };
    caching = true;
    forcedGrow = growForStage(stage);
    try {
      drawBuilding(ctx, fake, 0);
    } finally {
      caching = false;
      forcedGrow = -1;
    }
  });
}

function drawPlague(ctx: CanvasRenderingContext2D, building: Building, wall: number) {
  if (building.plague <= 0) return;
  const def = BUILDINGS[building.type];
  const p = tileToIso(building.x + def.w / 2, building.y + def.h / 2);
  ctx.fillStyle = '#9be07a';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('чума', p.x - 12, p.y - wall);
}

function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, time: number) {
  const def = BUILDINGS[building.type];
  const growing = !building.complete || building.upgrading;
  if (!caching && gfxHigh() && cacheableBuilding(building.type)) {
    const sprite = takeBuildingSprite(building);
    const origin = tileToIso(building.x, building.y);
    blitSprite(ctx, sprite, origin.x, origin.y);
    drawLiveAnims(ctx, building, time);
    drawPlague(ctx, building, wallHeight(building));
    return;
  }
  ctx.save();
  if (growing && !gfxHigh()) ctx.globalAlpha = 0.82;
  const full = wallHeight(building);
  const wall = growing && gfxHigh() ? full * buildGrow(building) : full;
  if (growing && gfxHigh()) drawScaffold(ctx, building.x, building.y, def.w, def.h, full);
  switch (building.type) {
    case 'keep':
      drawKeep(ctx, building.x, building.y, def.w, def.h, wall, building.level);
      break;
    case 'shack':
      drawShack(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'cabin':
      drawCabin(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'house':
      drawHouse(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'khrush':
      drawPanel(ctx, building.x, building.y, def.w, def.h, wall, 5, '#d5d0c4', '#a8a398');
      break;
    case 'highrise':
      drawTower(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'granary':
      drawGranary(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'stockpile':
      drawStockpile(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'woodcutter':
      drawWoodcutter(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'dairy':
      drawDairy(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'hunter':
      drawHunter(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'wheat':
      drawField(ctx, building.x, building.y, def.w, def.h, '#e2c15a', '#8d6a28', time);
      break;
    case 'mill':
      drawMill(ctx, building.x, building.y, def.w, def.h, wall, time);
      break;
    case 'bakery':
      drawBakery(ctx, building.x, building.y, def.w, def.h, wall, time);
      break;
    case 'hop':
      drawHop(ctx, building.x, building.y, def.w, def.h, time);
      break;
    case 'brewery':
      drawBrewery(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'tavern':
      drawTavern(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'quarry':
      drawQuarry(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'mine':
      drawMine(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'pitch':
      drawPitch(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'market':
      drawMarket(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'barracks':
      drawBarracks(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    default:
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#ccc', '#999', '#777', true);
  }
  if (!caching) drawPlague(ctx, building, wall);
  ctx.restore();
}

function drawScaffold(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const corners = [tileToIso(x, y), tileToIso(x + w, y), tileToIso(x + w, y + h), tileToIso(x, y + h)];
  ctx.strokeStyle = '#c4a574';
  ctx.lineWidth = 2;
  for (const corner of corners) {
    ctx.beginPath();
    ctx.moveTo(corner.x, corner.y);
    ctx.lineTo(corner.x, corner.y - wall - 6);
    ctx.stroke();
  }
  for (const t of [0.42, 0.82]) {
    ctx.beginPath();
    corners.forEach((corner, index) => {
      const p = { x: corner.x, y: corner.y - wall * t };
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.strokeStyle = '#8a5a32';
  ctx.lineWidth = 3;
  const plankA = lerp(corners[3], corners[2], 0.25);
  const plankB = lerp(corners[3], corners[2], 0.75);
  ctx.beginPath();
  ctx.moveTo(plankA.x, plankA.y - wall * 0.42);
  ctx.lineTo(plankB.x, plankB.y - wall * 0.42);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawBalconies(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, floors: number) {
  if (!gfxHigh()) return;
  const west = tileToIso(x, y + h);
  const south = tileToIso(x + w, y + h);
  for (let row = 1; row < floors; row += 2) {
    const base = lerp(west, south, 0.34);
    const p = { x: base.x, y: base.y - (wall * row) / floors };
    ctx.fillStyle = '#c9c3b4';
    ctx.fillRect(p.x - 7, p.y, 14, 3);
    ctx.strokeStyle = '#5c564c';
    ctx.strokeRect(p.x - 7, p.y - 5, 14, 5);
  }
}

function crenellations(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, count: number) {
  const bh = gfxHigh() ? 8 : 6;
  const bw = gfxHigh() ? 5 : 4;
  for (let i = 0; i < count; i++) {
    const p = lift(tileToIso(x + (w * (i + 1)) / (count + 1), y + h * 0.22), wall);
    ctx.fillStyle = '#c9c3b4';
    ctx.fillRect(p.x, p.y - bh, bw, bh);
    if (gfxHigh()) {
      ctx.fillStyle = 'rgba(255,248,230,0.45)';
      ctx.fillRect(p.x, p.y - bh, 1.4, bh);
    }
  }
}

function footprint(x: number, y: number, w: number, h: number) {
  return {
    n: tileToIso(x, y),
    e: tileToIso(x + w, y),
    s: tileToIso(x + w, y + h),
    west: tileToIso(x, y + h),
  };
}

function drawShack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const { n, e, s, west } = footprint(x, y, w, h);
  const peak = lift({ x: (n.x + s.x) / 2, y: (n.y + s.y) / 2 }, 34);
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + 4, 16, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [n, west, peak], '#e2c07a');
  poly(ctx, [west, s, peak], '#c4924e');
  poly(ctx, [s, e, peak], '#7a4e2c');
  poly(ctx, [e, n, peak], '#5c3a22');
  ctx.strokeStyle = '#3a2414';
  ctx.lineWidth = 1.4;
  for (const base of [n, e, s, west]) {
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(peak.x, peak.y);
    ctx.stroke();
  }
  const mouth = lerp(west, s, 0.62);
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.moveTo(mouth.x - 4, mouth.y);
  ctx.lineTo(mouth.x + 4, mouth.y);
  ctx.lineTo(peak.x, peak.y + 10);
  ctx.fill();
  if (gfxHigh()) {
    ctx.strokeStyle = 'rgba(90,58,22,0.5)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const a = lerp(west, s, i / 5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(peak.x, peak.y);
      ctx.stroke();
    }
    drawHay(ctx, x + 0.35, y + h - 0.3);
    drawCrate(ctx, x + w - 0.4, y + h - 0.35);
  }
  ctx.lineWidth = 1;
}

function drawCabin(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#c5ccd0', '#8d969c', '#6e787e', true, 'corrugated');
  dressRoof(ctx, flatRoof(box, wall), 'tin');
  const { s, west, e } = footprint(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const a = lerp(lift(west, wall * (i / 4)), lift(s, wall * (i / 4)), 1);
    const b = lift(west, wall * (i / 4));
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();
  }
  const win = lerp(west, s, 0.78);
  ctx.fillStyle = '#9fd4ea';
  ctx.fillRect(win.x - 5, win.y - wall * 0.62, 7, 5);
  ctx.strokeStyle = '#4a545a';
  ctx.strokeRect(win.x - 5, win.y - wall * 0.62, 7, 5);
  const roof = lift(e, wall + 2);
  ctx.fillStyle = '#5c656b';
  ctx.fillRect(roof.x - 3, roof.y - 3, 6, 3);
}

function drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#f4e6cc', '#cbb892', '#c4483c', true, 'plaster');
  const ridgeL = lift(lerp(box.n, box.west, 0.5), wall + 16);
  const ridgeR = lift(lerp(box.e, box.s, 0.5), wall + 16);
  poly(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], '#c4483c');
  poly(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], '#8d2e28');
  dressRoof(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], 'tile');
  dressRoof(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], 'tile');
  windows(ctx, x, y, w, h, wall * 0.75, 1, 2);
  const chim = lift(lerp(box.n, box.e, 0.3), wall + 20);
  ctx.fillStyle = '#6e5134';
  ctx.fillRect(chim.x, chim.y, 4, 8);
  if (gfxHigh()) {
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(chim.x, chim.y + 3, 4, 1);
    ctx.fillStyle = '#4a3428';
    ctx.fillRect(chim.x - 1, chim.y - 2, 6, 2);
  }
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  wall: number,
  floors: number,
  front: string,
  side: string,
) {
  drawVolume(ctx, x, y, w, h, wall, front, side, '#b7b2a6', false, 'concrete');
  windows(ctx, x, y, w, h, wall, floors, 4);
  drawBalconies(ctx, x, y, w, h, wall, floors);
  const { s, west } = footprint(x, y, w, h);
  ctx.strokeStyle = 'rgba(60,56,48,0.45)';
  for (let i = 1; i < floors; i++) {
    const a = lift(west, (wall * i) / floors);
    const b = lift(s, (wall * i) / floors);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  const door = lerp(west, s, 0.5);
  poly(ctx, [door, { x: door.x + 8, y: door.y }, lift({ x: door.x + 8, y: door.y }, wall * 0.16), lift(door, wall * 0.16)], '#5c4030');
}

function drawTower(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#d5e4ee', '#8ea0ae', '#6e808c', false, 'concrete');
  windows(ctx, x, y, w, h, wall, 9, 3);
  drawBalconies(ctx, x, y, w, h, wall, 8);
  const top = lift(tileToIso(x + w * 0.35, y + h * 0.35), wall + 16);
  ctx.strokeStyle = '#d7dde2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(top.x, top.y - 14);
  ctx.stroke();
  ctx.fillStyle = '#e15b45';
  ctx.beginPath();
  ctx.moveTo(top.x, top.y - 14);
  ctx.lineTo(top.x + 10, top.y - 10);
  ctx.lineTo(top.x, top.y - 6);
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawBanner(ctx: CanvasRenderingContext2D, x: number, y: number, wall: number, color: string, reach = 12) {
  const pole = lift(tileToIso(x, y), wall);
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pole.x, pole.y);
  ctx.lineTo(pole.x, pole.y - 16);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pole.x, pole.y - 16);
  ctx.lineTo(pole.x + reach, pole.y - 12);
  ctx.lineTo(pole.x, pole.y - 8);
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawKeep(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, level: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#e4dcc8', '#9a917f', '#6e6558', true, 'stone');
  dressRoof(ctx, flatRoof(box, wall), 'slab');
  crenellations(ctx, x, y, w, h, wall, 3 + level * (gfxHigh() ? 2 : 1));
  const gate = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.5);
  ctx.fillStyle = '#3a2418';
  ctx.beginPath();
  ctx.moveTo(gate.x - 6, gate.y);
  ctx.lineTo(gate.x + 6, gate.y);
  ctx.lineTo(gate.x + 6, gate.y - wall * 0.38);
  ctx.quadraticCurveTo(gate.x, gate.y - wall * 0.55, gate.x - 6, gate.y - wall * 0.38);
  ctx.fill();
  if (gfxHigh()) {
    ctx.strokeStyle = '#c4a574';
    ctx.beginPath();
    ctx.moveTo(gate.x - 4, gate.y - wall * 0.12);
    ctx.lineTo(gate.x + 4, gate.y - wall * 0.12);
    ctx.stroke();
    windows(ctx, x, y, w, h, wall * 0.9, Math.min(5, level), 2 + (level >= 3 ? 1 : 0));
  }
  if (level >= 2) {
    if (gfxHigh()) {
      const th = wall + 10 + level * 4;
      drawVolume(ctx, x + w - 0.95, y + 0.12, 0.82, 0.82, th, '#e4dcc8', '#9a917f', '#6e6558', false, 'stone');
      crenellations(ctx, x + w - 0.95, y + 0.12, 0.82, 0.82, th, 2);
    } else {
      const turret = lift(tileToIso(x + w * 0.78, y + 0.35), wall);
      ctx.fillStyle = '#d7d0c2';
      ctx.fillRect(turret.x, turret.y - 10, 8, 12);
      ctx.fillStyle = '#8d8578';
      ctx.fillRect(turret.x + 5, turret.y - 10, 3, 12);
    }
  }
  if (level >= 4) {
    if (gfxHigh()) {
      const th = wall + 18 + level * 3;
      drawVolume(ctx, x + 0.12, y + 0.15, 0.78, 0.78, th, '#d7d0c2', '#8d8578', '#6e6558', false, 'stone');
      crenellations(ctx, x + 0.12, y + 0.15, 0.78, 0.78, th, 2);
    } else {
      const turret = lift(tileToIso(x + 0.4, y + h * 0.3), wall);
      ctx.fillStyle = '#c9c3b4';
      ctx.fillRect(turret.x - 8, turret.y - 8, 7, 10);
    }
  }
  drawBanner(ctx, x + 0.45, y + 0.4, wall + 8 + level * 2, level >= 3 ? '#c4483c' : '#2f6ea5', 12 + level);
  if (gfxHigh() && level >= 5) {
    drawBanner(ctx, x + w * 0.72, y + 0.35, wall + 18, '#e0a11b', 10);
  }
}

function drawGranary(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#c46a3a', '#8a3e28', '#e7c27a', true, 'plank');
  const ridgeL = lift(lerp(box.n, box.west, 0.5), wall + 14);
  const ridgeR = lift(lerp(box.e, box.s, 0.5), wall + 14);
  poly(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], '#e8c98a');
  poly(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], '#b8894a');
  dressRoof(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], 'shingle');
  dressRoof(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], 'shingle');
  for (let i = 0; i < 3; i++) {
    const p = tileToIso(x + 0.45 + i * 0.7, y + h - 0.35);
    ctx.fillStyle = '#e6d2a4';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 3, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a6230';
    ctx.stroke();
  }
}

function drawWoodcutter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#d7a15a', '#8a5a32', '#6e4428', true, 'log');
  dressRoof(ctx, flatRoof(box, wall), 'shingle');
  const pile = tileToIso(x + 0.45, y + h - 0.45);
  ctx.fillStyle = '#5c3a22';
  ctx.beginPath();
  ctx.ellipse(pile.x, pile.y - 3, 9, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.beginPath();
  ctx.ellipse(pile.x - 6, pile.y - 4, 2.4, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!gfxHigh()) {
    const axe = tileToIso(x + w - 0.35, y + h - 0.4);
    ctx.strokeStyle = '#6e5134';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(axe.x, axe.y);
    ctx.lineTo(axe.x + 2, axe.y - 16);
    ctx.stroke();
    ctx.fillStyle = '#c5ccd0';
    ctx.beginPath();
    ctx.moveTo(axe.x - 2, axe.y - 14);
    ctx.lineTo(axe.x + 6, axe.y - 16);
    ctx.lineTo(axe.x + 2, axe.y - 10);
    ctx.fill();
    ctx.lineWidth = 1;
  } else {
    drawCrate(ctx, x + w - 0.45, y + 0.4);
  }
}

function drawHunter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#a87448', '#6e4428', '#5c4030', true, 'log');
  dressRoof(ctx, flatRoof(box, wall), 'shingle');
  const lineA = lift(tileToIso(x + 0.3, y + 0.4), wall * 0.7);
  const lineB = lift(tileToIso(x + w - 0.3, y + 0.5), wall * 0.7);
  ctx.strokeStyle = '#3a2a22';
  ctx.beginPath();
  ctx.moveTo(lineA.x, lineA.y);
  ctx.lineTo(lineB.x, lineB.y);
  ctx.stroke();
  ctx.fillStyle = '#8a5a32';
  ctx.beginPath();
  ctx.ellipse((lineA.x + lineB.x) / 2, lineA.y + 6, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.beginPath();
  ctx.ellipse((lineA.x + lineB.x) / 2 - 7, lineA.y + 5, 3.5, 5, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawDairy(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#f7f4ee', '#d7d0c4', '#c4553a', true, 'plaster');
  dressRoof(ctx, flatRoof(box, wall), 'tile');
  if (!gfxHigh()) {
    drawCow(ctx, x + w * 0.72, y + h * 0.78);
    drawCow(ctx, x + w * 0.42, y + h * 0.7);
  } else {
    drawFence(ctx, x, y, w, h);
    drawHay(ctx, x + 0.45, y + h - 0.4);
  }
  ctx.strokeStyle = '#8a6230';
  ctx.strokeRect(tileToIso(x, y + h).x, tileToIso(x, y + h).y - 2, 10, 4);
}

function drawMill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, time: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#f7f1e4', '#d9d0c2', '#8d6a45', false, 'plaster');
  dressRoof(ctx, flatRoof(box, wall), 'shingle');
  const cap = lift(tileToIso(x + w / 2, y + h / 2), wall);
  ctx.fillStyle = '#6e4428';
  ctx.beginPath();
  ctx.moveTo(cap.x, cap.y - 18);
  ctx.lineTo(cap.x + 14, cap.y);
  ctx.lineTo(cap.x - 10, cap.y);
  ctx.fill();
  if (!gfxHigh()) drawBlades(ctx, x + w / 2, y + 0.25, time);
}

function drawBakery(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, time: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#f0d2b0', '#c49578', '#a33b3b', true, 'brick');
  dressRoof(ctx, flatRoof(box, wall), 'tile');
  const glow = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.72);
  ctx.fillStyle = '#e6b15a';
  ctx.fillRect(glow.x - 3, glow.y - wall * 0.4, 5, 4);
  if (gfxHigh()) {
    drawSack(ctx, x + 0.4, y + h - 0.35, '#e0a15a');
    drawCrate(ctx, x + w - 0.4, y + h - 0.35);
  }
  if (!gfxHigh()) drawSmoke(ctx, x + w * 0.72, y + 0.25, wall, time);
}

function drawBrewery(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#6e5134', '#4a3424', '#3a2a22', true, 'brick');
  dressRoof(ctx, flatRoof(box, wall), 'tile');
  drawVat(ctx, x + w * 0.62, y + h * 0.35);
  drawVat(ctx, x + w * 0.38, y + h * 0.48);
  if (gfxHigh()) drawBarrel(ctx, x + 0.4, y + h - 0.35);
}

function drawTavern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#a33b3b', '#6e2420', '#5c4030', true, 'brick');
  dressRoof(ctx, flatRoof(box, wall), 'shingle');
  windows(ctx, x, y, w, h, wall, 1, 2);
  const glow = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.3);
  ctx.fillStyle = '#f2d15a';
  ctx.fillRect(glow.x - 3, glow.y - wall * 0.45, 5, 4);
  drawSign(ctx, x + 0.35, y + h * 0.72, wall);
  if (gfxHigh()) drawBarrel(ctx, x + w - 0.4, y + h - 0.3);
}

function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#6a564c', '#3a3330', '#2a2422', false, 'stone');
  dressRoof(ctx, flatRoof(box, wall), 'slab');
  drawMouth(ctx, x, y, w, h, wall);
  const rail = tileToIso(x + w * 0.2, y + h - 0.2);
  ctx.strokeStyle = '#8d877c';
  ctx.beginPath();
  ctx.moveTo(rail.x, rail.y);
  ctx.lineTo(rail.x + 16, rail.y - 6);
  ctx.stroke();
  ctx.fillStyle = '#9a4e32';
  ctx.fillRect(rail.x + 6, rail.y - 8, 7, 4);
}

function drawMarket(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#f7f1e4', '#e0c48a', '#e0a11b', false, 'plaster');
  dressRoof(ctx, flatRoof(box, wall), 'tile');
  const awning = lift(lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.5), wall * 0.55);
  ctx.fillStyle = '#c4483c';
  ctx.beginPath();
  ctx.moveTo(awning.x - 16, awning.y);
  ctx.lineTo(awning.x + 16, awning.y - 2);
  ctx.lineTo(awning.x + 12, awning.y + 6);
  ctx.lineTo(awning.x - 14, awning.y + 7);
  ctx.fill();
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(awning.x - 8, awning.y + 1, 6, 4);
  ctx.fillRect(awning.x + 2, awning.y, 6, 4);
}

function drawBarracks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#9aa3b0', '#5c6572', '#4e5560', true, 'stone');
  dressRoof(ctx, flatRoof(box, wall), 'slab');
  const pole = lift(tileToIso(x + 0.4, y + 0.35), wall + 6);
  ctx.strokeStyle = '#3a2a22';
  ctx.beginPath();
  ctx.moveTo(pole.x, pole.y);
  ctx.lineTo(pole.x, pole.y - 14);
  ctx.stroke();
  ctx.fillStyle = '#2f6ea5';
  ctx.fillRect(pole.x, pole.y - 14, 10, 6);
  windows(ctx, x, y, w, h, wall, 1, 3);
}

function drawStockpile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  poly(ctx, diamond(x, y, w, h), 'rgba(120,90,50,0.28)');
  const log = tileToIso(x + 0.7, y + 0.7);
  ctx.fillStyle = '#6e4428';
  ctx.beginPath();
  ctx.ellipse(log.x, log.y - 4, 12, 5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.beginPath();
  ctx.ellipse(log.x - 8, log.y - 5, 3, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const stone = tileToIso(x + w - 1.1, y + 0.8);
  ctx.fillStyle = '#8d877c';
  ctx.beginPath();
  ctx.ellipse(stone.x, stone.y - 3, 8, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9d3c6';
  ctx.beginPath();
  ctx.ellipse(stone.x - 2, stone.y - 6, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const ore = tileToIso(x + 1.1, y + h - 0.7);
  ctx.fillStyle = '#5c342c';
  ctx.beginPath();
  ctx.ellipse(ore.x, ore.y - 2, 6, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c45a32';
  ctx.beginPath();
  ctx.arc(ore.x + 2, ore.y - 4, 2, 0, Math.PI * 2);
  ctx.fill();
  if (gfxHigh()) {
    drawCrate(ctx, x + 0.45, y + 0.45);
    drawBarrel(ctx, x + w * 0.55, y + h * 0.55);
    drawSack(ctx, x + w - 0.5, y + h - 0.45);
  }
}

function drawField(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: string, b: string, time = 0) {
  poly(ctx, diamond(x, y, w, h), a);
  if (gfxHigh()) {
    ctx.strokeStyle = 'rgba(90,60,20,0.35)';
    ctx.lineWidth = 2;
    const edge = diamond(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(edge[0].x, edge[0].y);
    for (const p of edge.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();
  }
  const rows = Math.max(2, Math.round(h * 2));
  ctx.lineWidth = 1.5;
  for (let i = 1; i < rows; i++) {
    const sway = gfxHigh() ? Math.sin(time / 380 + i * 0.7) * 2.4 : 0;
    const q = tileToIso(x, y + (i * h) / rows);
    const p = tileToIso(x + w, y + (i * h) / rows);
    ctx.strokeStyle = b;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.quadraticCurveTo((q.x + p.x) / 2, (q.y + p.y) / 2 - sway, p.x + sway, p.y);
    ctx.stroke();
    if (!gfxHigh()) continue;
    ctx.fillStyle = '#f2d56a';
    const heads = Math.max(3, w * 2);
    for (let k = 0; k < heads; k++) {
      const t = (k + 0.5) / heads;
      const s = lerp(q, p, t);
      ctx.fillRect(s.x + sway * t - 0.7, s.y - 3.2, 1.5, 2.4);
    }
  }
  ctx.lineWidth = 1;
}

function drawHop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time = 0) {
  poly(ctx, diamond(x, y, w, h), '#3f7a32');
  ctx.strokeStyle = '#d8c598';
  ctx.lineWidth = 2;
  for (let col = 0; col < w; col++) {
    const sway = gfxHigh() ? Math.sin(time / 500 + col) * 2 : 0;
    const base = tileToIso(x + col + 0.5, y + h - 0.2);
    const top = lift(tileToIso(x + col + 0.5, y + 0.3), 16);
    const tip = { x: top.x + sway, y: top.y };
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    if (!gfxHigh()) continue;
    ctx.fillStyle = '#6a9a3e';
    for (let k = 1; k <= 3; k++) {
      const p = lerp(base, tip, k / 4);
      ctx.beginPath();
      ctx.ellipse(p.x + 2, p.y, 3.2, 1.8, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.lineWidth = 1;
}

function drawBlades(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const p = lift(tileToIso(x, y), 36);
  const angle = time / 280;
  if (!gfxHigh()) {
    ctx.strokeStyle = '#f4efe4';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = angle + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 8);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    return;
  }
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * Math.PI) / 2;
    const dx = Math.cos(a) * 18;
    const dy = Math.sin(a) * 9;
    ctx.fillStyle = i % 2 === 0 ? '#f7f1e4' : '#d9d0c2';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dx * 0.25 - dy * 0.18, p.y + dy * 0.25 + dx * 0.08);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.lineTo(p.x + dx * 0.25 + dy * 0.18, p.y + dy * 0.25 - dx * 0.08);
    ctx.fill();
  }
  ctx.fillStyle = '#6e4428';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, wall: number, time: number) {
  const p = lift(tileToIso(x, y), wall + 4);
  ctx.fillStyle = '#d7d2c6';
  ctx.fillRect(p.x - 2, p.y, 4, 8);
  for (let i = 0; i < 3; i++) {
    const shift = ((time / 300 + i * 0.3) % 1) * 16;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(p.x + Math.sin(time / 200 + i) * 3, p.y - shift, 3 + i, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawVat(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const p = tileToIso(x, y);
  ctx.fillStyle = '#e0a11b';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 8, 7, 10, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, wall: number) {
  const p = lift(tileToIso(x, y), wall * 0.7);
  ctx.fillStyle = '#f2d15a';
  ctx.fillRect(p.x, p.y, 16, 8);
  ctx.fillStyle = '#3a2418';
  ctx.font = '8px sans-serif';
  ctx.fillText('пиво', p.x + 1, p.y + 7);
}

function drawQuarry(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  poly(ctx, diamond(x, y, w, h), '#b7b1a4');
  poly(ctx, diamond(x + 0.35, y + 0.35, w - 0.7, h - 0.7), '#8a8478');
  drawRock(ctx, x + 0.2, y + 0.2, '#d9d3c6', '#8d877c');
  drawRock(ctx, x + w - 1.1, y + 0.3, '#c9c3b4', '#7d776c');
  if (gfxHigh()) {
    const p = tileToIso(x + w / 2, y + h / 2);
    ctx.strokeStyle = 'rgba(70,64,56,0.55)';
    ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y - 2);
    ctx.lineTo(p.x, p.y + 2);
    ctx.lineTo(p.x + 7, p.y - 3);
    ctx.stroke();
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const west = tileToIso(x, y + h);
  const south = tileToIso(x + w, y + h);
  const c = lerp(west, south, 0.5);
  ctx.fillStyle = '#14110f';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - wall * 0.35, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPitch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  poly(ctx, diamond(x, y, w, h), '#2a2e2a');
  const c = tileToIso(x + w / 2, y + h / 2);
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6e5134';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + 4, c.y - 22);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawCrate(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const p = tileToIso(tx, ty);
  ctx.fillStyle = '#8a5a32';
  ctx.fillRect(p.x - 5, p.y - 8, 10, 8);
  ctx.strokeStyle = '#c4a574';
  ctx.strokeRect(p.x - 5, p.y - 8, 10, 8);
  ctx.beginPath();
  ctx.moveTo(p.x - 5, p.y - 4);
  ctx.lineTo(p.x + 5, p.y - 4);
  ctx.stroke();
}

function drawBarrel(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const p = tileToIso(tx, ty);
  ctx.fillStyle = '#6e4428';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 6, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c4a574';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 8, 5, 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 4, 5, 2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSack(ctx: CanvasRenderingContext2D, tx: number, ty: number, color = '#e6d2a4') {
  const p = tileToIso(tx, ty);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 4, 5, 6, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a6230';
  ctx.stroke();
}

function drawHay(ctx: CanvasRenderingContext2D, tx: number, ty: number) {
  const p = tileToIso(tx, ty);
  ctx.strokeStyle = '#e2c15a';
  ctx.lineWidth = 1.3;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x + i * 2, p.y);
    ctx.lineTo(p.x + i * 2 + 1, p.y - 7);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawFence(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const a = tileToIso(x, y + h);
  const b = tileToIso(x + w, y + h);
  ctx.strokeStyle = '#8a6230';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.moveTo(a.x, a.y - 6);
  ctx.lineTo(b.x, b.y - 6);
  ctx.stroke();
  for (let i = 0; i <= 4; i++) {
    const p = lerp(a, b, i / 4);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 8);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function paintOrchardFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.strokeStyle = '#2f6a34';
  ctx.lineWidth = 1.2;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if ((row + col) % 2 === 0) continue;
      const p = tileToIso(x + col + 0.5, y + row + 0.7);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 1, p.y - 3);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 1.5, p.y - 2.5);
      ctx.stroke();
      if ((row + col) % 3 === 0) {
        ctx.fillStyle = '#e6d15a';
        ctx.fillRect(p.x + 2, p.y - 2, 1.4, 1.4);
      }
    }
  }
  ctx.lineWidth = 1;
}

function drawSwingingAxe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number) {
  const p = tileToIso(x + w - 0.35, y + h - 0.4);
  const ang = Math.sin(time / 220);
  const tipX = p.x + Math.sin(ang) * 6;
  const tipY = p.y - 14 - Math.cos(ang) * 3;
  ctx.strokeStyle = '#6e5134';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 2);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = '#c5ccd0';
  ctx.beginPath();
  ctx.moveTo(tipX - 4, tipY);
  ctx.lineTo(tipX + 5, tipY - 3);
  ctx.lineTo(tipX + 1, tipY + 4);
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawHerd(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number) {
  const a = Math.sin(time / 700) * 0.18;
  const b = Math.sin(time / 540 + 1.4) * 0.15;
  drawCow(ctx, x + w * 0.72 + a, y + h * 0.78);
  drawCow(ctx, x + w * 0.42 - b, y + h * 0.7);
}

function drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, time: number) {
  const glow = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.3);
  const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time / 160));
  const py = glow.y - wall * 0.45;
  ctx.save();
  ctx.globalAlpha = 0.22 + pulse * 0.28;
  ctx.fillStyle = '#f2d15a';
  ctx.beginPath();
  ctx.arc(glow.x, py, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = `rgba(242, 209, 90, ${0.75 + pulse * 0.25})`;
  ctx.fillRect(glow.x - 2.5, py - 2, 5, 5);
}

function drawLiveAnims(ctx: CanvasRenderingContext2D, building: Building, time: number) {
  const def = BUILDINGS[building.type];
  const wall = wallHeight(building) * buildGrow(building);
  const { x, y } = building;
  const { w, h } = def;
  switch (building.type) {
    case 'mill':
      drawBlades(ctx, x + w / 2, y + 0.25, time);
      break;
    case 'bakery':
      drawSmoke(ctx, x + w * 0.72, y + 0.25, wall, time);
      break;
    case 'brewery':
      drawSmoke(ctx, x + w * 0.7, y + 0.3, wall, time);
      break;
    case 'woodcutter':
      drawSwingingAxe(ctx, x, y, w, h, time);
      break;
    case 'dairy':
      drawHerd(ctx, x, y, w, h, time);
      break;
    case 'tavern':
      drawLantern(ctx, x, y, w, h, wall, time);
      break;
    default:
      break;
  }
}

function drawCow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const p = tileToIso(x, y);
  ctx.fillStyle = '#f7f7f7';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 4, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(p.x + 3, p.y - 7, 2, 2);
  ctx.fillRect(p.x - 2, p.y - 6, 2, 2);
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, apples: boolean, scale = 1, variant = 0) {
  if (gfxHigh() && !paintingSprite) {
    const key = `tree|${variant % 4}|${apples ? 1 : 0}|${Math.round(scale * 20)}`;
    const center = tileToIso(0.5, 0.5);
    const reach = 20 * scale + 10;
    const sprite = renderSprite(
      key,
      { minX: center.x - reach, minY: center.y - 32 * scale - 8, maxX: center.x + reach, maxY: center.y + 10 },
      (off) => {
        paintingSprite = true;
        try {
          drawTree(off, 0, 0, apples, scale, variant);
        } finally {
          paintingSprite = false;
        }
      },
    );
    const origin = tileToIso(x, y);
    blitSprite(ctx, sprite, origin.x, origin.y);
    return;
  }
  const p = tileToIso(x + 0.5, y + 0.5);
  const crown = 8 * scale;
  ctx.fillStyle = 'rgba(20,14,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + 2, 7 * scale, 3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!gfxHigh()) {
    ctx.fillStyle = '#6e4b2e';
    ctx.fillRect(p.x - 1.5 * scale, p.y - 10 * scale, 3 * scale, 10 * scale);
    ctx.fillStyle = '#2f7a3a';
    ctx.beginPath();
    ctx.arc(p.x, p.y - 16 * scale, crown, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f5c30';
    ctx.beginPath();
    ctx.arc(p.x + 4 * scale, p.y - 14 * scale, crown * 0.62, 0, Math.PI * 2);
    ctx.fill();
    if (!apples) return;
    ctx.fillStyle = '#d6453c';
    ctx.beginPath();
    ctx.arc(p.x - 3 * scale, p.y - 16 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.arc(p.x + 3 * scale, p.y - 13 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = '#5c3a22';
  ctx.fillRect(p.x - 2 * scale, p.y - 12 * scale, 4 * scale, 12 * scale);
  ctx.fillStyle = '#a67c52';
  ctx.fillRect(p.x - 2 * scale, p.y - 12 * scale, 1.3 * scale, 12 * scale);
  const greens = [
    ['#2f7a3a', '#4ea25a', '#1d5830'],
    ['#2a6a34', '#3f8a48', '#184828'],
    ['#3a7a40', '#58a45c', '#245c30'],
    ['#346848', '#4e9460', '#204830'],
  ][variant % 4];
  ctx.fillStyle = greens[2];
  ctx.beginPath();
  ctx.arc(p.x + 4 * scale, p.y - 13 * scale, crown * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = greens[0];
  ctx.beginPath();
  ctx.arc(p.x - 1 * scale, p.y - 18 * scale, crown, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = greens[1];
  ctx.beginPath();
  ctx.arc(p.x - 4 * scale, p.y - 22 * scale, crown * 0.42, 0, Math.PI * 2);
  ctx.fill();
  if (!apples) return;
  ctx.fillStyle = '#d6453c';
  const spots: [number, number][] = [
    [-4, -16],
    [3, -14],
    [0, -20],
    [5, -18],
    [-2, -12],
  ];
  for (const [dx, dy] of spots) {
    ctx.beginPath();
    ctx.arc(p.x + dx * scale, p.y + dy * scale, 1.7 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawForestClump(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number) {
  const n = hash2(seed, x, y);
  if (n % 7 === 0) return;
  const jx = ((n % 9) - 4) * 0.06;
  const jy = (((n >> 4) % 9) - 4) * 0.06;
  const scale = 0.82 + (n % 5) * 0.08;
  drawTree(ctx, x + jx, y + jy, false, scale, n % 4);
  if (n % 4 === 0) drawTree(ctx, x + 0.28 - jx, y - 0.18 + jy, false, scale * 0.72);
}

function drawBoulder(ctx: CanvasRenderingContext2D, px: number, py: number, rx: number, ry: number, light: string, dark: string) {
  ctx.fillStyle = 'rgba(20,14,10,0.22)';
  ctx.beginPath();
  ctx.ellipse(px + 2, py + 3, rx, ry * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(px + 1, py - ry * 0.2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(px - rx * 0.25, py - ry * 0.55, rx * 0.55, ry * 0.4, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoulders(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, kind: 'lime' | 'iron') {
  if (gfxHigh() && !paintingSprite) {
    const variant = hash2(seed, x, y) % 5;
    const sprite = renderSprite(`rock|${kind}|${variant}`, { minX: -30, minY: -40, maxX: 32, maxY: 22 }, (off) => {
      paintingSprite = true;
      try {
        paintBoulders(off, 80 + variant * 17, 0, 0, kind);
      } finally {
        paintingSprite = false;
      }
    });
    const origin = tileToIso(x, y);
    blitSprite(ctx, sprite, origin.x, origin.y);
    return;
  }
  paintBoulders(ctx, seed, x, y, kind);
}

function paintBoulders(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, kind: 'lime' | 'iron') {
  const n = hash2(seed ^ (kind === 'iron' ? 99 : 3), x, y);
  if (n % 6 === 0) return;
  const light = kind === 'iron' ? '#a85b3e' : '#f2efe6';
  const dark = kind === 'iron' ? '#5c3428' : '#8d877c';
  const base = tileToIso(x + 0.35 + (n % 5) * 0.06, y + 0.4 + ((n >> 3) % 5) * 0.05);
  const count = 2 + (n % 2);
  for (let i = 0; i < count; i++) {
    const shift = hash2(seed, x + i * 3, y + 11);
    const px = base.x + ((shift % 11) - 5) * 1.3;
    const py = base.y + (((shift >> 4) % 7) - 3) * 1.1 - i * 2;
    drawBoulder(ctx, px, py, 5 + (shift % 4), 3.2 + (i % 2), light, dark);
  }
  if (kind === 'iron') {
    ctx.strokeStyle = '#c45a32';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(base.x - 5, base.y - 1);
    ctx.lineTo(base.x + 1, base.y - 7);
    ctx.lineTo(base.x + 7, base.y - 4);
    ctx.stroke();
    ctx.fillStyle = '#e07a32';
    ctx.beginPath();
    ctx.arc(base.x + 3, base.y - 6, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
  } else if (gfxHigh()) {
    ctx.strokeStyle = 'rgba(80,74,66,0.6)';
    ctx.beginPath();
    ctx.moveTo(base.x - 4, base.y - 5);
    ctx.lineTo(base.x + 1, base.y - 1);
    ctx.lineTo(base.x + 5, base.y - 4);
    ctx.stroke();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, light: string, dark: string) {
  const p = tileToIso(x + 0.5, y + 0.5);
  drawBoulder(ctx, p.x, p.y, 7, 4, light, dark);
}

function drawMarsh(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number) {
  const n = hash2(seed, x + 17, y + 3);
  if (n % 5 === 0) return;
  const p = tileToIso(x + 0.4 + (n % 5) * 0.05, y + 0.45);
  ctx.fillStyle = '#1a2420';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 8 + (n % 4), 4 + (n % 3), ((n % 7) - 3) * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#101614';
  ctx.beginPath();
  ctx.ellipse(p.x + 3, p.y + 1, 4, 2.2, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,230,200,0.22)';
  ctx.beginPath();
  ctx.ellipse(p.x - 1, p.y - 1, 3.2, 1.3, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7aa04a';
  ctx.lineWidth = 1.4;
  const reeds = 2 + (n % 3);
  for (let i = 0; i < reeds; i++) {
    ctx.beginPath();
    ctx.moveTo(p.x - 4 + i * 3, p.y);
    ctx.quadraticCurveTo(p.x - 5 + i * 3, p.y - 6, p.x - 2 + i * 3, p.y - 9 - (i % 2));
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost) {
  const def = BUILDINGS[ghost.type];
  ctx.save();
  ctx.globalAlpha = 0.45;
  poly(ctx, diamond(ghost.x, ghost.y, def.w, def.h), ghost.ok ? '#7dba5a' : '#d4543c');
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = ghost.ok ? '#edffe4' : '#ffd0c8';
  ctx.lineWidth = 2;
  const pts = diamond(ghost.x, ghost.y, def.w, def.h);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.stroke();
  if (def.nearRadius > 0) {
    const cx = ghost.x + def.w / 2;
    const cy = ghost.y + def.h / 2;
    const radius = workRange(def);
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = tileToIso(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPerson(ctx: CanvasRenderingContext2D, state: GameState, person: Person, walk: boolean, time: number, selected: boolean) {
  const color = state.players[person.playerId]?.color ?? '#ccc';
  let tool: 'axe' | 'pick' | 'apple' | 'spear' | 'club' | 'sword' | null = null;
  const task = person.task;
  if (task.type === 'work' && task.mode === 'labor' && !person.cargo) {
    const job = state.buildings.find((b) => b.id === task.buildingId);
    if (job?.type === 'woodcutter') tool = 'axe';
    else if (job?.type === 'quarry' || job?.type === 'mine' || job?.type === 'pitch') tool = 'pick';
    else if (job?.type === 'hunter') tool = 'spear';
    else if (job?.type === 'orchard' || job?.type === 'wheat' || job?.type === 'hop') tool = 'apple';
  }
  drawFigure(ctx, person.x, person.y, color, walk || person.task.type === 'work', time, tool, person.cargo, selected);
  if (person.task.type === 'idle') {
    const p = tileToIso(person.x, person.y);
    ctx.fillStyle = '#ffd45a';
    ctx.beginPath();
    ctx.arc(p.x + 8, p.y - 30, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  color: string,
  walk: boolean,
  time: number,
  tool: 'axe' | 'pick' | 'apple' | 'spear' | 'club' | 'sword' | null,
  cargo: Resource | null,
  ring: boolean,
) {
  const base = tileToIso(tx, ty);
  const swing = walk ? Math.sin(time / 90 + tx * 3) : 0;
  const bob = walk ? Math.sin(time / 90 + ty) * 1.4 : 0;
  const x = base.x;
  const y = base.y + bob;
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(base.x + 1, base.y + 2, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = '#fff4d2';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 10, y - 28, 20, 30);
  }
  const cloth =
    tool === 'axe'
      ? '#7a4e2c'
      : tool === 'pick'
        ? '#6a6560'
        : tool === 'spear'
          ? '#3e6b38'
          : tool === 'apple'
            ? '#c6a15a'
            : tool === 'sword'
              ? '#3e4a5c'
              : tool === 'club'
                ? '#6e3a32'
                : null;
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x - 4 + swing * 3, y + 2);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 4 - swing * 3, y + 2);
  ctx.stroke();
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(x - 5, y - 1, 3, 3);
  ctx.fillRect(x + 2, y - 1, 3, 3);
  ctx.fillStyle = cloth ?? color;
  ctx.fillRect(x - 5.5, y - 20, 11, 13);
  if (cloth) {
    ctx.fillStyle = color;
    ctx.fillRect(x - 5.5, y - 16, 11, 3);
  }
  ctx.fillStyle = '#3a2a22';
  ctx.fillRect(x - 5.5, y - 11, 11, 1.6);
  ctx.fillStyle = '#f0c7a0';
  ctx.beginPath();
  ctx.arc(x, y - 23, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tool === 'apple' ? '#e2c07a' : color;
  ctx.beginPath();
  ctx.arc(x, y - 25, 2.4, Math.PI, 0);
  ctx.fill();
  if (tool === 'apple') {
    ctx.fillStyle = '#e2c07a';
    ctx.beginPath();
    ctx.ellipse(x, y - 26, 6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tool) {
    const tipX = x + 13;
    const tipY = y - 26 + swing * 4;
    ctx.strokeStyle = tool === 'sword' || tool === 'spear' ? '#d7dde2' : '#6e5134';
    ctx.lineWidth = tool === 'club' ? 3.2 : 2;
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 14);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    if (tool === 'axe') {
      ctx.fillStyle = '#c5ccd0';
      ctx.beginPath();
      ctx.moveTo(tipX - 3, tipY);
      ctx.lineTo(tipX + 4, tipY - 3);
      ctx.lineTo(tipX + 1, tipY + 4);
      ctx.fill();
    } else if (tool === 'pick') {
      ctx.strokeStyle = '#d7dde2';
      ctx.beginPath();
      ctx.moveTo(tipX - 4, tipY);
      ctx.lineTo(tipX + 4, tipY - 2);
      ctx.stroke();
    } else if (tool === 'apple') {
      ctx.fillStyle = '#d6453c';
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (cargo) {
    ctx.fillStyle = '#6e5134';
    ctx.fillRect(x + 5, y - 16, 11, 9);
    ctx.strokeStyle = '#c4a574';
    ctx.strokeRect(x + 5, y - 16, 11, 9);
    ctx.fillStyle = CARGO[cargo] ?? '#ccc';
    ctx.beginPath();
    ctx.arc(x + 8, y - 14, 2.2, 0, Math.PI * 2);
    ctx.arc(x + 12, y - 13, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 1;
}

function drawOx(ctx: CanvasRenderingContext2D, tx: number, ty: number, walk: boolean, time: number, cargo: Resource | null) {
  const p = tileToIso(tx, ty);
  const y = p.y + (walk ? Math.sin(time / 140) : 0);
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a5a32';
  ctx.beginPath();
  ctx.ellipse(p.x, y - 4, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0e2c4';
  ctx.beginPath();
  ctx.arc(p.x + 8, y - 6, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a22';
  ctx.beginPath();
  ctx.moveTo(p.x + 10, p.y - 8);
  ctx.lineTo(p.x + 14, y - 12);
  ctx.stroke();
  if (cargo) {
    ctx.fillStyle = CARGO[cargo] ?? '#ccc';
    ctx.fillRect(p.x - 6, y - 12, 8, 5);
  }
}

function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, walk: boolean, time: number) {
  const p = tileToIso(mob.x, mob.y);
  const y = p.y + (walk ? Math.sin(time / 100 + mob.id) : 0);
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 2, 6, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  if (mob.kind === 'deer') {
    ctx.fillStyle = '#c48a52';
    ctx.beginPath();
    ctx.ellipse(p.x, y - 4, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x + 6, y - 7, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a5a32';
    ctx.beginPath();
    ctx.moveTo(p.x + 6, y - 9);
    ctx.lineTo(p.x + 3, y - 14);
    ctx.moveTo(p.x + 7, y - 9);
    ctx.lineTo(p.x + 11, y - 14);
    ctx.stroke();
  } else if (mob.kind === 'wolf') {
    ctx.fillStyle = '#8d9094';
    ctx.beginPath();
    ctx.ellipse(p.x, y - 4, 8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x + 6, y - 6);
    ctx.lineTo(p.x + 12, y - 8);
    ctx.lineTo(p.x + 6, y - 3);
    ctx.fill();
    ctx.fillStyle = '#5c6064';
    ctx.beginPath();
    ctx.arc(p.x - 6, y - 5, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (mob.kind === 'bear') {
    ctx.fillStyle = '#4a3428';
    ctx.beginPath();
    ctx.ellipse(p.x, y - 5, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x + 7, y - 8, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawFigure(ctx, mob.x, mob.y, '#6e2420', walk, time, 'club', null, false);
    ctx.fillStyle = '#e15b45';
    const q = tileToIso(mob.x, mob.y);
    ctx.fillRect(q.x - 3, q.y - 18, 6, 2);
  }
  if (mob.hp < mob.maxHp) {
    ctx.fillStyle = '#3a2018';
    ctx.fillRect(p.x - 6, y - 16, 12, 2);
    ctx.fillStyle = '#d4543c';
    ctx.fillRect(p.x - 6, y - 16, 12 * Math.max(0, mob.hp / mob.maxHp), 2);
  }
}

export function minimapLayout(mapW: number, mapH: number, viewW: number, viewH: number) {
  const bounds = mapIsoBounds(mapW, mapH);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = Math.min(viewW / spanX, viewH / spanY) * 0.92;
  return {
    bounds,
    scale,
    ox: (viewW - spanX * scale) / 2 - bounds.minX * scale,
    oy: (viewH - spanY * scale) / 2 - bounds.minY * scale,
  };
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewW: number,
  viewH: number,
  baked: TerrainBake,
  miniW: number,
  miniH: number,
) {
  const layout = minimapLayout(state.mapW, state.mapH, miniW, miniH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1c1612';
  ctx.fillRect(0, 0, miniW, miniH);
  ctx.setTransform(layout.scale, 0, 0, layout.scale, layout.ox, layout.oy);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    baked.canvas,
    -baked.originX,
    -baked.originY,
    baked.canvas.width / baked.scale,
    baked.canvas.height / baked.scale,
  );
  for (const player of state.players) {
    if (!player.alive) continue;
    const p = tileToIso(player.spawnX, player.spawnY);
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  const corners = [
    screenToIso(camera, viewW, viewH, 0, 0),
    screenToIso(camera, viewW, viewH, viewW, 0),
    screenToIso(camera, viewW, viewH, viewW, viewH),
    screenToIso(camera, viewW, viewH, 0, viewH),
  ];
  ctx.strokeStyle = '#fff4d2';
  ctx.lineWidth = 2 / layout.scale;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
  ctx.closePath();
  ctx.stroke();
}

export function minimapToTile(mapW: number, mapH: number, miniW: number, miniH: number, px: number, py: number) {
  const layout = minimapLayout(mapW, mapH, miniW, miniH);
  const isoX = (px - layout.ox) / layout.scale;
  const isoY = (py - layout.oy) / layout.scale;
  const a = isoX / (TILE_W / 2);
  const b = isoY / (TILE_H / 2);
  return { x: (b + a) / 2, y: (b - a) / 2 };
}
