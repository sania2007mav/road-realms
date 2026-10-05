import { describe, expect, it } from 'vitest';
import { planOneAi } from '../src/sim/ai';
import { TICKS_PER_GAME_MINUTE } from '../src/sim/balance';
import { createBuilding, createSoldier } from '../src/sim/entities';
import { emptyRoad } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { defaultProfiles, packLobbyName, tailFromLobbyName } from '../src/sim/match';
import { applyCommand, deserialize, playerKeep, serialize, step } from '../src/sim/update';
import { createGame } from '../src/sim/world';

describe('события на тракте', () => {
  it('молчит, пока настройка выключена, и два прогона сходятся', () => {
    const run = () => {
      const state = createGame(11, { ai: 1 });
      for (let i = 0; i < 80; i++) step(state, []);
      return state;
    };
    const left = run();
    const right = run();
    expect(left.match.events).toBe('off');
    expect(left.road?.caravans ?? []).toEqual([]);
    expect(hashState(left)).toBe(hashState(right));
  });

  it('ведёт караван между посадами и торгует по обычной цене', () => {
    const state = createGame(5, { ai: 1, setup: { ai: 1, events: 'normal' } });
    state.tick = 16 * TICKS_PER_GAME_MINUTE;
    step(state, []);
    const caravan = state.road?.caravans[0];
    expect(caravan).toBeTruthy();
    const keep = playerKeep(state, 0)!;
    caravan!.x = keep.x + 2;
    caravan!.y = state.roadY;
    const player = state.players[0];
    const gold = player.gold;
    const wood = player.stocks.wood ?? 0;
    expect(applyCommand(state, { kind: 'trade', playerId: 0, caravanId: caravan!.id, resource: 'wood', mode: 'buy', qty: 2 })).toBe(true);
    expect(player.stocks.wood).toBe(wood + 2);
    expect(player.gold).toBeLessThan(gold);
    const apples = player.stocks.apples ?? 0;
    expect(applyCommand(state, { kind: 'trade', playerId: 0, caravanId: caravan!.id, resource: 'apples', mode: 'sell', qty: 2 })).toBe(true);
    expect(player.stocks.apples).toBe(apples - 2);
  });

  it('грабёж отдаёт груз и злит соседа', () => {
    const state = createGame(5, { ai: 1, setup: { ai: 1, events: 'normal' } });
    const keep = playerKeep(state, 0)!;
    state.road = emptyRoad(state.players.length);
    state.road.caravans.push({
      id: 50,
      fromId: 1,
      toId: 0,
      x: keep.x + 1,
      y: state.roadY,
      toX: keep.x + 20,
      hp: 40,
      gold: 20,
      wood: 4,
      apples: 3,
      iron: 1,
      weapons: 0,
      alive: true,
    });
    const wood = state.players[0].stocks.wood ?? 0;
    expect(applyCommand(state, { kind: 'sack', playerId: 0, caravanId: 50 })).toBe(true);
    expect(state.players[0].stocks.wood).toBe(wood + 4);
    expect(state.road.anger[1]).toBe(0);
    expect(state.road.caravans).toEqual([]);
  });

  it('открывает ярмарку в посаде с рынком', () => {
    const state = createGame(8, { ai: 0, setup: { ai: 0, events: 'normal' } });
    const keep = playerKeep(state, 0)!;
    createBuilding(state, 0, 'market', keep.x + 4, keep.y + 3, true);
    const gold = state.players[0].gold;
    const mood = state.players[0].popularity;
    const weapons = state.players[0].stocks.weapons ?? 0;
    state.tick = 19 * TICKS_PER_GAME_MINUTE;
    step(state, []);
    expect(state.road?.fair?.playerId).toBe(0);
    expect(state.players[0].gold).toBeGreaterThanOrEqual(gold + 18);
    expect(state.players[0].popularity).toBeGreaterThanOrEqual(mood);
    expect(state.players[0].stocks.weapons).toBe(weapons + 1);
  });

  it('пускает беженцев, если есть жильё', () => {
    const state = createGame(4, { ai: 0, setup: { ai: 0, events: 'normal' } });
    const keep = playerKeep(state, 0)!;
    createBuilding(state, 0, 'cabin', keep.x - 3, keep.y - 1, true);
    state.road = emptyRoad(1);
    state.road.party = {
      id: 7,
      kind: 'refugees',
      playerId: 0,
      x: keep.x + 1.2,
      y: keep.y + 1.2,
      count: 2,
      until: state.tick + 5000,
    };
    const before = state.people.filter((person) => person.playerId === 0 && person.hp > 0).length;
    step(state, []);
    const after = state.people.filter((person) => person.playerId === 0 && person.hp > 0).length;
    expect(after).toBe(before + 2);
    expect(state.road.party).toBeNull();
  });

  it('сосед выводит людей на разбойников', () => {
    const state = createGame(6, { ai: 1, setup: { ai: 1, events: 'normal' } });
    const keep = playerKeep(state, 1)!;
    createSoldier(state, 1, keep.x + 1, keep.y + 2, 'club');
    const bandit = {
      id: state.nextId++,
      kind: 'bandit' as const,
      x: keep.x + 3,
      y: keep.y + 2,
      homeX: keep.x + 3,
      homeY: keep.y + 2,
      hp: 28,
      maxHp: 28,
      dmg: 5,
      alive: true,
      respawn: 0,
      wander: 4,
      destX: keep.x,
      destY: keep.y,
      raid: 1,
    };
    state.mobs.push(bandit);
    const command = planOneAi(state, state.players[1]);
    expect(command?.kind).toBe('army');
    if (command?.kind === 'army') expect(command.targetId).toBe(bandit.id);
  });

  it('кладёт частоту в имя лобби и не выходит за 32 знака', () => {
    const profiles = defaultProfiles();
    const packed = packLobbyName('Посад у большого тракта', profiles, {
      speed: 3,
      teams: 'pairs',
      seasons: 'long',
      events: 'often',
      lock: 'ab12cd34',
    });
    expect(packed.length).toBeLessThanOrEqual(32);
    expect(tailFromLobbyName(packed).events).toBe('often');
    expect(tailFromLobbyName(packed).seasons).toBe('long');
    expect(tailFromLobbyName(packed).lock).toBe('ab12cd34');
    const legacy = packLobbyName('Очень длинное название посада у большого тракта', profiles, {
      speed: 2,
      teams: 'pairs',
      lock: '0ab12cd3',
    });
    expect(legacy.length).toBeLessThanOrEqual(32);
    expect(tailFromLobbyName(legacy)).toEqual({ speed: 2, teams: 'pairs', lock: '0ab12cd3', seasons: 'off', events: 'off' });
  });

  it('старое сохранение остаётся без событий и хэш сходится', () => {
    const state = createGame(9, { ai: 1, setup: { ai: 1, events: 'often' } });
    state.tick = 16 * TICKS_PER_GAME_MINUTE;
    step(state, []);
    expect(hashState(deserialize(serialize(state)))).toBe(hashState(state));
    const raw = JSON.parse(serialize(state)) as { saveVersion: number; match: { events?: string } };
    raw.saveVersion = 5;
    delete raw.match.events;
    const old = deserialize(JSON.stringify(raw));
    expect(old.match.events).toBe('off');
    expect(old.saveVersion).toBe(6);
  });
});
