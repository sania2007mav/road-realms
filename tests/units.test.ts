import { describe, expect, it } from 'vitest';
import { pickWeapon } from '../src/sim/ai';
import {
  CHARGE_BONUS,
  counterFactor,
  dealtToSoldier,
  emptyStocks,
} from '../src/sim/balance';
import { createSoldier } from '../src/sim/entities';
import { measureDuel } from '../src/sim/measure';
import { applyCommand, createGame, deserialize, playerKeep, serialize, step, suggestedTile } from '../src/sim';
import type { BuildingType, GameState } from '../src/sim';

function prepare(seed: number): GameState {
  const state = createGame(seed, { ai: 0, setup: { map: 'small', ai: 0 } });
  state.mobs = [];
  const keep = playerKeep(state, 0)!;
  keep.level = 5;
  state.players[0].stocks.wood = 400;
  state.players[0].stocks.stone = 200;
  state.players[0].stocks.iron = 30;
  state.players[0].stocks.apples = 40;
  state.players[0].gold = 200;
  state.players[0].ration = 'none';
  return state;
}

function place(state: GameState, type: BuildingType) {
  const tile = suggestedTile(state, 0, type);
  expect(tile, type).not.toBeNull();
  expect(applyCommand(state, { kind: 'place', playerId: 0, building: type, x: tile!.x, y: tile!.y }), state.message).toBe(true);
  const building = state.buildings[state.buildings.length - 1];
  building.complete = true;
  return building;
}

describe('копья, конница и кузница', () => {
  it('копьё сильно бьёт конницу и слабо лучников с мечниками', () => {
    expect(counterFactor('spear', 'light')).toBeGreaterThan(2);
    expect(counterFactor('spear', 'heavy')).toBeGreaterThan(2);
    expect(counterFactor('spear', 'bow')).toBeLessThan(0.7);
    expect(counterFactor('spear', 'sword')).toBeLessThan(0.7);
    expect(counterFactor('light', 'spear')).toBeLessThan(0.5);
    expect(counterFactor('heavy', 'spear')).toBeLessThan(0.5);
    expect(counterFactor('light', 'ram')).toBeGreaterThan(1.5);
    expect(counterFactor('sword', 'spear')).toBeGreaterThan(1.3);
    expect(counterFactor('bow', 'spear')).toBeGreaterThan(1.4);
  });

  it('первый наскок тяжёлой конницы сильнее второго удара', () => {
    const state = createGame(2, { humans: 2, setup: { map: 'small', ai: 0 } });
    const heavy = createSoldier(state, 0, 10, 10, 'heavy');
    const spear = createSoldier(state, 1, 11, 10, 'spear');
    const first = dealtToSoldier(heavy, spear, false);
    heavy.charge = 0;
    const second = dealtToSoldier(heavy, spear, false);
    expect(first).toBeGreaterThan(second);
    expect(first).toBeGreaterThanOrEqual(Math.round(second * (CHARGE_BONUS - 0.25)));
  });

  it('в схватке копья держат конницу, лук и меч держат копья', () => {
    expect(measureDuel('spear', 'light', 4, 1.2).winner).toBe('left');
    expect(measureDuel('spear', 'heavy', 4, 1.2).winner).toBe('left');
    expect(measureDuel('sword', 'spear', 4, 1.2).winner).toBe('left');
    expect(measureDuel('bow', 'spear', 4, 6).winner).toBe('left');
    expect(measureDuel('light', 'ram', 4, 2).winner).toBe('left');
  });

  it('кузница несёт оружие и доспехи в оружейную, конюшня выводит лошадей', () => {
    const state = prepare(21);
    place(state, 'granary');
    place(state, 'stockpile');
    place(state, 'armoury');
    const smith = place(state, 'smith');
    const stable = place(state, 'stable');
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: smith.id, delta: 1 })).toBe(true);
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: stable.id, delta: 1 })).toBe(true);
    for (let i = 0; i < 4000; i++) step(state, []);
    expect(state.players[0].stocks.weapons).toBeGreaterThan(0);
    expect(state.players[0].stocks.armor).toBeGreaterThan(0);
    expect(state.players[0].stocks.horses).toBeGreaterThan(0);
    expect(state.players[0].stocks.iron).toBeLessThan(30);
  });

  it('казарма тратит оружие, доспехи, лошадей и золото', () => {
    const state = prepare(22);
    const barracks = place(state, 'barracks');
    expect(barracks.type).toBe('barracks');
    expect(applyCommand(state, { kind: 'train', playerId: 0, weapon: 'sword' })).toBe(false);
    state.players[0].stocks.weapons = 3;
    state.players[0].stocks.armor = 2;
    state.players[0].stocks.horses = 1;
    expect(applyCommand(state, { kind: 'train', playerId: 0, weapon: 'spear' })).toBe(true);
    expect(state.players[0].stocks.weapons).toBe(2);
    expect(state.players[0].gold).toBe(194);
    expect(applyCommand(state, { kind: 'train', playerId: 0, weapon: 'sword' })).toBe(true);
    expect(state.players[0].stocks.armor).toBe(1);
    expect(applyCommand(state, { kind: 'train', playerId: 0, weapon: 'heavy' })).toBe(true);
    expect(state.players[0].stocks.horses).toBe(0);
    expect(state.players[0].gold).toBe(170);
    const heavy = state.soldiers.find((soldier) => soldier.weapon === 'heavy');
    expect(heavy?.charge).toBe(1);
    expect(heavy?.armor).toBe(1);
    const spear = state.soldiers.find((soldier) => soldier.weapon === 'spear');
    expect(spear?.armor).toBe(0);
  });

  it('воевода берёт конницу, стратег отвечает копьями, купец остаётся при дубинах', () => {
    const state = createGame(4, {
      humans: 2,
      setup: { map: 'small', ai: 0, victory: 'conquest' },
    });
    const foe = createSoldier(state, 1, 20, 20, 'light');
    foe.hp = foe.maxHp;
    createSoldier(state, 1, 21, 20, 'heavy');
    const warlord = state.players[0];
    warlord.personality = 'warlord';
    warlord.stocks = emptyStocks();
    warlord.stocks.horses = 2;
    warlord.stocks.wood = 20;
    warlord.gold = 40;
    createSoldier(state, 0, 8, 8, 'club');
    createSoldier(state, 0, 9, 8, 'club');
    expect(pickWeapon(state, warlord, 1)).toBe('light');
    warlord.stocks.weapons = 2;
    warlord.stocks.armor = 2;
    expect(pickWeapon(state, warlord, 1)).toBe('heavy');

    const strategist = state.players[0];
    strategist.personality = 'strategist';
    strategist.stocks.weapons = 1;
    strategist.stocks.wood = 20;
    expect(pickWeapon(state, strategist, 1)).toBe('spear');

    const merchant = state.players[0];
    merchant.personality = 'merchant';
    merchant.stocks.horses = 4;
    merchant.stocks.weapons = 4;
    merchant.stocks.armor = 4;
    expect(pickWeapon(state, merchant, 1)).toBe('spear');
    state.soldiers = state.soldiers.filter((soldier) => soldier.playerId !== 1);
    expect(pickWeapon(state, merchant, 1)).toBe('club');
  });

  it('старое сохранение дополняет лошадей, заряд и кольчугу', () => {
    const state = createGame(5, { ai: 0, setup: { map: 'small', ai: 0 } });
    const raw = JSON.parse(serialize(state)) as { saveVersion: number; players: { stocks: Record<string, number>; mail?: number }[]; soldiers: { charge?: number }[] };
    raw.saveVersion = 1;
    delete raw.players[0].stocks.horses;
    delete raw.players[0].stocks.weapons;
    delete raw.players[0].stocks.armor;
    delete raw.players[0].mail;
    const back = deserialize(JSON.stringify(raw));
    expect(back.saveVersion).toBe(2);
    expect(back.players[0].stocks.horses).toBe(0);
    expect(back.players[0].mail).toBe(0);
    expect(back.buildings[0].gear).toBe(0);
  });
});
