import { describe, expect, it } from 'vitest';
import { TICKS_PER_GAME_MINUTE, applyCommand, createGame, step, suggestedTile } from '../src/sim';
import type { BuildingType } from '../src/sim';

describe('открытие по подсказке', () => {
  it('десять игровых минут сад, амбар и шалаш держат настроение и людей', () => {
    const state = createGame(20261003, { ai: 0 });
    const player = state.players[0];
    const opening: BuildingType[] = ['granary', 'orchard', 'shack'];
    for (const building of opening) {
      const tile = suggestedTile(state, 0, building);
      expect(tile).not.toBeNull();
      expect(applyCommand(state, { kind: 'place', playerId: 0, building, x: tile!.x, y: tile!.y })).toBe(true);
    }

    const until = 10 * TICKS_PER_GAME_MINUTE;
    let assigned = false;
    let people = state.people.filter((p) => p.playerId === 0 && p.hp > 0).length;
    while (state.tick < until) {
      const orchard = state.buildings.find((b) => b.playerId === 0 && b.type === 'orchard');
      if (!assigned && orchard?.complete) {
        expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: orchard.id, delta: 1 })).toBe(true);
        assigned = true;
      }
      step(state, []);
      const now = state.people.filter((p) => p.playerId === 0 && p.hp > 0).length;
      expect(now, `на тике ${state.tick} кто-то пропал`).toBeGreaterThanOrEqual(people);
      people = now;
      expect(player.popularity, `настроение на тике ${state.tick}`).toBeGreaterThanOrEqual(0);
    }

    expect(assigned).toBe(true);
    expect(player.popularity).toBeGreaterThan(0);
    expect(people).toBeGreaterThanOrEqual(5);
    expect(player.hunger).toBe(false);
    expect(player.stocks.apples).toBeGreaterThan(0);
    expect(state.log.some((line) => line.includes('покинул'))).toBe(false);
  });
});
