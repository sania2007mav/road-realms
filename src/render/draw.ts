import { BUILDINGS } from '../sim/balance';
import { hash2 } from '../sim/rng';
import type { Building, BuildingType, GameState, Mob, Person, Resource } from '../sim/types';
import { Terrain } from '../sim/types';
import { buildingWarning } from '../sim/update';
import { terrainAt } from '../sim/world';
import { TILE_H, TILE_W, isoToTile, mapIsoBounds, screenToIso, tileToIso, type Camera } from './camera';

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  ok: boolean;
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

function groundColor(state: GameState, x: number, y: number): string {
  const terrain = terrainAt(state, x, y);
  const scale = hash2(state.seed, Math.floor(x / 5), Math.floor(y / 5)) % 14;
  let r = 214;
  let g = 196;
  let b = 150;
  if (terrain === Terrain.Desert) {
    r = 226;
    g = 206;
    b = 150;
  } else if (terrain === Terrain.Land) {
    r = 206;
    g = 186;
    b = 132;
  } else if (terrain === Terrain.Oasis) {
    r = 74;
    g = 148;
    b = 72;
  } else if (terrain === Terrain.Forest) {
    r = 168;
    g = 142;
    b = 86;
  } else if (terrain === Terrain.Limestone) {
    r = 196;
    g = 190;
    b = 176;
  } else if (terrain === Terrain.Iron) {
    r = 140;
    g = 96;
    b = 78;
  } else if (terrain === Terrain.Swamp) {
    r = 42;
    g = 48;
    b = 40;
  } else if (terrain === Terrain.Road) {
    const edge = y === state.roadY - 1 || y === state.roadY + 1;
    r = edge ? 150 : 186;
    g = edge ? 116 : 142;
    b = edge ? 72 : 86;
  }
  let oasis = 0;
  let sand = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const near = terrainAt(state, x + dx, y + dy);
      if (near === Terrain.Oasis) oasis += 1;
      if (near === Terrain.Desert || near === Terrain.Land) sand += 1;
    }
  }
  if (terrain === Terrain.Oasis && sand) {
    const t = Math.min(0.45, sand / 14);
    r = mix(r, 210, t);
    g = mix(g, 190, t);
    b = mix(b, 130, t);
  } else if ((terrain === Terrain.Land || terrain === Terrain.Desert) && oasis) {
    const t = Math.min(0.55, oasis / 8);
    r = mix(r, 86, t);
    g = mix(g, 150, t);
    b = mix(b, 78, t);
  }
  const wobble = scale - 7;
  return rgb(r + wobble, g + wobble, b + Math.round(wobble * 0.6));
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
    if (prop.kind === 'forest') sprites.push({ depth, draw: () => drawTree(ctx, prop.x, prop.y, false) });
    else if (prop.kind === 'lime') sprites.push({ depth, draw: () => drawRock(ctx, prop.x, prop.y, '#d9d3c6', '#8d877c') });
    else if (prop.kind === 'iron') sprites.push({ depth, draw: () => drawRock(ctx, prop.x, prop.y, '#8d5344', '#5c342c') });
    else sprites.push({ depth, draw: () => drawMarsh(ctx, prop.x, prop.y) });
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
    sprites.push({
      depth: unitDepth(state, soldier.x, soldier.y),
      draw: () => drawFigure(ctx, soldier.x, soldier.y, color, moving(soldier), time, soldier.weapon === 'sword' ? 'sword' : 'club', null, false),
    });
  }
  sprites.sort((a, b) => a.depth - b.depth);
  for (const sprite of sprites) sprite.draw();
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
      return 28 + building.level * 6;
    case 'shack':
      return 16;
    case 'cabin':
    case 'dairy':
      return 20;
    case 'house':
    case 'brewery':
      return 24;
    case 'khrush':
      return 46;
    case 'highrise':
      return 72;
    case 'granary':
      return 26;
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
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#d7d0c2', '#a39c90', '#8d8578', true);
      crenellations(ctx, building.x, building.y, def.w, def.h, wall, Math.min(4, building.level + 1));
      break;
    case 'shack':
      drawTent(ctx, building.x, building.y, def.w, def.h, '#c4a06a', '#8d6a45');
      break;
    case 'cabin':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#c4a574', '#8d6a45', '#6e5134', true);
      break;
    case 'house':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#f0e2c4', '#c9b18a', '#a33b3b', true);
      windows(ctx, building.x, building.y, def.w, def.h, wall, 1, 2);
      break;
    case 'khrush':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#d7d2c6', '#b7b2a6', '#9aa097', false);
      windows(ctx, building.x, building.y, def.w, def.h, wall, 4, 4);
      break;
    case 'highrise':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#d5dde2', '#aeb8c0', '#8d98a1', false);
      windows(ctx, building.x, building.y, def.w, def.h, wall, 7, 3);
      break;
    case 'granary':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#c4553a', '#8d3a2c', '#f2d7a2', true);
      break;
    case 'stockpile':
      drawStockpile(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'woodcutter':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#c48a52', '#8a5a32', '#6e4b2e', true);
      break;
    case 'dairy':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#f4f1ea', '#d7d0c4', '#c4553a', true);
      drawCow(ctx, building.x + def.w * 0.7, building.y + def.h * 0.72);
      break;
    case 'hunter':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#8a6244', '#5c4030', '#6e5134', true);
      break;
    case 'wheat':
      drawField(ctx, building.x, building.y, def.w, def.h, '#d8b44a', '#a8872e');
      break;
    case 'mill':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#f4efe4', '#d9d0c2', '#8d6a45', true);
      drawBlades(ctx, building.x + def.w / 2, building.y + 0.3, time);
      break;
    case 'bakery':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#f0d2b0', '#c49578', '#c4553a', true);
      drawSmoke(ctx, building.x + def.w * 0.72, building.y + 0.25, wall, time);
      break;
    case 'hop':
      drawHop(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'brewery':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#6e5134', '#4a3424', '#3a2a22', true);
      drawVat(ctx, building.x + def.w * 0.65, building.y + def.h * 0.4);
      break;
    case 'tavern':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#a33b3b', '#6e2420', '#6e2420', true);
      drawSign(ctx, building.x + 0.4, building.y + def.h * 0.7, wall);
      break;
    case 'quarry':
      drawQuarry(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'mine':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#5c514c', '#3a3330', '#2a2422', false);
      drawMouth(ctx, building.x, building.y, def.w, def.h, wall);
      break;
    case 'pitch':
      drawPitch(ctx, building.x, building.y, def.w, def.h);
      break;
    case 'market':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#f4efe4', '#d8c598', '#e0a11b', false);
      break;
    case 'barracks':
      drawVolume(ctx, building.x, building.y, def.w, def.h, wall, '#8d93a0', '#5c6370', '#4e5560', true);
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

function drawTent(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cloth: string, shade: string) {
  const n = tileToIso(x, y);
  const e = tileToIso(x + w, y);
  const s = tileToIso(x + w, y + h);
  const west = tileToIso(x, y + h);
  const peak = lift({ x: (n.x + s.x) / 2, y: (n.y + s.y) / 2 }, 20);
  poly(ctx, [west, s, peak], cloth);
  poly(ctx, [s, e, peak], shade);
  poly(ctx, [e, n, peak], shade);
  poly(ctx, [n, west, peak], cloth);
}

function drawStockpile(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  poly(ctx, diamond(x, y, w, h), 'rgba(90,60,30,0.25)');
  drawRock(ctx, x + 0.4, y + 0.5, '#8a5a32', '#5c3a22');
  drawRock(ctx, x + 1.5, y + 0.8, '#d9d3c6', '#8d877c');
  drawRock(ctx, x + 0.8, y + 1.4, '#9a4e32', '#5c342c');
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

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, apples: boolean) {
  const p = tileToIso(x + 0.5, y + 0.5);
  ctx.fillStyle = 'rgba(20,14,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + 2, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6e4b2e';
  ctx.fillRect(p.x - 1.5, p.y - 10, 3, 10);
  ctx.fillStyle = '#2f7a3a';
  ctx.beginPath();
  ctx.arc(p.x, p.y - 16, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#246332';
  ctx.beginPath();
  ctx.arc(p.x + 4, p.y - 14, 5, 0, Math.PI * 2);
  ctx.fill();
  if (!apples) return;
  ctx.fillStyle = '#d6453c';
  ctx.beginPath();
  ctx.arc(p.x - 3, p.y - 16, 1.5, 0, Math.PI * 2);
  ctx.arc(p.x + 3, p.y - 13, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, light: string, dark: string) {
  const p = tileToIso(x + 0.5, y + 0.5);
  ctx.fillStyle = 'rgba(20,14,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(p.x + 2, p.y + 3, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(p.x - 8, p.y);
  ctx.lineTo(p.x, p.y - 12);
  ctx.lineTo(p.x + 9, p.y);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(p.x - 6, p.y);
  ctx.lineTo(p.x - 1, p.y - 8);
  ctx.lineTo(p.x + 2, p.y);
  ctx.fill();
}

function drawMarsh(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const p = tileToIso(x + 0.5, y + 0.5);
  ctx.fillStyle = '#1b1e1c';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a8f3a';
  ctx.beginPath();
  ctx.moveTo(p.x - 3, p.y);
  ctx.lineTo(p.x - 4, p.y - 8);
  ctx.moveTo(p.x + 2, p.y);
  ctx.lineTo(p.x + 3, p.y - 9);
  ctx.stroke();
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
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = tileToIso(cx + Math.cos(a) * def.nearRadius, cy + Math.sin(a) * def.nearRadius);
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
    ctx.arc(p.x + 6, p.y - 20, 2.2, 0, Math.PI * 2);
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
  const bob = walk ? Math.sin(time / 90 + ty) * 1.1 : 0;
  const x = base.x;
  const y = base.y + bob;
  ctx.fillStyle = 'rgba(20,14,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(base.x + 1, base.y + 2, 5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = '#fff4d2';
    ctx.strokeRect(x - 7, y - 20, 14, 22);
  }
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x - 3 + swing * 2, y + 1);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x + 3 - swing * 2, y + 1);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - 3.5, y - 14, 7, 8);
  ctx.fillStyle = '#f0c7a0';
  ctx.beginPath();
  ctx.arc(x, y - 16, 3, 0, Math.PI * 2);
  ctx.fill();
  if (tool) {
    ctx.strokeStyle = tool === 'sword' || tool === 'spear' ? '#d7dde2' : '#6e5134';
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 10);
    ctx.lineTo(x + 9, y - 18 + swing * 3);
    ctx.stroke();
    if (tool === 'apple') {
      ctx.fillStyle = '#d6453c';
      ctx.beginPath();
      ctx.arc(x + 9, y - 18 + swing * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (cargo) {
    ctx.fillStyle = '#6e5134';
    ctx.fillRect(x + 4, y - 12, 8, 7);
    ctx.fillStyle = CARGO[cargo] ?? '#ccc';
    ctx.fillRect(x + 5, y - 11, 6, 5);
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
