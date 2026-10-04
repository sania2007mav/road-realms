import { describe, expect, it } from 'vitest';
import {
  MAP_W,
  MIN_SPAWN_DISTANCE,
  Terrain,
  createGame,
  suggestedTile,
  terrainAt,
} from '../src/sim';

describe('расстановка вдоль тракта', () => {
  it('ставит игроков по очереди по разные стороны, далеко друг от друга', () => {
    const state = createGame(20261003, { ai: 3 });
    expect(state.players.map((p) => p.side)).toEqual(['north', 'south', 'north', 'south']);
    for (const player of state.players) {
      if (player.side === 'north') expect(player.spawnY).toBeLessThan(state.roadY);
      else expect(player.spawnY).toBeGreaterThan(state.roadY);
    }
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
        const a = state.players[i];
        const b = state.players[j];
        const distance = Math.hypot(a.spawnX - b.spawnX, a.spawnY - b.spawnY);
        expect(distance).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
      }
    }
  });

  it('прокладывает прямой тракт и оставляет мобов с залежами между соседями', () => {
    const state = createGame(20261003, { ai: 3 });
    for (let x = 0; x < MAP_W; x++) {
      expect(terrainAt(state, x, state.roadY)).toBe(Terrain.Road);
      expect(terrainAt(state, x, state.roadY - 1)).toBe(Terrain.Road);
      expect(terrainAt(state, x, state.roadY + 1)).toBe(Terrain.Road);
    }

    const ordered = [...state.players].sort((a, b) => a.spawnX - b.spawnX);
    for (let i = 0; i < ordered.length - 1; i++) {
      const left = Math.min(ordered[i].spawnX, ordered[i + 1].spawnX);
      const right = Math.max(ordered[i].spawnX, ordered[i + 1].spawnX);
      const hostiles = state.mobs.filter(
        (mob) => mob.kind !== 'deer' && mob.x > left + 2 && mob.x < right - 2,
      );
      expect(hostiles.length).toBeGreaterThan(0);
      let rich = 0;
      for (let y = 0; y < state.mapH; y++) {
        for (let x = left + 2; x < right - 2; x++) {
          const terrain = terrainAt(state, x, y);
          if (terrain === Terrain.Iron || terrain === Terrain.Limestone || terrain === Terrain.Swamp) rich += 1;
        }
      }
      expect(rich).toBeGreaterThan(0);
    }
  });

  it('оставляет каждому поселению оазис, лес и место под первые постройки', () => {
    const state = createGame(20261003, { ai: 3 });
    for (const player of state.players) {
      let oasis = false;
      let forest = false;
      for (let y = player.spawnY - 16; y <= player.spawnY + 16; y++) {
        for (let x = player.spawnX - 16; x <= player.spawnX + 16; x++) {
          const terrain = terrainAt(state, x, y);
          if (terrain === Terrain.Oasis) oasis = true;
          if (terrain === Terrain.Forest) forest = true;
        }
      }
      expect(oasis).toBe(true);
      expect(forest).toBe(true);
    }
    expect(suggestedTile(state, 0, 'granary')).not.toBeNull();
    expect(suggestedTile(state, 0, 'stockpile')).not.toBeNull();
    expect(suggestedTile(state, 0, 'orchard')).not.toBeNull();
    expect(suggestedTile(state, 0, 'shack')).not.toBeNull();
    expect(suggestedTile(state, 0, 'woodcutter')).not.toBeNull();
  });
});
