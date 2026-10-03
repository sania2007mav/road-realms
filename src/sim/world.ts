import {
  emptyStocks,
  foodTypesIn,
  MAP_H,
  MAP_W,
  PLAYER_COLORS,
  PLAYER_NAMES,
  popularityTarget,
  START_GOLD,
  START_PEOPLE,
  START_STOCKS,
} from './balance';
import { createBuilding, createMob, createPerson } from './entities';
import { hash2 } from './rng';
import { Terrain, type GameState, type Player } from './types';

export interface SpawnPoint {
  x: number;
  y: number;
  side: 'north' | 'south';
}

export function planSpawns(count: number, mapW = MAP_W, mapH = MAP_H): { roadY: number; spawns: SpawnPoint[] } {
  const roadY = Math.floor(mapH / 2);
  const safe = Math.max(1, count);
  const margin = 24;
  const step = safe === 1 ? 0 : Math.floor((mapW - margin * 2) / (safe - 1));
  const spawns: SpawnPoint[] = [];
  for (let i = 0; i < safe; i++) {
    const side: 'north' | 'south' = i % 2 === 0 ? 'north' : 'south';
    const x = margin + i * step;
    const y = side === 'north' ? roadY - 18 : roadY + 18;
    spawns.push({ x, y, side });
  }
  return { roadY, spawns };
}

function setTile(terrain: Uint8Array, x: number, y: number, value: number) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  terrain[y * MAP_W + x] = value;
}

function stampDisc(terrain: Uint8Array, cx: number, cy: number, r: number, value: number, roadY: number) {
  const rr = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rr) continue;
      if (Math.abs(y - roadY) <= 1) continue;
      setTile(terrain, x, y, value);
    }
  }
}

function stampRect(terrain: Uint8Array, x0: number, y0: number, w: number, h: number, value: number, roadY: number) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (Math.abs(y - roadY) <= 1) continue;
      setTile(terrain, x, y, value);
    }
  }
}

function clearPad(terrain: Uint8Array, cx: number, cy: number, r: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) setTile(terrain, x, y, Terrain.Land);
  }
}

export function createGame(seed: number, opts?: { ai?: number }): GameState {
  const ai = Math.max(0, Math.min(3, opts?.ai ?? 3));
  const playerCount = 1 + ai;
  const { roadY, spawns } = planSpawns(playerCount);
  const terrain = new Uint8Array(MAP_W * MAP_H);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = hash2(seed, x, y) / 4294967296;
      const n2 = hash2(seed ^ 0x9e3779b9, Math.floor(x / 3), Math.floor(y / 3)) / 4294967296;
      terrain[y * MAP_W + x] = n * 0.65 + n2 * 0.35 > 0.72 ? Terrain.Desert : Terrain.Land;
    }
  }

  for (let i = 0; i < 10; i++) {
    const x = 8 + (hash2(seed, i, 3) % (MAP_W - 16));
    const y = 8 + (hash2(seed, i, 9) % (MAP_H - 16));
    const kindRoll = hash2(seed, i, 11) % 5;
    const radius = 3 + (hash2(seed, i, 12) % 3);
    const kind =
      kindRoll === 0 ? Terrain.Forest : kindRoll === 1 ? Terrain.Oasis : kindRoll === 2 ? Terrain.Limestone : kindRoll === 3 ? Terrain.Swamp : Terrain.Iron;
    if (kind === Terrain.Limestone || kind === Terrain.Iron || kind === Terrain.Swamp) {
      stampRect(terrain, x, y, radius + 2, radius + 1, kind, roadY);
    } else {
      stampDisc(terrain, x, y, radius, kind, roadY);
    }
  }

  spawns.forEach((spawn, index) => {
    const dir = spawn.side === 'north' ? -1 : 1;
    stampRect(terrain, spawn.x - 2, spawn.y + dir * 8, 7, 5, Terrain.Oasis, roadY);
    stampDisc(terrain, spawn.x, spawn.y + dir * 10, 4, Terrain.Oasis, roadY);
    stampDisc(terrain, spawn.x + 9, spawn.y + dir * 1, 4, Terrain.Forest, roadY);
    stampRect(terrain, spawn.x - 12, spawn.y + dir * 2, 4, 4, Terrain.Limestone, roadY);
    if (index % 2 === 0) {
      stampRect(terrain, spawn.x + 14, spawn.y + dir * 3, 3, 3, Terrain.Iron, roadY);
    } else {
      stampRect(terrain, spawn.x + 14, spawn.y + dir * 3, 4, 3, Terrain.Swamp, roadY);
    }
  });

  for (let i = 0; i < spawns.length - 1; i++) {
    const a = spawns[i];
    const b = spawns[i + 1];
    const mx = Math.round((a.x + b.x) / 2);
    stampRect(terrain, mx - 2, roadY - 12, 5, 4, Terrain.Iron, roadY);
    stampRect(terrain, mx - 1, roadY + 8, 5, 4, Terrain.Swamp, roadY);
    stampDisc(terrain, mx + 6, roadY - 10, 3, Terrain.Forest, roadY);
    stampRect(terrain, mx - 8, roadY + 9, 4, 3, Terrain.Limestone, roadY);
  }

  for (const spawn of spawns) clearPad(terrain, spawn.x, spawn.y, 3);

  for (let x = 0; x < MAP_W; x++) {
    setTile(terrain, x, roadY - 1, Terrain.Road);
    setTile(terrain, x, roadY, Terrain.Road);
    setTile(terrain, x, roadY + 1, Terrain.Road);
  }

  const state: GameState = {
    saveVersion: 1,
    seed: seed >>> 0,
    tick: 0,
    rng: (seed || 1) >>> 0,
    mapW: MAP_W,
    mapH: MAP_H,
    roadY,
    terrain,
    nextId: 1,
    players: [],
    buildings: [],
    people: [],
    soldiers: [],
    oxen: [],
    mobs: [],
    outcome: 'playing',
    message: '',
    log: [
      'Тракт пролегает через весь край. Поставьте амбар и склад.',
      'В запасе уже есть яблоки: успейте поставить сад и назначить работника.',
    ],
  };

  spawns.forEach((spawn, index) => {
    const stocks = emptyStocks();
    for (const [key, value] of Object.entries(START_STOCKS)) stocks[key as keyof typeof stocks] = value ?? 0;
    const player: Player = {
      id: index,
      name: PLAYER_NAMES[index] ?? `Посад ${index + 1}`,
      isAi: index !== 0,
      alive: true,
      side: spawn.side,
      spawnX: spawn.x,
      spawnY: spawn.y,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length],
      gold: START_GOLD,
      stocks,
      popularity: 0,
      ration: 'normal',
      tax: 'low',
      hunger: false,
      beerMood: 0,
      migrate: 0,
    };
    player.popularity = popularityTarget({
      ration: player.ration,
      foodTypes: foodTypesIn(player.stocks),
      tax: player.tax,
      beer: false,
      hunger: false,
    }).value;
    state.players.push(player);
    createBuilding(state, index, 'keep', spawn.x - 1, spawn.y - 1, true);
    for (let p = 0; p < START_PEOPLE; p++) {
      createPerson(state, index, spawn.x + (p - 2) * 0.45, spawn.y + 2.1, p);
    }
  });

  for (let i = 0; i < spawns.length - 1; i++) {
    const a = spawns[i];
    const b = spawns[i + 1];
    const mx = Math.round((a.x + b.x) / 2);
    createMob(state, 'wolf', mx - 1, roadY - 9);
    createMob(state, 'wolf', mx + 2, roadY - 8);
    createMob(state, 'bear', mx, roadY + 10);
    createMob(state, 'bandit', mx + 3, roadY + 11);
    createMob(state, 'bandit', mx - 3, roadY - 7);
    createMob(state, 'deer', mx + 6, roadY - 10);
    createMob(state, 'deer', mx + 7, roadY - 9);
    createMob(state, 'deer', mx + 5, roadY - 8);
  }

  for (const spawn of spawns) {
    const dir = spawn.side === 'north' ? -1 : 1;
    createMob(state, 'deer', spawn.x + 9, spawn.y + dir * 1);
    createMob(state, 'deer', spawn.x + 10.4, spawn.y + dir * 1.6);
    createMob(state, 'deer', spawn.x + 8.2, spawn.y + dir * 2);
    createMob(state, 'deer', spawn.x + 11, spawn.y + dir * 0.4);
  }

  for (let i = 0; i < 6; i++) {
    const x = 6 + (hash2(seed, 40 + i, 2) % (MAP_W - 12));
    const y = 6 + (hash2(seed, 40 + i, 4) % (MAP_H - 12));
    if (Math.abs(y - roadY) <= 2) continue;
    if (spawns.some((s) => Math.hypot(s.x - x, s.y - y) < 16)) continue;
    const kind = i % 3 === 0 ? 'bear' : i % 3 === 1 ? 'bandit' : 'wolf';
    createMob(state, kind, x, y);
  }

  return state;
}

export function terrainAt(state: GameState, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return Terrain.Desert;
  return state.terrain[y * state.mapW + x];
}
