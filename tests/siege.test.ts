import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, emptyStats, playerKeep, step, suggestedTile } from '../src/sim';
import { emptyStocks } from '../src/sim/balance';
import { createBuilding, createPerson, createSoldier } from '../src/sim/entities';
import { hashState } from '../src/sim/hash';
import { findPath } from '../src/sim/path';
import { approach, blocksMover, wallLine } from '../src/sim/siege';
import type { GameState } from '../src/sim/types';

function addFoe(state: GameState): number {
  const id = state.players.length;
  state.players.push({
    id,
    name: 'Чужой',
    isAi: true,
    alive: true,
    side: 'south',
    spawnX: 8,
    spawnY: 8,
    color: '#d6453d',
    gold: 0,
    stocks: emptyStocks(),
    popularity: 20,
    ration: 'normal',
    tax: 'low',
    hunger: false,
    beerMood: 0,
    mail: 0,
      migrate: 0,
      stats: emptyStats(0),
      difficulty: 'normal',
      personality: 'warlord',
    });
  return id;
}

describe('осада', () => {
  it('рисует линию стены по клеткам', () => {
    expect(wallLine(0, 0, 4, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(wallLine(2, 3, 2, 3)).toEqual([{ x: 2, y: 3 }]);
    const diagonal = wallLine(0, 0, 3, 3);
    expect(diagonal).toHaveLength(4);
    expect(diagonal[0]).toEqual({ x: 0, y: 0 });
    expect(diagonal[3]).toEqual({ x: 3, y: 3 });
  });

  it('списывает цену за каждый участок палисада', () => {
    const state = createGame(2, { ai: 0 });
    playerKeep(state, 0)!.level = 2;
    const before = state.players[0].stocks.wood;
    const tile = suggestedTile(state, 0, 'palisade');
    expect(tile).not.toBeNull();
    expect(applyCommand(state, { kind: 'place', playerId: 0, building: 'palisade', x: tile!.x, y: tile!.y })).toBe(true);
    expect(state.players[0].stocks.wood).toBe(before - 2);
    const next = { x: tile!.x + 1, y: tile!.y };
    if (applyCommand(state, { kind: 'place', playerId: 0, building: 'palisade', x: next.x, y: next.y })) {
      expect(state.players[0].stocks.wood).toBe(before - 4);
    }
  });

  it('пускает своих через ворота и держит чужих', () => {
    const state = createGame(1, { ai: 0 });
    state.mobs = [];
    const foe = addFoe(state);
    for (let x = 20; x <= 26; x++) {
      for (let y = 28; y <= 34; y++) {
        const edge = x === 20 || x === 26 || y === 28 || y === 34;
        if (!edge) continue;
        createBuilding(state, 0, x === 23 && y === 34 ? 'gate' : 'palisade', x, y, true);
      }
    }
    expect(blocksMover(state, 23, 34, 0, 'worker')).toBe(false);
    expect(blocksMover(state, 22, 34, 0, 'worker')).toBe(true);
    expect(blocksMover(state, 23, 34, foe, 'soldier')).toBe(true);

    const ownPath = findPath(state, 23.5, 31.5, 23.5, 37.5, {
      blocked: (x, y) => blocksMover(state, x, y, 0, 'worker'),
    });
    expect(ownPath.some((p) => Math.floor(p.x) === 23 && Math.floor(p.y) === 34)).toBe(true);
    const enemyPath = findPath(state, 23.5, 31.5, 23.5, 37.5, {
      blocked: (x, y) => blocksMover(state, x, y, foe, 'soldier'),
      limit: 2500,
    });
    expect(enemyPath).toEqual([]);

    const worker = state.people.find((p) => p.playerId === 0)!;
    worker.x = 23.5;
    worker.y = 31.5;
    const raider = createSoldier(state, foe, 23.5, 31.2, 'club');
    for (let i = 0; i < 80; i++) {
      approach(state, worker, 23.5, 37.5, 0.12, 0, 'worker');
      approach(state, raider, 23.5, 37.5, 0.11, foe, 'soldier');
    }
    expect(worker.y).toBeGreaterThan(34.5);
    expect(raider.y).toBeLessThan(34);
  });

  it('таран ломает ворота', () => {
    const state = createGame(3, { ai: 0 });
    state.mobs = [];
    const foe = addFoe(state);
    const gate = createBuilding(state, 0, 'gate', 30, 50, true);
    gate.hp = 40;
    const ram = createSoldier(state, foe, 30.5, 51.7, 'ram');
    ram.order = 'attack';
    ram.targetKind = 'building';
    ram.targetId = gate.id;
    for (let i = 0; i < 13; i++) step(state, []);
    expect(gate.hp).toBeLessThanOrEqual(0);
  });

  it('лучник на башне достаёт дальше пешего', () => {
    const state = createGame(4, { ai: 0 });
    state.mobs = [];
    const foe = addFoe(state);
    const tower = createBuilding(state, 0, 'woodtower', 40, 40, true);
    const high = createSoldier(state, 0, tower.x + 0.8, tower.y + 0.8, 'bow');
    high.order = 'defend';
    const far = createSoldier(state, foe, tower.x + 0.8, tower.y + 6.4, 'club');
    const ground = createSoldier(state, 0, 60.5, 60.5, 'bow');
    ground.order = 'hold';
    ground.anchorX = ground.x;
    ground.anchorY = ground.y;
    const near = createSoldier(state, foe, 60.5, 66.3, 'club');
    const farHp = far.hp;
    const nearHp = near.hp;
    for (let i = 0; i < 13; i++) step(state, []);
    expect(far.hp).toBeLessThan(farHp);
    expect(near.hp).toBe(nearHp);
  });

  it('подожжённая смоляная канава ранит стоящего в ней', () => {
    const state = createGame(5, { ai: 0 });
    state.mobs = [];
    const foe = addFoe(state);
    const ditch = createBuilding(state, 0, 'pitchditch', 12, 12, true);
    createBuilding(state, 0, 'brazier', 13, 12, true);
    const victim = createSoldier(state, foe, 12.5, 12.5, 'club');
    const hp = victim.hp;
    for (let i = 0; i < 6; i++) step(state, []);
    expect(ditch.buffer).toBe(1);
    expect(victim.hp).toBeLessThan(hp);
  });

  it('больная корова оставляет облако чумы', () => {
    const state = createGame(6, { ai: 0 });
    state.mobs = [];
    const foe = addFoe(state);
    createBuilding(state, 0, 'dairy', 18, 18, true);
    const catapult = createSoldier(state, 0, 20, 20, 'catapult');
    const victim = createPerson(state, foe, 24.5, 24.5, 1);
    const hp = victim.hp;
    const mood = state.players[foe].popularity;
    step(state, [{ kind: 'cow', playerId: 0, soldierId: catapult.id, x: victim.x, y: victim.y }]);
    expect(state.clouds).toHaveLength(1);
    for (let i = 0; i < 16; i++) step(state, []);
    expect(victim.hp).toBeLessThan(hp);
    expect(state.players[foe].popularity).toBeLessThan(mood);
  });

  it('одинаковые осадные приказы дают один хеш', () => {
    const left = createGame(9, { ai: 0 });
    const right = createGame(9, { ai: 0 });
    for (const state of [left, right]) {
      playerKeep(state, 0)!.level = 3;
      state.players[0].stocks.wood = 80;
      state.players[0].stocks.stone = 40;
    }
    const tile = suggestedTile(left, 0, 'palisade');
    expect(tile).not.toBeNull();
    const place = { kind: 'place' as const, playerId: 0, building: 'palisade' as const, x: tile!.x, y: tile!.y };
    step(left, [place]);
    step(right, [place]);
    expect(hashState(left)).toBe(hashState(right));
    const other = suggestedTile(left, 0, 'gate');
    expect(other).not.toBeNull();
    step(left, [{ kind: 'place', playerId: 0, building: 'gate', x: other!.x, y: other!.y }]);
    step(right, []);
    expect(hashState(left)).not.toBe(hashState(right));
  });
});
