import { describe, expect, it } from 'vitest';
import { applyCommand, canPlace, createGame, currentTarget, playerKeep, step, suggestedTile } from '../src/sim';
import type { BuildingType, GameState } from '../src/sim';

function prepare(seed: number): GameState {
  const state = createGame(seed, { ai: 0 });
  state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
  const keep = playerKeep(state, 0)!;
  keep.level = 5;
  state.players[0].stocks.wood = 500;
  state.players[0].stocks.stone = 500;
  state.players[0].stocks.iron = 50;
  state.players[0].ration = 'none';
  return state;
}

function place(state: GameState, type: BuildingType) {
  const tile = suggestedTile(state, 0, type);
  expect(tile, type).not.toBeNull();
  const ok = applyCommand(state, { kind: 'place', playerId: 0, building: type, x: tile!.x, y: tile!.y });
  expect(ok, `${type}: ${state.message}`).toBe(true);
  const building = state.buildings[state.buildings.length - 1];
  building.complete = true;
  return building;
}

describe('производственные цепочки', () => {
  it('не открывает пекарню, пока главное здание слабое', () => {
    const state = createGame(21, { ai: 0 });
    const keep = playerKeep(state, 0)!;
    expect(canPlace(state, 0, 'bakery', keep.x + 4, keep.y).reason).toMatch(/уров/);
    expect(canPlace(state, 0, 'mill', keep.x + 4, keep.y).reason).toMatch(/уров/);
  });

  it('ведёт пшеницу через мельницу и пекарню в хлеб', () => {
    const state = prepare(21);
    place(state, 'granary');
    place(state, 'stockpile');
    const wheat = place(state, 'wheat');
    const mill = place(state, 'mill');
    const bakery = place(state, 'bakery');
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: wheat.id, delta: 1 })).toBe(true);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: mill.id, delta: 1 })).toBe(true);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: bakery.id, delta: 1 })).toBe(true);

    let bread = 0;
    for (let i = 0; i < 3500; i++) {
      step(state, []);
      if (state.players[0].stocks.bread > bread) bread = state.players[0].stocks.bread;
    }
    expect(bread).toBeGreaterThan(0);
    expect(state.players[0].stocks.bread).toBeGreaterThan(0);
  });

  it('волы отвозят камень из каменоломни на склад', () => {
    const state = prepare(22);
    place(state, 'stockpile');
    const quarry = place(state, 'quarry');
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: quarry.id, delta: 1 })).toBe(true);
    const start = state.players[0].stocks.stone;
    for (let i = 0; i < 2500; i++) step(state, []);
    expect(state.oxen.some((ox) => ox.buildingId === quarry.id)).toBe(true);
    expect(state.players[0].stocks.stone).toBeGreaterThan(start);
  });

  it('варит пиво и поднимает им настроение', () => {
    const state = prepare(23);
    place(state, 'stockpile');
    const hop = place(state, 'hop');
    const brewery = place(state, 'brewery');
    const tavern = place(state, 'tavern');
    applyCommand(state, { kind: 'assign', playerId: 0, buildingId: hop.id, delta: 1 });
    applyCommand(state, { kind: 'assign', playerId: 0, buildingId: brewery.id, delta: 1 });
    applyCommand(state, { kind: 'assign', playerId: 0, buildingId: tavern.id, delta: 1 });
    let cheer = false;
    for (let i = 0; i < 4000; i++) {
      step(state, []);
      if (state.players[0].beerMood > 0) cheer = true;
    }
    expect(cheer).toBe(true);
    const report = currentTarget(state, 0);
    const beerSeen = state.players[0].beerMood > 0 || report.reasons.some((r) => r.label.includes('Пиво'));
    expect(beerSeen || cheer).toBe(true);
  });
});
