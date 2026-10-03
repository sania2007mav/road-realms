import { describe, expect, it } from 'vitest';
import { TICKS_PER_GAME_MINUTE, applyCommand, createGame, step, suggestedTile } from '../src/sim';

describe('тупик', () => {
  it('десять минут без приказов не оставляют поселение пустым', () => {
    const state = createGame(20261003, { ai: 0 });
    const until = 10 * TICKS_PER_GAME_MINUTE;
    while (state.tick < until) step(state, []);
    const people = state.people.filter((p) => p.playerId === 0 && p.hp > 0).length;
    expect(people).toBeGreaterThanOrEqual(1);
    expect(state.players[0].popularity).toBeGreaterThanOrEqual(0);
    expect(state.log.some((line) => line.includes('покинул'))).toBe(false);
  });

  it('пустое поселение без дерева получает человека и брёвна на хижину', () => {
    const state = createGame(8, { ai: 0 });
    state.mobs = [];
    const player = state.players[0];
    player.stocks.wood = 0;
    player.stocks.apples = 0;
    player.stocks.cheese = 0;
    player.stocks.meat = 0;
    player.stocks.bread = 0;
    player.popularity = -8;
    state.people = state.people.filter((p) => p.playerId !== 0);
    for (let i = 0; i < 10 * TICKS_PER_GAME_MINUTE; i++) step(state, []);
    let people = state.people.filter((p) => p.playerId === 0 && p.hp > 0).length;
    if (people === 0) {
      for (let i = 0; i < 80; i++) step(state, []);
      people = state.people.filter((p) => p.playerId === 0 && p.hp > 0).length;
    }
    expect(people).toBeGreaterThanOrEqual(1);
    expect(player.stocks.wood).toBeGreaterThanOrEqual(3);
    const tile = suggestedTile(state, 0, 'woodcutter');
    expect(tile).not.toBeNull();
    expect(applyCommand(state, { kind: 'place', playerId: 0, building: 'woodcutter', x: tile!.x, y: tile!.y })).toBe(true);
  });
});
