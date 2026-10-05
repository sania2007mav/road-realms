import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createGame,
  displayLobbyName,
  packLobbyName,
  planOneAi,
  profilesFromLobbyName,
  tailFromLobbyName,
  scoreOf,
  step,
} from '../src/sim';
import { createBuilding, createSoldier } from '../src/sim/entities';
import { hashState } from '../src/sim/hash';
import { TICKS_PER_GAME_MINUTE } from '../src/sim/balance';
import type { AiProfile, GameState } from '../src/sim/types';

const cruel: AiProfile = { difficulty: 'cruel', personality: 'strategist' };
const easy: AiProfile = { difficulty: 'easy', personality: 'strategist' };

function foodOf(state: GameState, playerId: number): number {
  const food = state.players[playerId]?.stats.food;
  if (!food) return 0;
  return food.apples + food.cheese + food.meat + food.bread;
}

function peopleOf(state: GameState, playerId: number): number {
  return state.people.filter((person) => person.playerId === playerId && person.hp > 0).length;
}

describe('умный ИИ', () => {
  it('прячет характер и сложность в имени лобби', () => {
    const profiles: AiProfile[] = [
      { difficulty: 'cruel', personality: 'merchant' },
      { difficulty: 'easy', personality: 'warlord' },
      { difficulty: 'hard', personality: 'builder' },
    ];
    const packed = packLobbyName('Тракт у реки', profiles);
    expect(packed.length).toBeLessThanOrEqual(32);
    expect(displayLobbyName(packed)).toBe('Тракт у реки');
    expect(profilesFromLobbyName(packed)).toEqual(profiles);
    expect(profilesFromLobbyName('Старое лобби')).toBeNull();
    const long = packLobbyName('Очень длинное название посада у большого тракта', profiles);
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith('~302012')).toBe(true);
    const locked = packLobbyName(long, profiles, { speed: 2, teams: 'pairs', lock: 'ab12cd34' });
    expect(locked.length).toBeLessThanOrEqual(32);
    expect(locked.endsWith('~30201211ab12cd34')).toBe(true);
    expect(displayLobbyName(locked).length).toBeLessThanOrEqual(15);
    expect(tailFromLobbyName(locked)).toEqual({ speed: 2, teams: 'pairs', lock: 'ab12cd34', seasons: 'off' });
    const open = packLobbyName('Витрина тракта у реки', profiles, { speed: 1, teams: 'ffa', lock: '' });
    expect(open.length).toBeLessThanOrEqual(32);
    expect(displayLobbyName(open)).toBe('Витрина тракта у реки');
    expect(tailFromLobbyName(open)).toEqual({ speed: 1, teams: 'ffa', lock: '', seasons: 'off' });
    expect(tailFromLobbyName(packed)).toEqual({ speed: 1, teams: 'ffa', lock: '', seasons: 'off' });
  });

  it('к десятой минуте ест своё и не пустеет', () => {
    for (const difficulty of ['easy', 'normal', 'hard', 'cruel'] as const) {
      const state = createGame(11, {
        ai: 1,
        setup: { map: 'small', profiles: [{ difficulty, personality: 'strategist' }] },
      });
      for (let i = 0; i < 10 * TICKS_PER_GAME_MINUTE; i++) step(state, []);
      const ai = state.players.find((player) => player.isAi)!;
      expect(peopleOf(state, ai.id), difficulty).toBeGreaterThan(0);
      expect(foodOf(state, ai.id), difficulty).toBeGreaterThan(0);
    }
  });

  it('жестокий чаще лёгкого выигрывает честный матч', () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = createGame(seed, {
        arena: true,
        ai: 2,
        setup: {
          map: 'small',
          victory: 'conquest',
          timeLimit: 10,
          ai: 2,
          profiles: [cruel, easy],
        },
      });
      while (state.outcome === 'playing') step(state, []);
      if (scoreOf(state, state.players[0]) > scoreOf(state, state.players[1])) wins += 1;
    }
    expect(wins).toBeGreaterThanOrEqual(15);
  }, 120_000);

  it('одинаковое зерно даёт один и тот же отпечаток', () => {
    const run = (seed: number) => {
      const state = createGame(seed, {
        arena: true,
        ai: 2,
        setup: { map: 'small', timeLimit: 8, ai: 2, profiles: [cruel, easy] },
      });
      for (let i = 0; i < 180; i++) step(state, []);
      return hashState(state);
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('собирает войско и бьёт незащищённый амбар, а не капает по одному', () => {
    const state = createGame(3, {
      ai: 1,
      setup: { profiles: [{ difficulty: 'cruel', personality: 'warlord' }] },
    });
    const ai = state.players[1];
    const keep = state.buildings.find((building) => building.playerId === 1 && building.type === 'keep')!;
    for (const type of ['granary', 'orchard', 'stockpile', 'woodcutter'] as const) {
      const built = createBuilding(state, 1, type, keep.x + 8, keep.y + 8, true);
      if (type !== 'granary') built.workerIds = [900 + built.id];
    }
    ai.stocks.wood = 8;
    ai.stocks.stone = 40;
    ai.stocks.cheese = 4;
    ai.stocks.meat = 2;
    state.tick = 4000;
    const granary = createBuilding(state, 0, 'granary', keep.x + 30, keep.y, true);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const soldier = createSoldier(state, 1, keep.x + i * 4, keep.y + 14, 'club');
      ids.push(soldier.id);
    }
    let grouped = false;
    let attack = false;
    for (let i = 0; i < 12; i++) {
      const command = planOneAi(state, ai);
      if (command?.kind === 'army' && command.mode === 'move' && command.ids.length >= 4) grouped = true;
      if (command?.kind === 'army' && command.mode === 'attack') {
        expect(command.ids.length).toBeGreaterThanOrEqual(4);
        expect(command.target).toBe('building');
        expect(command.targetId).toBe(granary.id);
        attack = true;
        break;
      }
      if (command) applyCommand(state, command);
      for (const soldier of state.soldiers) {
        if (!ids.includes(soldier.id)) continue;
        soldier.x = keep.x + 1;
        soldier.y = keep.y + 4;
        soldier.order = 'hold';
      }
      state.tick += 10;
    }
    expect(grouped || attack).toBe(true);
    expect(attack).toBe(true);
    expect(state.log.some((line) => line.includes('Воевода') && line.includes('угрожает'))).toBe(true);
  });

  it('уводит войско, когда его бьют', () => {
    const state = createGame(4, { ai: 1, setup: { profiles: [{ difficulty: 'hard', personality: 'strategist' }] } });
    const ai = state.players[1];
    const keep = state.buildings.find((building) => building.type === 'keep' && building.playerId === 1)!;
    for (let i = 0; i < 3; i++) {
      const soldier = createSoldier(state, 1, keep.x + 20 + i, keep.y, 'club');
      soldier.hp = 4;
      soldier.order = 'attack';
    }
    for (let i = 0; i < 4; i++) {
      const foe = createSoldier(state, 0, keep.x + 20.4 + i * 0.4, keep.y + 0.4, 'sword');
      foe.hp = foe.maxHp;
    }
    const command = planOneAi(state, ai);
    expect(command?.kind === 'army' && command.mode === 'home').toBe(true);
  });
});
