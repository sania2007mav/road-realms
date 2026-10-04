import { describe, expect, it } from 'vitest';
import {
  createGame,
  deserialize,
  normalizeSetup,
  packSeed,
  resultCopy,
  scoreOf,
  serialize,
  step,
  unpackSeed,
  type MatchSetup,
} from '../src/sim';
import { createBuilding, createSoldier } from '../src/sim/entities';
import { hashState } from '../src/sim/hash';
import { TICKS_PER_GAME_MINUTE } from '../src/sim/balance';
import type { GameState } from '../src/sim/types';

function smashKeep(state: GameState, attacker: number, victim: number) {
  const keep = state.buildings.find((building) => building.playerId === victim && building.type === 'keep');
  if (!keep) throw new Error('нет главного здания');
  keep.hp = 1;
  const soldier = createSoldier(state, attacker, keep.x + 1.5, keep.y + 1.5, 'sword');
  soldier.order = 'raid';
  soldier.raidTargetId = keep.id;
  for (let i = 0; i < 24 && state.outcome === 'playing'; i++) step(state, []);
}

function run(state: GameState, ticks: number) {
  for (let i = 0; i < ticks; i++) step(state, []);
}

describe('условия победы', () => {
  it('сохраняет обычный старт, если условия не заданы', () => {
    const state = createGame(20261003, { ai: 0 });
    const player = state.players[0];
    expect(state.mapW).toBe(180);
    expect(state.mapH).toBe(120);
    expect(state.match.victory).toBe('conquest');
    expect(state.match.timeLimit).toBe(0);
    expect(player.gold).toBe(100);
    expect(player.stocks.wood).toBe(36);
    expect(player.stocks.stone).toBe(10);
    expect(player.stocks.apples).toBe(80);
    expect(state.people.filter((person) => person.playerId === 0)).toHaveLength(5);
    const shared = createGame(7, { humans: 2 });
    expect(shared.players.every((player) => !player.isAi)).toBe(true);
  });

  it('завоевание: павшее главное здание соседа — победа, своё — поражение, руины остаются', () => {
    const victory = createGame(21, { ai: 1 });
    const shack = createBuilding(victory, 1, 'shack', 70, 70, true);
    smashKeep(victory, 0, 1);
    expect(victory.outcome).toBe('victory');
    expect(victory.winnerId).toBe(0);
    expect(victory.players[1].alive).toBe(false);
    expect(shack.hp).toBe(0);
    expect(shack.ruin).toBe(1);
    expect(victory.players[0].stats.razed).toBeGreaterThan(0);

    const defeat = createGame(22, { ai: 1 });
    smashKeep(defeat, 1, 0);
    expect(defeat.outcome).toBe('defeat');
    expect(defeat.winnerId).toBe(-1);
    expect(defeat.players[0].alive).toBe(false);
  });

  it('богатство: первый, кто набрал золото', () => {
    const state = createGame(23, { ai: 0, setup: { victory: 'wealth', goldTarget: 150 } });
    step(state, []);
    expect(state.outcome).toBe('playing');
    state.players[0].gold = 150;
    step(state, []);
    expect(state.outcome).toBe('victory');
    expect(state.winnerId).toBe(0);
  });

  it('расцвет: уровень 5 и население', () => {
    const state = createGame(24, { ai: 0, setup: { victory: 'bloom', popTarget: 5 } });
    const keep = state.buildings.find((building) => building.type === 'keep')!;
    keep.level = 4;
    step(state, []);
    expect(state.outcome).toBe('playing');
    keep.level = 5;
    step(state, []);
    expect(state.outcome).toBe('victory');
    const shy = createGame(25, { ai: 0, setup: { victory: 'bloom', popTarget: 6 } });
    shy.buildings.find((building) => building.type === 'keep')!.level = 5;
    step(shy, []);
    expect(shy.outcome).toBe('playing');
  });

  it('выживание: победа по часам и поражение, если посад пал раньше', () => {
    const lived = createGame(26, { ai: 0, setup: { victory: 'survival', surviveMinutes: 1 } });
    for (let i = 0; i < 60; i++) {
      expect(lived.outcome).toBe('playing');
      step(lived, []);
    }
    expect(lived.outcome).toBe('victory');
    expect(lived.winnerId).toBe(0);

    const fell = createGame(27, { ai: 1, setup: { victory: 'survival', surviveMinutes: 5 } });
    smashKeep(fell, 1, 0);
    expect(fell.outcome).toBe('defeat');
    expect(fell.tick).toBeLessThan(5 * TICKS_PER_GAME_MINUTE);
  });

  it('волны бандитов идут только в выживании', () => {
    const calm = createGame(28, { ai: 0 });
    const before = calm.mobs.length;
    run(calm, 130);
    expect(calm.mobs.length).toBe(before);
    expect(calm.outcome).toBe('playing');

    const waves = createGame(29, { ai: 0, setup: { victory: 'survival', surviveMinutes: 30 } });
    const start = waves.mobs.length;
    run(waves, 120);
    expect(waves.mobs.length).toBe(start);
    step(waves, []);
    expect(waves.mobs.length).toBeGreaterThan(start);
  });

  it('лимит времени отдаёт победу большему счёту, ничья — меньшему номеру', () => {
    const ahead = createGame(30, { humans: 2, setup: { victory: 'conquest', timeLimit: 1, ai: 0 } });
    ahead.players[1].gold = 5000;
    ahead.tick = 59;
    step(ahead, []);
    expect(ahead.winnerId).toBe(1);
    expect(ahead.outcome).toBe('victory');

    const tied = createGame(31, { humans: 2, setup: { victory: 'conquest', timeLimit: 1, ai: 0 } });
    tied.tick = 59;
    step(tied, []);
    expect(tied.winnerId).toBe(0);
    expect(scoreOf(tied, tied.players[0])).toBe(scoreOf(tied, tied.players[1]));
  });

  it('считает счёт по формуле', () => {
    const state = createGame(32, { ai: 0 });
    const player = state.players[0];
    player.gold = 100;
    player.stats.peakPop = 5;
    player.stats.buildings = 2;
    player.stats.soldiers = 1;
    player.stats.kills = 3;
    player.stats.razed = 1;
    player.stats.food.apples = 7;
    state.buildings.find((building) => building.type === 'keep')!.level = 2;
    expect(scoreOf(state, player)).toBe(100 + 50 + 100 + 16 + 12 + 18 + 20 + 7);
  });

  it('пакует условия в зерно лобби и одинаково читает его', () => {
    const setup = normalizeSetup({
      victory: 'bloom',
      timeLimit: 45,
      map: 'large',
      start: 'low',
      ai: 1,
      goldTarget: 1000,
      popTarget: 30,
      surviveMinutes: 30,
    });
    const packed = packSeed(0x1234abcd, setup);
    expect(packed).toBeGreaterThanOrEqual(0);
    expect(packed).toBeLessThanOrEqual(0xffffffff);
    const back = unpackSeed(packed);
    expect(back.worldSeed).toBe(0xabcd);
    expect(back.setup).toEqual(setup);
    const left = createGame(back.worldSeed, { humans: 2, ai: back.setup.ai, setup: back.setup });
    const right = createGame(back.worldSeed, { humans: 2, ai: back.setup.ai, setup: back.setup });
    expect(left.mapW).toBe(240);
    expect(left.mapH).toBe(160);
    expect(left.players[0].gold).toBe(40);
    expect(left.players.filter((player) => player.isAi)).toHaveLength(1);
    expect(hashState(left)).toBe(hashState(right));
  });

  it('статистика совпадает у двух клиентов и расходится вместе с командами', () => {
    const left = createGame(33, { ai: 0 });
    const right = createGame(33, { ai: 0 });
    run(left, 50);
    run(right, 50);
    expect(left.players[0].stats.goldEarned).toBeGreaterThan(0);
    expect(left.players[0].stats).toEqual(right.players[0].stats);
    expect(left.samples).toEqual(right.samples);
    expect(hashState(left)).toBe(hashState(right));
    const saved = deserialize(serialize(left));
    expect(hashState(saved)).toBe(hashState(left));

    const calm = createGame(34, { ai: 0 });
    const harsh = createGame(34, { ai: 0 });
    step(calm, [{ kind: 'tax', playerId: 0, tax: 'none' }]);
    step(harsh, [{ kind: 'tax', playerId: 0, tax: 'harsh' }]);
    run(calm, 45);
    run(harsh, 45);
    expect(calm.players[0].stats.goldEarned).not.toBe(harsh.players[0].stats.goldEarned);
    expect(hashState(calm)).not.toBe(hashState(harsh));
  });

  it('называет победителя и не объявляет условие раньше времени', () => {
    const state = createGame(9, { ai: 1, setup: { victory: 'wealth', goldTarget: 2000 } });
    state.players[0].gold = 400;
    state.players[1].gold = 180;
    state.outcome = 'victory';
    state.winnerId = 0;
    const staged = resultCopy(state, 0, false);
    expect(staged.title).toBe('Победа');
    expect(staged.detail).not.toContain('выполнено');
    expect(staged.detail).toContain(state.players[0].name);

    state.players[0].gold = 2000;
    state.players[1].gold = 400;
    const won = resultCopy(state, 0, false);
    expect(won.title).toBe('Победа');
    expect(won.detail).toContain('Условие «Богатство» выполнено');
    expect(won.detail).toContain(state.players[0].name);

    state.players[0].gold = 40;
    state.players[1].gold = 2500;
    state.winnerId = 1;
    state.outcome = 'defeat';
    const lost = resultCopy(state, 0, false);
    expect(lost.title).toBe('Поражение');
    expect(lost.detail).toBe(`Поражение — победил ${state.players[1].name}.`);
    expect(lost.detail).toContain('Ольха');
  });

  it('обходит все готовые наборы зерна', () => {
    const victories = ['conquest', 'wealth', 'bloom', 'survival'] as const;
    const times = [0, 15, 30, 45];
    const maps = ['small', 'normal', 'large'] as const;
    const starts = ['low', 'normal', 'high'] as const;
    const golds = [1000, 2000, 4000];
    const pops = [12, 20, 30];
    const minutes = [10, 20, 30];
    for (const victory of victories) {
      for (const timeLimit of times) {
        for (const map of maps) {
          for (const start of starts) {
            for (const ai of [0, 1, 2, 3]) {
              for (const goldTarget of golds) {
                for (const popTarget of pops) {
                  for (const surviveMinutes of minutes) {
                    const setup: MatchSetup = { victory, timeLimit, map, start, ai, goldTarget, popTarget, surviveMinutes };
                    const packed = packSeed(0xabcd, setup);
                    expect(unpackSeed(packed)).toEqual({ worldSeed: 0xabcd, setup });
                  }
                }
              }
            }
          }
        }
      }
    }
  });
});
