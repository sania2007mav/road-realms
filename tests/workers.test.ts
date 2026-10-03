import { describe, expect, it } from 'vitest';
import { BUILDINGS, applyCommand, createGame, step, suggestedTile, workerStatus } from '../src/sim';
import type { BuildingType } from '../src/sim';

function placeReady(seed: number, types: BuildingType[]) {
  const state = createGame(seed, { ai: 0 });
  state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
  for (const building of types) {
    const tile = suggestedTile(state, 0, building);
    expect(tile, building).not.toBeNull();
    expect(applyCommand(state, { kind: 'place', playerId: 0, building, x: tile!.x, y: tile!.y })).toBe(true);
    const built = state.buildings[state.buildings.length - 1];
    built.complete = true;
    built.hp = built.maxHp;
  }
  return state;
}

describe('назначенный работник', () => {
  it('доходит до сада и приносит яблоки в амбар', () => {
    const state = placeReady(20261003, ['granary', 'orchard']);
    const orchard = state.buildings.find((b) => b.type === 'orchard')!;
    const def = BUILDINGS.orchard;
    const workerBefore = state.people.filter((p) => p.playerId === 0 && p.hp > 0);
    expect(workerBefore).toHaveLength(5);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: orchard.id, delta: 1 })).toBe(true);
    const worker = state.people.find((p) => p.playerId === 0 && p.task.type === 'work')!;
    const start = { x: worker.x, y: worker.y };
    const startApples = state.players[0].stocks.apples;
    const seen = new Set<string>();
    let reached = false;
    for (let i = 0; i < 500; i++) {
      step(state, []);
      const person = state.people.find((p) => p.id === worker.id);
      expect(person, 'работник исчез').toBeDefined();
      expect(person!.hp).toBeGreaterThan(0);
      expect(person!.task.type).toBe('work');
      seen.add(workerStatus(state, person!));
      const nearX = person!.x >= orchard.x - 0.8 && person!.x <= orchard.x + def.w + 0.8;
      const nearY = person!.y >= orchard.y - 0.8 && person!.y <= orchard.y + def.h + 0.8;
      if (nearX && nearY) reached = true;
      if (reached && state.players[0].stocks.apples > startApples) break;
    }
    const person = state.people.find((p) => p.id === worker.id)!;
    expect(Math.hypot(person.x - start.x, person.y - start.y)).toBeGreaterThan(1);
    expect(reached).toBe(true);
    expect(state.players[0].stocks.apples).toBeGreaterThan(startApples);
    expect([...seen]).toContain('идёт на работу');
    expect([...seen].some((line) => line === 'работает' || line.startsWith('несёт яблоки'))).toBe(true);
  });

  it('ждёт и пишет в журнал, если яблоки некуда нести', () => {
    const state = placeReady(7, ['orchard']);
    const orchard = state.buildings.find((b) => b.type === 'orchard')!;
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: orchard.id, delta: 1 })).toBe(true);
    let status = '';
    for (let i = 0; i < 400; i++) {
      step(state, []);
      const person = state.people.find((p) => p.playerId === 0 && p.task.type === 'work')!;
      status = workerStatus(state, person);
      if (status.startsWith('ждёт')) break;
    }
    expect(status).toBe('ждёт: нет амбара');
    expect(state.log.some((line) => line.includes('ждёт: нет амбара'))).toBe(true);
  });
});
