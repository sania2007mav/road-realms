import { describe, expect, it } from 'vitest';
import { BUILDINGS, Terrain, applyCommand, canPlace, createGame, step, suggestedTile, terrainAt, workRange, workerStatus } from '../src/sim';
import type { BuildingType } from '../src/sim';

function forestInRange(state: ReturnType<typeof createGame>, x: number, y: number) {
  const def = BUILDINGS.woodcutter;
  const radius = workRange(def);
  const cx = x + def.w / 2;
  const cy = y + def.h / 2;
  for (let ty = Math.floor(cy - radius - 1); ty <= Math.ceil(cy + radius + 1); ty++) {
    for (let tx = Math.floor(cx - radius - 1); tx <= Math.ceil(cx + radius + 1); tx++) {
      if (terrainAt(state, tx, ty) !== Terrain.Forest) continue;
      if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) <= radius + 0.05) return true;
    }
  }
  return false;
}

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

  it('лесоруб ставится только внутри круга леса и не пишет ложную тревогу', () => {
    const state = createGame(20261003, { ai: 0 });
    const keep = state.buildings.find((b) => b.type === 'keep' && b.playerId === 0)!;
    let legal = 0;
    for (let y = keep.y - 16; y <= keep.y + 16; y++) {
      for (let x = keep.x - 16; x <= keep.x + 16; x++) {
        if (!canPlace(state, 0, 'woodcutter', x, y).ok) continue;
        legal += 1;
        expect(forestInRange(state, x, y)).toBe(true);
      }
    }
    expect(legal).toBeGreaterThan(0);
    const tile = suggestedTile(state, 0, 'woodcutter');
    expect(tile).not.toBeNull();
    expect(applyCommand(state, { kind: 'place', playerId: 0, building: 'woodcutter', x: tile!.x, y: tile!.y })).toBe(true);
    const hut = state.buildings.find((b) => b.type === 'woodcutter')!;
    hut.complete = true;
    hut.hp = hut.maxHp;
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: hut.id, delta: 1 })).toBe(true);
    for (let i = 0; i < 80; i++) step(state, []);
    const person = state.people.find((p) => p.playerId === 0 && p.task.type === 'work')!;
    expect(workerStatus(state, person)).not.toContain('нет леса');
    expect(state.log.some((line) => line.includes('нет леса'))).toBe(false);
    const outside = canPlace(state, 0, 'woodcutter', keep.x - 10, keep.y - 6);
    if (outside.ok) expect(forestInRange(state, keep.x - 10, keep.y - 6)).toBe(true);
    else expect(outside.reason).not.toBe('');
  });

  it('соседи не оставляют лесоруба без леса в том же круге', () => {
    const state = createGame(20261003, { ai: 3 });
    for (let i = 0; i < 500; i++) step(state, []);
    const huts = state.buildings.filter((b) => b.type === 'woodcutter' && b.hp > 0);
    expect(huts.length).toBeGreaterThan(0);
    for (const hut of huts) expect(forestInRange(state, hut.x, hut.y)).toBe(true);
    expect(state.log.some((line) => line.includes('нет леса'))).toBe(false);
  });
});
