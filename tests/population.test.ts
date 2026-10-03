import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createGame,
  housingCap,
  idleCount,
  playerKeep,
  step,
  suggestedTile,
  usedCount,
} from '../src/sim';

function withMarket(seed: number) {
  const state = createGame(seed, { ai: 0 });
  const keep = playerKeep(state, 0)!;
  keep.level = 2;
  state.players[0].stocks.wood = 400;
  return state;
}

function finish(state: ReturnType<typeof createGame>, type: 'market' | 'shack' | 'woodcutter') {
  const tile = suggestedTile(state, 0, type);
  expect(tile, type).not.toBeNull();
  expect(
    applyCommand(state, { kind: 'place', playerId: 0, building: type, x: tile!.x, y: tile!.y }),
  ).toBe(true);
  const building = state.buildings[state.buildings.length - 1];
  building.complete = true;
  return building;
}

describe('население и работы', () => {
  it('предел равен жилью, а человек занимает место только после назначения', () => {
    const state = createGame(11, { ai: 0 });
    expect(housingCap(state, 0)).toBe(5);
    expect(idleCount(state, 0)).toBe(5);
    expect(usedCount(state, 0)).toBe(0);
    expect(state.people.filter((p) => p.playerId === 0)).toHaveLength(5);

    state.players[0].stocks.wood = 200;
    const shack = finish(state, 'shack');
    expect(shack.complete).toBe(true);
    expect(housingCap(state, 0)).toBe(7);

    const pending = createGame(11, { ai: 0 });
    pending.players[0].stocks.wood = 50;
    const tile = suggestedTile(pending, 0, 'shack');
    applyCommand(pending, { kind: 'place', playerId: 0, building: 'shack', x: tile!.x, y: tile!.y });
    expect(housingCap(pending, 0)).toBe(5);

    const keep = playerKeep(state, 0)!;
    keep.level = 2;
    expect(housingCap(state, 0)).toBe(10);
    keep.level = 5;
    expect(housingCap(state, 0)).toBe(30);
  });

  it('не даёт занять больше людей, чем есть свободных', () => {
    const state = withMarket(12);
    const markets = [];
    for (let i = 0; i < 6; i++) markets.push(finish(state, 'market'));

    let assigned = 0;
    for (let i = 0; i < 5; i++) {
      const ok = applyCommand(state, { kind: 'assign', playerId: 0, buildingId: markets[i].id, delta: 1 });
      expect(ok).toBe(true);
      assigned += 1;
    }
    expect(assigned).toBe(5);
    expect(idleCount(state, 0)).toBe(0);
    expect(usedCount(state, 0)).toBe(5);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: markets[5].id, delta: 1 })).toBe(false);
    expect(state.message).toMatch(/свободн/i);

    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: markets[0].id, delta: -1 })).toBe(true);
    expect(idleCount(state, 0)).toBe(1);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: markets[5].id, delta: 1 })).toBe(true);
    expect(idleCount(state, 0)).toBe(0);
  });

  it('не назначает работника в недостроенное здание', () => {
    const state = withMarket(13);
    const tile = suggestedTile(state, 0, 'market')!;
    applyCommand(state, { kind: 'place', playerId: 0, building: 'market', x: tile.x, y: tile.y });
    const market = state.buildings[state.buildings.length - 1];
    expect(market.complete).toBe(false);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: market.id, delta: 1 })).toBe(false);
    expect(idleCount(state, 0)).toBe(5);
  });

  it('принимает людей только при положительном настроении и свободном жилье', () => {
    const state = createGame(14, { ai: 0 });
    state.mobs = [];
    state.players[0].stocks.apples = 500;
    state.players[0].stocks.wood = 40;
    for (let i = 0; i < 220; i++) step(state, []);
    expect(state.people.filter((p) => p.playerId === 0)).toHaveLength(5);

    finish(state, 'shack');
    for (let i = 0; i < 220; i++) step(state, []);
    expect(state.people.filter((p) => p.playerId === 0).length).toBeGreaterThan(5);
    expect(state.players[0].popularity).toBeGreaterThan(0);
  });

  it('отпускает людей, когда настроение отрицательное', () => {
    const state = createGame(15, { ai: 0 });
    state.mobs = [];
    state.players[0].stocks.apples = 0;
    state.players[0].stocks.cheese = 0;
    state.players[0].stocks.meat = 0;
    state.players[0].stocks.bread = 0;
    applyCommand(state, { kind: 'ration', playerId: 0, ration: 'none' });
    applyCommand(state, { kind: 'tax', playerId: 0, tax: 'cruel' });
    for (let i = 0; i < 420; i++) step(state, []);
    expect(state.players[0].popularity).toBeLessThan(0);
    expect(state.people.filter((p) => p.playerId === 0).length).toBeLessThan(5);
  });

  it('улучшает главное здание трудом строителя', () => {
    const state = createGame(16, { ai: 0 });
    state.mobs = [];
    state.players[0].stocks.wood = 80;
    state.players[0].stocks.stone = 40;
    const keep = playerKeep(state, 0)!;
    expect(applyCommand(state, { kind: 'upgrade', playerId: 0, buildingId: keep.id })).toBe(true);
    expect(keep.upgrading).toBe(true);
    for (let i = 0; i < 500; i++) step(state, []);
    expect(keep.level).toBe(2);
    expect(keep.upgrading).toBe(false);
    expect(housingCap(state, 0)).toBe(8);
  });
});
