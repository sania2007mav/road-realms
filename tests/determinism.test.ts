import { describe, expect, it } from 'vitest';
import { createGame, deserialize, playerKeep, serialize, step, suggestedTile } from '../src/sim';
import { hashState } from '../src/sim/hash';

function run(seed: number, ticks: number, ai = 3): string {
  const state = createGame(seed, { ai });
  for (let i = 0; i < ticks; i++) step(state, []);
  return serialize(state);
}

describe('детерминированная симуляция', () => {
  it('повторяет мир и ходы ИИ бит в бит', () => {
    const left = run(42, 350);
    const right = run(42, 350);
    expect(left).toBe(right);
    expect(run(42, 350)).not.toBe(run(99, 350));
  });

  it('продолжается одинаково после сохранения', () => {
    const state = createGame(77, { ai: 2 });
    for (let i = 0; i < 120; i++) step(state, []);
    const restored = deserialize(serialize(state));
    const twin = deserialize(serialize(state));
    for (let i = 0; i < 80; i++) {
      step(restored, []);
      step(twin, []);
    }
    expect(serialize(restored)).toBe(serialize(twin));
    expect(restored.tick).toBe(state.tick + 80);
  });

  it('расходится, если команды игроков различаются', () => {
    const calm = createGame(5, { ai: 0 });
    const harsh = createGame(5, { ai: 0 });
    step(calm, [{ kind: 'tax', playerId: 0, tax: 'none' }]);
    step(harsh, [{ kind: 'tax', playerId: 0, tax: 'cruel' }]);
    for (let i = 0; i < 80; i++) {
      step(calm, []);
      step(harsh, []);
    }
    expect(serialize(calm)).not.toBe(serialize(harsh));
    expect(calm.players[0].popularity).not.toBe(harsh.players[0].popularity);
    expect(calm.players[0].gold).not.toBe(harsh.players[0].gold);
  });

  it('осадные приказы повторяются в локстепе', () => {
    const left = createGame(11, { ai: 0 });
    const right = createGame(11, { ai: 0 });
    for (const state of [left, right]) {
      playerKeep(state, 0)!.level = 3;
      state.players[0].stocks.wood = 40;
      state.players[0].stocks.stone = 20;
    }
    const tile = suggestedTile(left, 0, 'palisade');
    expect(tile).not.toBeNull();
    const command = { kind: 'place' as const, playerId: 0, building: 'palisade' as const, x: tile!.x, y: tile!.y };
    step(left, [command]);
    step(right, [command]);
    for (let i = 0; i < 20; i++) {
      step(left, []);
      step(right, []);
    }
    expect(hashState(left)).toBe(hashState(right));
    expect(serialize(left)).toBe(serialize(right));
  });
});
