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
    expect(back.saveVersion).toBe(3);
    expect(back.players[0].stocks.horses).toBe(0);
    expect(back.players[0].stocks.crossbows).toBe(0);
    expect(back.players[0].mail).toBe(0);
    expect(back.buildings[0].gear).toBe(0);
  });
});

describe('арбалет, щит и степной лук', () => {
  it('болт игнорирует доспех и кольчугу, стрела их чувствует', () => {
    const state = createGame(8, { humans: 2, setup: { map: 'small', ai: 0 } });
    const bow = createSoldier(state, 0, 4, 4, 'bow');
    const crossbow = createSoldier(state, 0, 5, 4, 'crossbow');
    const bare = createSoldier(state, 1, 8, 4, 'sword');
    bare.armor = 0;
    const plated = createSoldier(state, 1, 9, 4, 'sword');
    expect(dealtToSoldier(bow, plated, false)).toBeLessThan(dealtToSoldier(bow, bare, false));
    expect(dealtToSoldier(bow, plated, true)).toBeLessThan(dealtToSoldier(bow, plated, false));
    expect(dealtToSoldier(crossbow, plated, true)).toBe(dealtToSoldier(crossbow, bare, false));
    expect(counterFactor('crossbow', 'heavy')).toBeGreaterThan(1.5);
    expect(counterFactor('crossbow', 'sword')).toBeGreaterThan(1.5);
    expect(counterFactor('sword', 'shield')).toBeGreaterThan(1.4);
    expect(counterFactor('catapult', 'shield')).toBeGreaterThan(1.5);
    expect(counterFactor('horsebow', 'spear')).toBeLessThan(0.5);
    expect(counterFactor('horsebow', 'crossbow')).toBeLessThan(0.5);
    expect(counterFactor('spear', 'horsebow')).toBeGreaterThan(1.5);
    expect(counterFactor('crossbow', 'horsebow')).toBeGreaterThan(1.4);
  });

  it('щит рядом снижает урон стрелы, а сам почти её не берёт', () => {
    const shoot = (withShield: boolean) => {
      const state = createGame(9, { humans: 2, setup: { map: 'small', ai: 0 } });
      state.mobs = [];
      const friend = createSoldier(state, 1, 12, 10, 'club');
      if (withShield) createSoldier(state, 1, 11, 10, 'shield');
      const bow = createSoldier(state, 0, 9, 10, 'bow');
      bow.order = 'attack';
      bow.targetKind = 'soldier';
      bow.targetId = friend.id;
      friend.order = 'hold';
      const before = friend.hp;
      step(state, []);
      return before - friend.hp;
    };
    const open = shoot(false);
    const covered = shoot(true);
    expect(open).toBeGreaterThan(covered);
    expect(covered).toBeLessThan(open);
    const state = createGame(10, { humans: 2, setup: { map: 'small', ai: 0 } });
    const bow = createSoldier(state, 0, 4, 4, 'bow');
    const shield = createSoldier(state, 1, 6, 4, 'shield');
    const club = createSoldier(state, 1, 8, 4, 'club');
    expect(dealtToSoldier(bow, shield, false)).toBeLessThan(dealtToSoldier(bow, club, false) * 0.5);
  });

  it('арбалетчик стреляет редко и вплотную слабее', () => {
    const state = createGame(11, { humans: 2, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const crossbow = createSoldier(state, 0, 10, 10, 'crossbow');
    const sword = createSoldier(state, 1, 13, 10, 'sword');
    crossbow.order = 'attack';
    crossbow.targetKind = 'soldier';
    crossbow.targetId = sword.id;
    sword.order = 'hold';
    sword.anchorX = sword.x;
    sword.anchorY = sword.y;
    let hits = 0;
    let prev = sword.hp;
    let rangedDrop = 0;
    for (let i = 0; i < 30; i++) {
      step(state, []);
      if (sword.hp < prev) {
        if (hits === 0) rangedDrop = prev - sword.hp;
        hits += 1;
      }
      prev = sword.hp;
    }
    expect(hits).toBe(2);
    expect(rangedDrop).toBeGreaterThan(0);
    const close = createGame(12, { humans: 2, setup: { map: 'small', ai: 0 } });
    close.mobs = [];
    const bolt = createSoldier(close, 0, 10, 10, 'crossbow');
    const foe = createSoldier(close, 1, 10.4, 10, 'sword');
    bolt.order = 'attack';
    bolt.targetKind = 'soldier';
    bolt.targetId = foe.id;
    foe.order = 'hold';
    foe.anchorX = foe.x;
    foe.anchorY = foe.y;
    const before = foe.hp;
    step(close, []);
    const meleeDrop = before - foe.hp;
    expect(meleeDrop).toBeGreaterThan(0);
    expect(meleeDrop).toBeLessThan(rangedDrop || sword.maxHp);
  });

  it('степной лучник стреляет и не стоит на месте', () => {
    const state = createGame(13, { humans: 2, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const rider = createSoldier(state, 0, 10, 10, 'horsebow');
    const sword = createSoldier(state, 1, 13.2, 10, 'sword');
    rider.order = 'attack';
    rider.targetKind = 'soldier';
    rider.targetId = sword.id;
    sword.order = 'attack';
    sword.targetKind = 'soldier';
    sword.targetId = rider.id;
    let moved = false;
    let hurt = false;
    for (let i = 0; i < 36; i++) {
      const x = rider.x;
      const y = rider.y;
      step(state, []);
      if (rider.hp <= 0 || sword.hp <= 0) break;
      if (Math.hypot(rider.x - x, rider.y - y) > 0.05) moved = true;
      if (sword.hp < sword.maxHp) hurt = true;
    }
    expect(moved).toBe(true);
    expect(hurt).toBe(true);
    expect(Math.hypot(rider.x - sword.x, rider.y - sword.y)).toBeGreaterThan(1.3);
  });

  it('стратег берёт арбалет против мечей и щит против луков, воевода — степь', () => {
    const state = createGame(14, { humans: 2, setup: { map: 'small', ai: 0, victory: 'conquest' } });
    createSoldier(state, 1, 20, 20, 'sword');
    createSoldier(state, 1, 21, 20, 'sword');
    const strategist = state.players[0];
    strategist.personality = 'strategist';
    strategist.stocks = emptyStocks();
    strategist.stocks.crossbows = 1;
    strategist.gold = 20;
    expect(pickWeapon(state, strategist, 1)).toBe('crossbow');
    state.soldiers = state.soldiers.filter((soldier) => soldier.playerId !== 1);
    createSoldier(state, 1, 20, 20, 'bow');
    createSoldier(state, 1, 21, 20, 'bow');
    strategist.stocks.armor = 1;
    strategist.stocks.wood = 10;
    expect(pickWeapon(state, strategist, 1)).toBe('shield');

    const warlord = state.players[0];
    warlord.personality = 'warlord';
    warlord.stocks = emptyStocks();
    warlord.stocks.horses = 1;
    warlord.stocks.wood = 8;
    warlord.gold = 20;
    createSoldier(state, 0, 8, 8, 'club');
    createSoldier(state, 0, 9, 8, 'club');
    expect(pickWeapon(state, warlord, 1)).toBe('horsebow');
  });

  it('кузница выдаёт арбалет из железа и дерева', () => {
    const state = prepare(23);
    place(state, 'granary');
    place(state, 'stockpile');
    place(state, 'armoury');
    const smith = place(state, 'smith');
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: smith.id, delta: 1 })).toBe(true);
    for (let i = 0; i < 4000; i++) step(state, []);
    expect(state.players[0].stocks.crossbows).toBeGreaterThan(0);
    expect(state.players[0].stocks.wood).toBeLessThan(400);
  });
});
