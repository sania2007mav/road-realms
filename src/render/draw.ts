import { BUILDINGS } from '../sim/balance';
import { hash2 } from '../sim/rng';
import type { Building, BuildingType, GameState, Mob, Person, Resource } from '../sim/types';
import { Terrain } from '../sim/types';
import { terrainAt } from '../sim/world';
import { TILE, type Camera } from './camera';

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  ok: boolean;
}

const GROUND: Record<number, [string, string]> = {
  [Terrain.Land]: ['#d2c093', '#c4b184'],
  [Terrain.Desert]: ['#ead7a2', '#e3cc90'],
  [Terrain.Oasis]: ['#3f9d4c', '#4eae5b'],
  [Terrain.Forest]: ['#cbb98a', '#d8c598'],
  [Terrain.Limestone]: ['#d9d3c6', '#cdc6b6'],
  [Terrain.Iron]: ['#8d756b', '#746055'],
  [Terrain.Swamp]: ['#2b302c', '#1b1e1c'],
  [Terrain.Road]: ['#b58858', '#9a7044'],
};

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

const lastPos = new WeakMap<object, { x: number; y: number }>();

function moving(ent: { x: number; y: number }): boolean {
  const prev = lastPos.get(ent);
  lastPos.set(ent, { x: ent.x, y: ent.y });
  if (!prev) return false;
  return Math.abs(prev.x - ent.x) > 0.0015 || Math.abs(prev.y - ent.y) > 0.0015;
}

export function bakeTerrain(state: GameState): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = state.mapW * TILE;
  canvas.height = state.mapH * TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      const terrain = terrainAt(state, x, y);
      const pair = GROUND[terrain] ?? GROUND[Terrain.Land];
      const tint = hash2(state.seed, x, y) % 2 === 0 ? pair[0] : pair[1];
      ctx.fillStyle = tint;
      ctx.fillRect(x * TILE, y * TILE, TILE + 0.5, TILE + 0.5);
      drawDecoration(ctx, state.seed, x, y, terrain);
    }
  }
  return canvas;
}

function drawDecoration(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, terrain: number) {
  const px = x * TILE;
  const py = y * TILE;
  const n = hash2(seed, x + 9, y + 3);
  if (terrain === Terrain.Oasis) {
    ctx.fillStyle = n % 3 === 0 ? '#f2d15a' : '#8fd18a';
    ctx.beginPath();
    ctx.arc(px + 6 + (n % 8), py + 8 + ((n >> 3) % 10), 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 20, py + 18, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (terrain === Terrain.Forest) {
    const h = 10 + (n % 6);
    ctx.fillStyle = 'rgba(40, 30, 16, 0.25)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 24, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#245c30';
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 4);
    ctx.lineTo(px + 26, py + 8 + h);
    ctx.lineTo(px + 6, py + 8 + h);
    ctx.fill();
    ctx.fillStyle = '#2f7a3c';
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 8);
    ctx.lineTo(px + 24, py + 18);
    ctx.lineTo(px + 8, py + 18);
    ctx.fill();
  } else if (terrain === Terrain.Limestone || terrain === Terrain.Iron) {
    ctx.fillStyle = terrain === Terrain.Iron ? '#5c4038' : '#eee8dc';
    ctx.beginPath();
    ctx.ellipse(px + 12, py + 16, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px + 20, py + 18, 4, 3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    if (terrain === Terrain.Iron) {
      ctx.fillStyle = '#a24a2a';
      ctx.fillRect(px + 11, py + 14, 2, 2);
    }
  } else if (terrain === Terrain.Swamp) {
    ctx.fillStyle = 'rgba(180, 200, 160, 0.18)';
    ctx.beginPath();
    ctx.ellipse(px + 10 + (n % 6), py + 14, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (terrain === Terrain.Road) {
    ctx.fillStyle = 'rgba(255, 236, 196, 0.28)';
    ctx.fillRect(px, py + 2, TILE, 2);
    ctx.fillRect(px, py + TILE - 4, TILE, 2);
    if (x % 2 === 0) {
      ctx.fillStyle = 'rgba(90, 58, 32, 0.45)';
      ctx.fillRect(px + 14, py + 14, 4, 3);
    }
  } else if (n % 11 === 0) {
    ctx.fillStyle = 'rgba(90, 70, 40, 0.18)';
    ctx.fillRect(px + 8, py + 18, 6, 2);
  }
}

export function bakeMinimap(state: GameState): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = state.mapW;
  canvas.height = state.mapH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  for (let y = 0; y < state.mapH; y++) {
    for (let x = 0; x < state.mapW; x++) {
      const terrain = terrainAt(state, x, y);
      ctx.fillStyle = (GROUND[terrain] ?? GROUND[Terrain.Land])[0];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewW: number,
  viewH: number,
  dpr: number,
  baked: HTMLCanvasElement,
  ghost: Ghost | null,
  selectedId: number | null,
  time: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#c8b48a';
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.setTransform(
    dpr * camera.zoom,
    0,
    0,
    dpr * camera.zoom,
    dpr * (viewW / 2 - camera.x * camera.zoom),
    dpr * (viewH / 2 - camera.y * camera.zoom),
  );
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baked, 0, 0);

  const margin = 80;
  const left = camera.x - viewW / (2 * camera.zoom) - margin;
  const right = camera.x + viewW / (2 * camera.zoom) + margin;
  const top = camera.y - viewH / (2 * camera.zoom) - margin;
  const bottom = camera.y + viewH / (2 * camera.zoom) + margin;
  const seen = (x: number, y: number) => x * TILE >= left && x * TILE <= right && y * TILE >= top && y * TILE <= bottom;

  type Sprite = { y: number; draw: () => void };
  const sprites: Sprite[] = [];

  for (const building of state.buildings) {
    if (building.hp <= 0 && building.type !== 'keep') continue;
    const def = BUILDINGS[building.type];
    const foot = (building.y + def.h) * TILE;
    if (!seen(building.x + def.w / 2, building.y + def.h / 2)) continue;
    sprites.push({
      y: foot,
      draw: () => drawBuilding(ctx, state, building, selectedId === building.id, time),
    });
  }
  if (ghost) {
    const def = BUILDINGS[ghost.type];
    sprites.push({
      y: (ghost.y + def.h) * TILE + 1,
      draw: () => drawGhost(ctx, ghost),
    });
  }
  for (const mob of state.mobs) {
    if (!mob.alive || !seen(mob.x, mob.y)) continue;
    const walk = moving(mob);
    sprites.push({ y: mob.y * TILE, draw: () => drawMob(ctx, mob, walk, time) });
  }
  for (const ox of state.oxen) {
    if (!seen(ox.x, ox.y)) continue;
    const walk = moving(ox);
    sprites.push({
      y: ox.y * TILE,
      draw: () => drawOx(ctx, ox.x, ox.y, walk, time, ox.cargo),
    });
  }
  for (const person of state.people) {
    if (person.hp <= 0 || !seen(person.x, person.y)) continue;
    const walk = moving(person);
    sprites.push({
      y: person.y * TILE,
      draw: () => drawPerson(ctx, state, person, walk, time),
    });
  }
  for (const soldier of state.soldiers) {
    if (soldier.hp <= 0 || !seen(soldier.x, soldier.y)) continue;
    const walk = moving(soldier);
    sprites.push({
      y: soldier.y * TILE,
      draw: () => drawSoldier(ctx, state.players[soldier.playerId]?.color ?? '#eee', soldier.x, soldier.y, walk, time, soldier.weapon),
    });
  }
  sprites.sort((a, b) => a.y - b.y);
  for (const sprite of sprites) sprite.draw();
}

function drawBuilding(ctx: CanvasRenderingContext2D, state: GameState, building: Building, selected: boolean, time: number) {
  const def = BUILDINGS[building.type];
  const x = building.x * TILE;
  const y = building.y * TILE;
  const w = def.w * TILE;
  const h = def.h * TILE;
  const color = state.players[building.playerId]?.color ?? '#888';
  ctx.save();
  if (!building.complete || building.upgrading) ctx.globalAlpha = 0.78;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h - 4, w * 0.42, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  switch (building.type) {
    case 'keep':
      drawKeep(ctx, x, y, w, h, color, building.level);
      break;
    case 'shack':
      ctx.fillStyle = '#c4a06a';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 6);
      ctx.lineTo(x + w - 4, y + h - 6);
      ctx.lineTo(x + 4, y + h - 6);
      ctx.fill();
      ctx.fillStyle = '#6b3e28';
      ctx.fillRect(x + w / 2 - 3, y + h - 16, 6, 10);
      break;
    case 'cabin':
      box(ctx, x + 4, y + 10, w - 8, h - 16, '#8d6a45', '#6e5134');
      ctx.fillStyle = '#d7dde2';
      ctx.fillRect(x + 8, y + 16, w - 16, 8);
      break;
    case 'house':
      ctx.fillStyle = '#a33b3b';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 16);
      ctx.lineTo(x + w / 2, y + 2);
      ctx.lineTo(x + w - 2, y + 16);
      ctx.fill();
      box(ctx, x + 6, y + 16, w - 12, h - 22, '#f0e2c4', '#c9b18a');
      ctx.fillStyle = '#6ec1d6';
      ctx.fillRect(x + 12, y + 22, 8, 8);
      break;
    case 'khrush':
      box(ctx, x + 3, y + 6, w - 6, h - 10, '#d7d2c6', '#b7b2a6');
      ctx.fillStyle = '#8fd0ea';
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) ctx.fillRect(x + 8 + col * 14, y + 10 + row * 10, 8, 6);
      }
      break;
    case 'highrise':
      box(ctx, x + 8, y + 2, w - 16, h - 8, '#c9d0d4', '#9aa6ad');
      ctx.fillStyle = '#f2e2a8';
      for (let row = 0; row < 6; row++) {
        ctx.fillRect(x + 14, y + 8 + row * 10, 7, 6);
        ctx.fillRect(x + w - 22, y + 8 + row * 10, 7, 6);
      }
      break;
    case 'granary':
      box(ctx, x + 4, y + 8, w - 8, h - 12, '#c4553a', '#8d3a2c');
      ctx.fillStyle = '#f2d7a2';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2 + 2, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stockpile':
      ctx.fillStyle = 'rgba(120, 84, 48, 0.25)';
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeStyle = '#8a5a32';
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = '#8a5a32';
      ctx.fillRect(x + 8, y + 10, 14, 10);
      ctx.fillStyle = '#d9d3c6';
      ctx.fillRect(x + 26, y + 16, 12, 10);
      ctx.fillStyle = '#9a4e32';
      ctx.fillRect(x + 16, y + 28, 16, 8);
      break;
    case 'woodcutter':
      box(ctx, x + 6, y + 12, w - 12, h - 18, '#a97848', '#6e4b2e');
      ctx.strokeStyle = '#4a3424';
      ctx.beginPath();
      ctx.moveTo(x + w - 8, y + 8);
      ctx.lineTo(x + w - 2, y + h - 8);
      ctx.stroke();
      break;
    case 'orchard':
      ctx.fillStyle = '#357a3e';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const tx = x + 16 + col * 28;
          const ty = y + 18 + row * 28;
          ctx.fillStyle = '#246b32';
          ctx.beginPath();
          ctx.arc(tx, ty, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#d6453c';
          ctx.beginPath();
          ctx.arc(tx - 3, ty - 1, 1.6, 0, Math.PI * 2);
          ctx.arc(tx + 3, ty + 2, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    case 'dairy':
      box(ctx, x + 6, y + 14, w - 12, h - 20, '#f4f1ea', '#d7d0c4');
      ctx.fillStyle = '#f7f7f7';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.65, y + h * 0.62, 12, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(x + w * 0.62, y + h * 0.55, 3, 3);
      ctx.fillRect(x + w * 0.74, y + h * 0.62, 3, 3);
      break;
    case 'hunter':
      box(ctx, x + 6, y + 14, w - 12, h - 18, '#6e5134', '#4e3924');
      ctx.strokeStyle = '#f2e6d0';
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 12);
      ctx.lineTo(x + 8, y + 4);
      ctx.moveTo(x + 12, y + 12);
      ctx.lineTo(x + 18, y + 4);
      ctx.stroke();
      break;
    case 'wheat':
      ctx.fillStyle = '#d8b44a';
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeStyle = '#a8872e';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 8 + i * 12);
        ctx.lineTo(x + w - 8, y + 8 + i * 12);
        ctx.stroke();
      }
      break;
    case 'mill': {
      box(ctx, x + 8, y + 16, w - 16, h - 20, '#f4efe4', '#d9d0c2');
      const angle = time / 500;
      ctx.strokeStyle = '#8d6a45';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 16);
      ctx.lineTo(x + w / 2 + Math.cos(angle) * 16, y + 16 + Math.sin(angle) * 16);
      ctx.moveTo(x + w / 2, y + 16);
      ctx.lineTo(x + w / 2 + Math.cos(angle + Math.PI) * 16, y + 16 + Math.sin(angle + Math.PI) * 16);
      ctx.stroke();
      ctx.lineWidth = 1;
      break;
    }
    case 'bakery':
      box(ctx, x + 4, y + 12, w - 8, h - 16, '#f0d2b0', '#c4553a');
      ctx.fillStyle = '#f2e6d0';
      ctx.fillRect(x + 10, y + 18, 10, 6);
      break;
    case 'hop':
      ctx.fillStyle = '#3f7a32';
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeStyle = '#d8c598';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 10 + i * 14, y + h - 8);
        ctx.lineTo(x + 10 + i * 14, y + 8);
        ctx.stroke();
      }
      break;
    case 'brewery':
      box(ctx, x + 4, y + 10, w - 8, h - 14, '#6e5134', '#4a3424');
      ctx.fillStyle = '#e0a11b';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tavern':
      box(ctx, x + 4, y + 12, w - 8, h - 16, '#a33b3b', '#6e2420');
      ctx.fillStyle = '#f2d15a';
      ctx.fillRect(x + 10, y + 4, 18, 10);
      ctx.fillStyle = '#222';
      ctx.font = '8px sans-serif';
      ctx.fillText('пиво', x + 12, y + 12);
      break;
    case 'quarry':
      ctx.fillStyle = '#b7b1a4';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = '#8a8478';
      ctx.beginPath();
      ctx.moveTo(x + 8, y + h - 6);
      ctx.lineTo(x + w / 2, y + 8);
      ctx.lineTo(x + w - 8, y + h - 6);
      ctx.fill();
      break;
    case 'mine':
      box(ctx, x + 4, y + 8, w - 8, h - 12, '#5c514c', '#3a3330');
      ctx.fillStyle = '#1a1614';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2 + 2, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'pitch':
      box(ctx, x + 6, y + 10, w - 12, h - 14, '#3a3a38', '#222');
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'market':
      ctx.fillStyle = '#e0a11b';
      ctx.fillRect(x + 4, y + 8, w - 8, 8);
      box(ctx, x + 6, y + 16, w - 12, h - 22, '#f4efe4', '#d8c598');
      break;
    case 'barracks':
      box(ctx, x + 4, y + 10, w - 8, h - 14, '#6d7380', '#4e5560');
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + h - 6);
      ctx.lineTo(x + 12, y + 6);
      ctx.moveTo(x + w - 12, y + h - 6);
      ctx.lineTo(x + w - 12, y + 8);
      ctx.stroke();
      break;
    default:
      box(ctx, x + 4, y + 4, w - 8, h - 8, '#ccc', '#888');
  }

  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 3, 7, 10);
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(x + 8, y + 3, 4, 6);

  if (building.plague > 0) {
    ctx.fillStyle = '#9be07a';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('чума', x + 8, y + 14);
  }
  if (!building.complete || building.upgrading) {
    const need = building.upgrading ? 220 : def.buildTicks || 1;
    const ratio = Math.max(0, Math.min(1, building.buildProgress / need));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 4, y + h - 8, w - 8, 4);
    ctx.fillStyle = '#e6b15a';
    ctx.fillRect(x + 4, y + h - 8, (w - 8) * ratio, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }
  if (selected) {
    ctx.strokeStyle = '#fff4d2';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.lineWidth = 1;
  }
  if (building.hp < building.maxHp) {
    ctx.fillStyle = '#3a2018';
    ctx.fillRect(x + 4, y - 4, w - 8, 3);
    ctx.fillStyle = '#d4543c';
    ctx.fillRect(x + 4, y - 4, (w - 8) * Math.max(0, building.hp / building.maxHp), 3);
  }
  ctx.restore();
}

function drawKeep(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, level: number) {
  box(ctx, x + 6, y + 10, w - 12, h - 14, '#d9d3c6', '#8d8578');
  const towers = Math.min(4, level);
  for (let i = 0; i < towers; i++) {
    ctx.fillStyle = '#c9c3b4';
    ctx.fillRect(x + 8 + i * 4, y + 6, 3, 6);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x + w / 2 - 2, y + 2, 4, 16);
  ctx.fillRect(x + w / 2 - 2, y + 2, 12, 7);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, roof: string) {
  ctx.fillStyle = roof;
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y + 5, w, h - 5);
}

function drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost) {
  const def = BUILDINGS[ghost.type];
  const x = ghost.x * TILE;
  const y = ghost.y * TILE;
  const w = def.w * TILE;
  const h = def.h * TILE;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = ghost.ok ? '#7dba5a' : '#d4543c';
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = ghost.ok ? '#edffe4' : '#ffd0c8';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.restore();
}

function drawPerson(ctx: CanvasRenderingContext2D, state: GameState, person: Person, walk: boolean, time: number) {
  const color = state.players[person.playerId]?.color ?? '#ccc';
  const swing = walk ? Math.sin(time / 90 + person.anim) : 0;
  const bob = walk ? Math.sin(time / 90 + person.anim) * 1.2 : 0;
  const x = person.x * TILE;
  const y = person.y * TILE + bob;
  shadow(ctx, x, person.y * TILE);
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 1);
  ctx.lineTo(x - 3 + swing * 3, y + 8);
  ctx.moveTo(x, y + 1);
  ctx.lineTo(x + 3 - swing * 3, y + 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - 4, y - 7, 8, 9);
  ctx.fillStyle = '#f0c7a0';
  ctx.beginPath();
  ctx.arc(x, y - 10, 3.3, 0, Math.PI * 2);
  ctx.fill();
  if (person.task.type === 'idle') {
    ctx.fillStyle = '#ffd45a';
    ctx.beginPath();
    ctx.arc(x + 6, y - 16, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (person.cargo) {
    ctx.fillStyle = CARGO[person.cargo] ?? '#ccc';
    ctx.fillRect(x + 4, y - 5, 5, 4);
  }
  ctx.lineWidth = 1;
}

function drawSoldier(
  ctx: CanvasRenderingContext2D,
  color: string,
  tx: number,
  ty: number,
  walk: boolean,
  time: number,
  weapon: 'club' | 'sword',
) {
  const swing = walk ? Math.sin(time / 80) : 0;
  const x = tx * TILE;
  const y = ty * TILE;
  shadow(ctx, x, y);
  ctx.strokeStyle = '#3a2a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 3 + swing * 3, y + 8);
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3 - swing * 3, y + 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x - 4, y - 8, 8, 9);
  ctx.fillStyle = '#d9d3c6';
  ctx.fillRect(x - 4, y - 12, 8, 4);
  ctx.strokeStyle = weapon === 'sword' ? '#d7dde2' : '#6e5134';
  ctx.beginPath();
  ctx.moveTo(x + 4, y - 2);
  ctx.lineTo(x + 10, y - 12);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawOx(ctx: CanvasRenderingContext2D, tx: number, ty: number, walk: boolean, time: number, cargo: Resource | null) {
  const x = tx * TILE;
  const y = ty * TILE + (walk ? Math.sin(time / 140) : 0);
  shadow(ctx, x, ty * TILE);
  ctx.fillStyle = '#8a5a32';
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0e2c4';
  ctx.beginPath();
  ctx.arc(x + 8, y - 2, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a2a22';
  ctx.beginPath();
  ctx.moveTo(x + 10, y - 4);
  ctx.lineTo(x + 14, y - 8);
  ctx.moveTo(x + 8, y - 4);
  ctx.lineTo(x + 6, y - 9);
  ctx.stroke();
  if (cargo) {
    ctx.fillStyle = CARGO[cargo] ?? '#ccc';
    ctx.fillRect(x - 5, y - 8, 8, 5);
  }
}

function drawMob(ctx: CanvasRenderingContext2D, mob: Mob, walk: boolean, time: number) {
  const x = mob.x * TILE;
  const y = mob.y * TILE + (walk ? Math.sin(time / 100 + mob.id) * 0.8 : 0);
  shadow(ctx, x, mob.y * TILE);
  if (mob.kind === 'deer') {
    ctx.fillStyle = '#c48a52';
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 6, y - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a5a32';
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x + 3, y - 11);
    ctx.moveTo(x + 7, y - 6);
    ctx.lineTo(x + 11, y - 11);
    ctx.stroke();
  } else if (mob.kind === 'wolf') {
    ctx.fillStyle = '#8d9094';
    ctx.beginPath();
    ctx.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 2);
    ctx.lineTo(x + 12, y - 1);
    ctx.lineTo(x + 6, y + 2);
    ctx.fill();
    ctx.fillStyle = '#d4543c';
    ctx.fillRect(x + 4, y - 5, 2, 2);
  } else if (mob.kind === 'bear') {
    ctx.fillStyle = '#5c4030';
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 8, y - 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 5, y - 7, 2.2, 0, Math.PI * 2);
    ctx.arc(x + 11, y - 7, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawSoldier(ctx, '#6e2420', mob.x, mob.y, walk, time, 'club');
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 4, mob.y * TILE - 14, 8, 3);
  }
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: Camera,
  viewW: number,
  viewH: number,
  baked: HTMLCanvasElement,
  width: number,
  height: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baked, 0, 0, width, height);
  const sx = width / state.mapW;
  const sy = height / state.mapH;
  for (const building of state.buildings) {
    if (building.hp <= 0) continue;
    const color = state.players[building.playerId]?.color ?? '#fff';
    ctx.fillStyle = color;
    const def = BUILDINGS[building.type];
    ctx.fillRect(building.x * sx, building.y * sy, Math.max(2, def.w * sx), Math.max(2, def.h * sy));
  }
  const left = (camera.x - viewW / (2 * camera.zoom)) / TILE;
  const top = (camera.y - viewH / (2 * camera.zoom)) / TILE;
  const rw = viewW / camera.zoom / TILE;
  const rh = viewH / camera.zoom / TILE;
  ctx.strokeStyle = '#fff4d2';
  ctx.lineWidth = 1;
  ctx.strokeRect(left * sx, top * sy, rw * sx, rh * sy);
}
