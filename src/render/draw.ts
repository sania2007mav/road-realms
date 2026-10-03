import { BUILDINGS } from '../sim/balance';
import { hash2 } from '../sim/rng';
import type { Building, BuildingType, GameState, Mob, Person, Resource } from '../sim/types';
import { Terrain } from '../sim/types';
import { buildingWarning, workRange } from '../sim/update';
import { terrainAt } from '../sim/world';
import { TILE_H, TILE_W, isoToTile, mapIsoBounds, screenToIso, tileToIso, type Camera } from './camera';

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
      for (let x = span.minX; x < span.maxX; x++) fillDiamond(ctx, x, y, groundColor(state, x, y));
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
          if (!building.complete) ctx.globalAlpha = 0.82;
          poly(ctx, diamond(building.x, building.y, def.w, def.h), '#3f8d48');
          ctx.restore();
        },
      });
      const apples = Math.floor(time / 400) % 2 === 0;
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
) {
  const n = tileToIso(x, y);
  const e = tileToIso(x + w, y);
  const s = tileToIso(x + w, y + h);
  const west = tileToIso(x, y + h);
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y + 6, (w + h) * 10, (w + h) * 4, 0, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [e, s, lift(s, wall), lift(e, wall)], side);
  poly(ctx, [west, s, lift(s, wall), lift(west, wall)], front);
  poly(ctx, [lift(n, wall), lift(e, wall), lift(s, wall), lift(west, wall)], roof);
  if (door) {
    const a = lerp(west, s, 0.4);
    const b = lerp(west, s, 0.6);
    poly(ctx, [a, b, lift(b, wall * 0.52), lift(a, wall * 0.52)], '#3a2418');
  }
  return { n, e, s, west, wall };
}

function windows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, rows: number, cols: number) {
  const west = tileToIso(x, y + h);
  const south = tileToIso(x + w, y + h);
  const east = tileToIso(x + w, y);
  ctx.fillStyle = '#9fd4ea';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = (col + 1) / (cols + 1);
      const base = lerp(west, south, t);
      const yy = base.y - wall * ((row + 1) / (rows + 1.4));
      ctx.fillRect(base.x - 2, yy, 4, 3);
      const side = lerp(south, east, t);
      ctx.fillRect(side.x - 2, side.y - wall * ((row + 1) / (rows + 1.4)), 3, 3);
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

function drawBuilding(ctx: CanvasRenderingContext2D, building: Building, time: number) {
  const def = BUILDINGS[building.type];
  ctx.save();
  if (!building.complete || building.upgrading) ctx.globalAlpha = 0.82;
  const wall = wallHeight(building);
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
      drawField(ctx, building.x, building.y, def.w, def.h, '#e2c15a', '#8d6a28');
      break;
    case 'mill':
      drawMill(ctx, building.x, building.y, def.w, def.h, wall, time);
      break;
    case 'bakery':
      drawBakery(ctx, building.x, building.y, def.w, def.h, wall, time);
      break;
    case 'hop':
      drawHop(ctx, building.x, building.y, def.w, def.h);
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
  if (building.plague > 0) {
    const p = tileToIso(building.x + def.w / 2, building.y + def.h / 2);
    ctx.fillStyle = '#9be07a';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('чума', p.x - 12, p.y - wall);
  }
  ctx.restore();
}

function crenellations(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, count: number) {
  ctx.fillStyle = '#c9c3b4';
  for (let i = 0; i < count; i++) {
    const p = lift(tileToIso(x + (w * (i + 1)) / (count + 1), y + h * 0.22), wall);
    ctx.fillRect(p.x, p.y - 6, 4, 6);
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
  ctx.lineWidth = 1;
}

function drawCabin(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#c5ccd0', '#8d969c', '#6e787e', true);
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
  const box = drawVolume(ctx, x, y, w, h, wall, '#f4e6cc', '#cbb892', '#f4e6cc', true);
  const ridgeL = lift(lerp(box.n, box.west, 0.5), wall + 16);
  const ridgeR = lift(lerp(box.e, box.s, 0.5), wall + 16);
  poly(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], '#c4483c');
  poly(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], '#8d2e28');
  windows(ctx, x, y, w, h, wall * 0.75, 1, 2);
  const chim = lift(lerp(box.n, box.e, 0.3), wall + 20);
  ctx.fillStyle = '#6e5134';
  ctx.fillRect(chim.x, chim.y, 4, 8);
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
  drawVolume(ctx, x, y, w, h, wall, front, side, '#b7b2a6', false);
  windows(ctx, x, y, w, h, wall, floors, 4);
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
  drawVolume(ctx, x, y, w, h, wall, '#d5e4ee', '#8ea0ae', '#6e808c', false);
  windows(ctx, x, y, w, h, wall, 9, 3);
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

function drawKeep(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, level: number) {
  drawVolume(ctx, x, y, w, h, wall, '#e4dcc8', '#9a917f', '#6e6558', true);
  crenellations(ctx, x, y, w, h, wall, 3 + level);
  const gate = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.5);
  ctx.fillStyle = '#3a2418';
  ctx.beginPath();
  ctx.moveTo(gate.x - 6, gate.y);
  ctx.lineTo(gate.x + 6, gate.y);
  ctx.lineTo(gate.x + 6, gate.y - wall * 0.38);
  ctx.quadraticCurveTo(gate.x, gate.y - wall * 0.55, gate.x - 6, gate.y - wall * 0.38);
  ctx.fill();
  if (level >= 2) {
    const turret = lift(tileToIso(x + w * 0.78, y + 0.35), wall);
    ctx.fillStyle = '#d7d0c2';
    ctx.fillRect(turret.x, turret.y - 10, 8, 12);
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(turret.x + 5, turret.y - 10, 3, 12);
  }
  if (level >= 4) {
    const turret = lift(tileToIso(x + 0.4, y + h * 0.3), wall);
    ctx.fillStyle = '#c9c3b4';
    ctx.fillRect(turret.x - 8, turret.y - 8, 7, 10);
  }
  const pole = lift(tileToIso(x + 0.45, y + 0.4), wall + 8 + level * 2);
  ctx.strokeStyle = '#3a2a22';
  ctx.beginPath();
  ctx.moveTo(pole.x, pole.y);
  ctx.lineTo(pole.x, pole.y - 16);
  ctx.stroke();
  ctx.fillStyle = level >= 3 ? '#c4483c' : '#2f6ea5';
  ctx.beginPath();
  ctx.moveTo(pole.x, pole.y - 16);
  ctx.lineTo(pole.x + 12, pole.y - 12);
  ctx.lineTo(pole.x, pole.y - 8);
  ctx.fill();
}

function drawGranary(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  const box = drawVolume(ctx, x, y, w, h, wall, '#c46a3a', '#8a3e28', '#e7c27a', true);
  const ridgeL = lift(lerp(box.n, box.west, 0.5), wall + 14);
  const ridgeR = lift(lerp(box.e, box.s, 0.5), wall + 14);
  poly(ctx, [lift(box.n, wall), lift(box.e, wall), ridgeR, ridgeL], '#e8c98a');
  poly(ctx, [lift(box.west, wall), lift(box.s, wall), ridgeR, ridgeL], '#b8894a');
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
  drawVolume(ctx, x, y, w, h, wall, '#d7a15a', '#8a5a32', '#6e4428', true);
  const pile = tileToIso(x + 0.45, y + h - 0.45);
  ctx.fillStyle = '#5c3a22';
  ctx.beginPath();
  ctx.ellipse(pile.x, pile.y - 3, 9, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c4a574';
  ctx.beginPath();
  ctx.ellipse(pile.x - 6, pile.y - 4, 2.4, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
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
}

function drawHunter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#a87448', '#6e4428', '#5c4030', true);
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
  drawVolume(ctx, x, y, w, h, wall, '#f7f4ee', '#d7d0c4', '#c4553a', true);
  drawCow(ctx, x + w * 0.72, y + h * 0.78);
  drawCow(ctx, x + w * 0.42, y + h * 0.7);
  ctx.strokeStyle = '#8a6230';
  ctx.strokeRect(tileToIso(x, y + h).x, tileToIso(x, y + h).y - 2, 10, 4);
}

function drawMill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, time: number) {
  drawVolume(ctx, x, y, w, h, wall, '#f7f1e4', '#d9d0c2', '#8d6a45', false);
  const cap = lift(tileToIso(x + w / 2, y + h / 2), wall);
  ctx.fillStyle = '#6e4428';
  ctx.beginPath();
  ctx.moveTo(cap.x, cap.y - 18);
  ctx.lineTo(cap.x + 14, cap.y);
  ctx.lineTo(cap.x - 10, cap.y);
  ctx.fill();
  drawBlades(ctx, x + w / 2, y + 0.25, time);
}

function drawBakery(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number, time: number) {
  drawVolume(ctx, x, y, w, h, wall, '#f0d2b0', '#c49578', '#a33b3b', true);
  const glow = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.72);
  ctx.fillStyle = '#e6b15a';
  ctx.fillRect(glow.x - 3, glow.y - wall * 0.4, 5, 4);
  drawSmoke(ctx, x + w * 0.72, y + 0.25, wall, time);
}

function drawBrewery(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#6e5134', '#4a3424', '#3a2a22', true);
  drawVat(ctx, x + w * 0.62, y + h * 0.35);
  drawVat(ctx, x + w * 0.38, y + h * 0.48);
}

function drawTavern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#a33b3b', '#6e2420', '#5c4030', true);
  windows(ctx, x, y, w, h, wall, 1, 2);
  const glow = lerp(tileToIso(x, y + h), tileToIso(x + w, y + h), 0.3);
  ctx.fillStyle = '#f2d15a';
  ctx.fillRect(glow.x - 3, glow.y - wall * 0.45, 5, 4);
  drawSign(ctx, x + 0.35, y + h * 0.72, wall);
}

function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: number) {
  drawVolume(ctx, x, y, w, h, wall, '#6a564c', '#3a3330', '#2a2422', false);
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
  drawVolume(ctx, x, y, w, h, wall, '#f7f1e4', '#e0c48a', '#e0a11b', false);
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
  drawVolume(ctx, x, y, w, h, wall, '#9aa3b0', '#5c6572', '#4e5560', true);
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
}

function drawField(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: string, b: string) {
  poly(ctx, diamond(x, y, w, h), a);
  ctx.strokeStyle = b;
  ctx.lineWidth = 1.5;
  for (let i = 1; i < h * 2; i++) {
    const p = lerp(tileToIso(x, y + i * 0.5), tileToIso(x + w, y + i * 0.5), 1);
    const q = tileToIso(x, y + i * 0.5);
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
}

function drawHop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  poly(ctx, diamond(x, y, w, h), '#3f7a32');
  ctx.strokeStyle = '#d8c598';
  ctx.lineWidth = 2;
  for (let col = 0; col < w; col++) {
    const base = tileToIso(x + col + 0.5, y + h - 0.2);
    const top = lift(tileToIso(x + col + 0.5, y + 0.3), 16);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
  }
}

function drawBlades(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const p = lift(tileToIso(x, y), 36);
  const angle = time / 280;
  ctx.strokeStyle = '#f4efe4';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = angle + (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 8);
    ctx.stroke();
  }
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

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, apples: boolean, scale = 1) {
  const p = tileToIso(x + 0.5, y + 0.5);
  const crown = 8 * scale;
  ctx.fillStyle = 'rgba(20,14,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + 2, 7 * scale, 3 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
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
}

function drawForestClump(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number) {
  const n = hash2(seed, x, y);
  if (n % 7 === 0) return;
  const jx = ((n % 9) - 4) * 0.06;
  const jy = (((n >> 4) % 9) - 4) * 0.06;
  const scale = 0.82 + (n % 5) * 0.08;
  drawTree(ctx, x + jx, y + jy, false, scale);
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
    ctx.fillStyle = '#e07a32';
    ctx.beginPath();
    ctx.arc(base.x + 3, base.y - 6, 1.6, 0, Math.PI * 2);
    ctx.fill();
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
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x - 4 + swing * 3, y + 2);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 4 - swing * 3, y + 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - 5, y - 20, 10, 12);
  ctx.fillStyle = '#f0c7a0';
  ctx.beginPath();
  ctx.arc(x, y - 23, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - 25, 2.4, Math.PI, 0);
  ctx.fill();
  if (tool) {
    ctx.strokeStyle = tool === 'sword' || tool === 'spear' ? '#d7dde2' : '#6e5134';
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 14);
    ctx.lineTo(x + 13, y - 26 + swing * 4);
    ctx.stroke();
    if (tool === 'apple') {
      ctx.fillStyle = '#d6453c';
      ctx.beginPath();
      ctx.arc(x + 13, y - 26 + swing * 4, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (cargo) {
    ctx.fillStyle = '#6e5134';
    ctx.fillRect(x + 5, y - 16, 11, 9);
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
