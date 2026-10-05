import { describe, expect, it } from 'vitest';
import { pickWeapon, planOneAi } from '../src/sim/ai';
import {
  CHARGE_BONUS,
  counterFactor,
  dealtToSoldier,
  emptyStocks,
} from '../src/sim/balance';
import { createBuilding, createPerson, createSoldier } from '../src/sim/entities';
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
    expect(back.saveVersion).toBe(4);
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

describe('инженеры, лекарь и наёмники', () => {
  it('лестница пускает своих через стену, защитник её сталкивает', () => {
    const state = createGame(31, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const foe = state.players.length;
    state.players.push({
      ...state.players[0],
      id: foe,
      name: 'Чужой',
      isAi: true,
      stocks: emptyStocks(),
      gold: 0,
    });
    for (let x = 0; x < state.mapW; x++) createBuilding(state, foe, 'wall', x, 14, true);
    const ladder = createSoldier(state, 0, 12.5, 14.5, 'ladder');
    ladder.dock = 1;
    ladder.order = 'hold';
    const club = createSoldier(state, 0, 12.5, 16.2, 'club');
    club.order = 'move';
    club.destX = 12.5;
    club.destY = 12.2;
    club.waypoints = [];
    for (let i = 0; i < 40; i++) step(state, []);
    expect(club.y).toBeLessThan(14);
    const again = createSoldier(state, 0, 12.5, 14.5, 'ladder');
    again.dock = 1;
    again.order = 'hold';
    createSoldier(state, foe, 12.6, 14.4, 'club');
    state.tick = 18;
    step(state, []);
    expect(state.soldiers.some((soldier) => soldier.id === again.id)).toBe(false);
  });

  it('осадная башня встаёт у стены и не берёт стрелы', () => {
    const state = createGame(32, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const foe = state.players.length;
    state.players.push({ ...state.players[0], id: foe, isAi: false, stocks: emptyStocks(), gold: 0 });
    createBuilding(state, foe, 'wall', 18, 18, true);
    const tower = createSoldier(state, 0, 18.5, 19.2, 'siegetower');
    const bow = createSoldier(state, foe, 18.5, 16.2, 'bow');
    const before = tower.hp;
    step(state, []);
    expect(tower.dock).toBe(2);
    expect(tower.hp).toBe(before);
    expect(dealtToSoldier(bow, tower, false)).toBe(0);
    expect(dealtToSoldier(bow, createSoldier(state, 0, 4, 4, 'club'), false)).toBeGreaterThan(0);
  });

  it('инженер засыпает ров', () => {
    const state = createGame(33, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const foe = state.players.length;
    state.players.push({ ...state.players[0], id: foe, isAi: false, stocks: emptyStocks(), gold: 0 });
    const moat = createBuilding(state, foe, 'moat', 8, 8, true);
    moat.hp = 8;
    const sapper = createSoldier(state, 0, 8.5, 8.9, 'engineer');
    sapper.order = 'hold';
    sapper.anchorX = sapper.x;
    sapper.anchorY = sapper.y;
    for (let i = 0; i < 16; i++) step(state, []);
    expect(moat.hp).toBeLessThanOrEqual(0);
  });

  it('лечение ограничено и в бою реже', () => {
    const calm = createGame(34, { ai: 0, setup: { map: 'small', ai: 0 } });
    calm.mobs = [];
    const hurt = createSoldier(calm, 0, 10, 10, 'club');
    hurt.hp = 10;
    const second = createSoldier(calm, 0, 11.2, 10, 'club');
    second.hp = 14;
    const third = createSoldier(calm, 0, 9, 10.4, 'club');
    third.hp = 16;
    createSoldier(calm, 0, 10.4, 10.2, 'healer');
    for (let i = 0; i < 6; i++) createSoldier(calm, 0, 10.2, 10.6, 'healer');
    step(calm, []);
    expect(hurt.hp).toBe(11);
    expect(second.hp).toBe(15);
    expect(third.hp).toBe(16);

    const fight = createGame(35, { ai: 0, setup: { map: 'small', ai: 0 } });
    fight.mobs = [];
    const foe = fight.players.length;
    fight.players.push({ ...fight.players[0], id: foe, isAi: false, stocks: emptyStocks(), gold: 0 });
    const patient = createSoldier(fight, 0, 10, 10, 'club');
    patient.hp = 10;
    patient.order = 'hold';
    patient.anchorX = patient.x;
    patient.anchorY = patient.y;
    createSoldier(fight, 0, 10.3, 10.2, 'healer');
    const menace = createSoldier(fight, foe, 12.4, 12, 'sword');
    menace.order = 'hold';
    menace.anchorX = menace.x;
    menace.anchorY = menace.y;
    for (let i = 0; i < 13; i++) step(fight, []);
    expect(patient.hp).toBe(11);
  });

  it('наёмник не занимает человека, платит содержание и уходит без золота', () => {
    const state = createGame(36, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const keep = playerKeep(state, 0)!;
    keep.level = 3;
    const camp = createBuilding(state, 0, 'merccamp', keep.x + 4, keep.y, true);
    step(state, []);
    const people = state.people.length;
    expect(camp.buffer).toBe(2);
    state.players[0].gold = 80;
    expect(applyCommand(state, { kind: 'hire', playerId: 0, weapon: 'raider' })).toBe(true);
    expect(state.people.length).toBe(people);
    expect(state.players[0].gold).toBe(40);
    expect(camp.buffer).toBe(1);
    const hired = state.soldiers.find((soldier) => soldier.weapon === 'raider');
    expect(hired?.merc).toBe(1);
    state.tick = 60;
    step(state, []);
    expect(state.players[0].gold).toBe(38);
    state.players[0].tax = 'none';
    state.players[0].gold = 0;
    state.tick = 120;
    step(state, []);
    expect(state.soldiers.some((soldier) => soldier.weapon === 'raider')).toBe(false);
    expect(state.people.length).toBe(people);
  });

  it('личности берут инженера, лекаря и наёмника', () => {
    const walls = createGame(37, { humans: 2, setup: { map: 'small', ai: 0, victory: 'conquest' } });
    walls.mobs = [];
    const builder = walls.players[0];
    builder.personality = 'builder';
    builder.stocks = emptyStocks();
    builder.stocks.wood = 20;
    builder.stocks.iron = 4;
    builder.gold = 20;
    for (let i = 0; i < 6; i++) createBuilding(walls, 1, 'palisade', 12 + i, 12, true);
    expect(pickWeapon(walls, builder, 1)).toBe('engineer');

    const host = createGame(38, { humans: 2, setup: { map: 'small', ai: 0, victory: 'conquest' } });
    host.mobs = [];
    const merchant = host.players[0];
    merchant.personality = 'merchant';
    merchant.gold = 90;
    const home = playerKeep(host, 0)!;
    const camp = createBuilding(host, 0, 'merccamp', home.x + 4, home.y, true);
    camp.buffer = 2;
    camp.input = 1;
    camp.gear = 1;
    createSoldier(host, 1, home.x + 2, home.y + 2, 'club');
    expect(planOneAi(host, merchant)).toEqual({ kind: 'hire', playerId: 0, weapon: 'raider' });

    const war = createGame(39, { humans: 2, setup: { map: 'small', ai: 0, victory: 'conquest' } });
    war.mobs = [];
    const warlord = war.players[0];
    warlord.personality = 'warlord';
    warlord.isAi = true;
    warlord.gold = 40;
    warlord.stocks.wood = 20;
    const nest = playerKeep(war, 0)!;
    const orchard = createBuilding(war, 0, 'orchard', nest.x + 4, nest.y, true);
    const hand = createPerson(war, 0, nest.x + 1, nest.y + 2, 1);
    orchard.workerIds.push(hand.id);
    hand.task = { type: 'work', buildingId: orchard.id, mode: 'labor', targetId: 0 };
    createBuilding(war, 0, 'chapel', nest.x + 4, nest.y + 3, true);
    for (let i = 0; i < 4; i++) createSoldier(war, 0, nest.x + i, nest.y + 5, 'club');
    const spare = createPerson(war, 0, nest.x + 1, nest.y + 3, 2);
    spare.task = { type: 'idle' };
    war.tick = 2400;
    expect(planOneAi(war, warlord)).toEqual({ kind: 'train', playerId: 0, weapon: 'healer' });
  });
});
