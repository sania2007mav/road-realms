import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/world';
import { applyCommand, step } from '../src/sim/update';
import { hashState } from '../src/sim/hash';
import { approach } from '../src/sim/siege';
import { onRoad, ROAD_MULT } from '../src/sim/roads';
import { Terrain } from '../src/sim/types';

describe('дороги', () => {
  it('тракт уже дорога, а своя плитка стоит дерево и ускоряет шаг', () => {
    const state = createGame(4, { ai: 0 });
    expect(onRoad(state, 8, state.roadY)).toBe(true);
    const before = hashState(state);
    const wood = state.players[0].stocks.wood;
    const y = state.roadY + 8;
    const x = 20;
    state.terrain[y * state.mapW + x] = Terrain.Land;
    expect(applyCommand(state, { kind: 'road', playerId: 0, x, y })).toBe(true);
    expect(state.players[0].stocks.wood).toBe(wood - 1);
    expect(onRoad(state, x, y)).toBe(true);
    expect(applyCommand(state, { kind: 'road', playerId: 0, x, y })).toBe(true);
    expect(state.players[0].stocks.wood).toBe(wood - 1);
    expect(hashState(state)).not.toBe(before);
    expect(applyCommand(state, { kind: 'road', playerId: 0, x: 4, y: state.roadY })).toBe(false);

    const march = (paved: boolean) => {
      const game = createGame(4, { ai: 0 });
      const row = game.roadY + 8;
      for (let tile = 12; tile < 28; tile++) {
        game.terrain[row * game.mapW + tile] = Terrain.Land;
        if (paved) applyCommand(game, { kind: 'road', playerId: 0, x: tile, y: row });
      }
      const ent = { x: 12.2, y: row + 0.5 };
      for (let i = 0; i < 40; i++) approach(game, ent, 40, row + 0.5, 0.12, 0, 'worker');
      return ent.x;
    };
    const paved = march(true);
    const plain = march(false);
    expect(paved).toBeGreaterThan(plain);
    expect(paved - plain).toBeGreaterThan(0.12 * 40 * (ROAD_MULT - 1) * 0.4);
  });

  it('две партии с одной дорогой сходятся', () => {
    const run = () => {
      const state = createGame(9, { ai: 0 });
      const y = state.roadY + 6;
      state.terrain[y * state.mapW + 15] = Terrain.Desert;
      applyCommand(state, { kind: 'road', playerId: 0, x: 15, y });
      step(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
