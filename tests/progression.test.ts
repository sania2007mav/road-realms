import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  KEEP_UPGRADE_COST,
  START_STOCKS,
  applyCommand,
  canPlace,
  createGame,
  playerKeep,
  step,
  suggestedTile,
} from '../src/sim';
import type { BuildingType, Resource } from '../src/sim';

function earliestProducer(resource: Resource): number | null {
  let best: number | null = null;
  for (const def of Object.values(BUILDINGS)) {
    if (def.output !== resource) continue;
    if (best === null || def.keepLevel < best) best = def.keepLevel;
  }
  return best;
}

describe('улучшение главного здания', () => {
  it('каждый уровень оплачивается тем, что уже открыто', () => {
    for (const [raw, cost] of Object.entries(KEEP_UPGRADE_COST)) {
      const level = Number(raw);
      for (const [res, amount] of Object.entries(cost)) {
        if (!amount) continue;
        const unlock = earliestProducer(res as Resource);
        expect(unlock, `${res} для уровня ${level}→${level + 1}`).not.toBeNull();
        expect(unlock!, `${res} для уровня ${level}→${level + 1}`).toBeLessThanOrEqual(level);
      }
    }
    expect(BUILDINGS.quarry.keepLevel).toBeLessThanOrEqual(1);
    expect(BUILDINGS.mine.keepLevel).toBeLessThanOrEqual(2);
    expect(START_STOCKS.stone ?? 0).toBeLessThan(KEEP_UPGRADE_COST[1].stone ?? 0);
    const fresh = createGame(20261003, { ai: 0 });
    const spot = suggestedTile(fresh, 0, 'quarry');
    expect(spot, 'каменоломня рядом со стартом').not.toBeNull();
    expect(canPlace(fresh, 0, 'quarry', spot!.x, spot!.y).ok).toBe(true);
    const keep = playerKeep(fresh, 0)!;
    expect(canPlace(fresh, 0, 'market', keep.x + 4, keep.y).reason).toMatch(/главного здания 2/);
    expect(canPlace(fresh, 0, 'mine', keep.x + 4, keep.y).reason).toMatch(/главного здания 2/);
  });

  it('со старта доходит до уровня 2 только постройками первого уровня', () => {
    const state = createGame(20261003, { ai: 0 });
    state.mobs = state.mobs.filter((mob) => mob.kind === 'deer');
    const placed: BuildingType[] = ['granary', 'orchard', 'stockpile', 'woodcutter', 'quarry'];
    for (const type of placed) {
      expect(BUILDINGS[type].keepLevel).toBeLessThanOrEqual(1);
      const tile = suggestedTile(state, 0, type);
      expect(tile, type).not.toBeNull();
      expect(applyCommand(state, { kind: 'place', playerId: 0, building: type, x: tile!.x, y: tile!.y }), state.message).toBe(true);
    }
    for (let i = 0; i < 4000 && state.buildings.some((b) => b.playerId === 0 && b.type !== 'keep' && !b.complete); i++) step(state, []);
    expect(state.buildings.filter((b) => b.playerId === 0 && b.type !== 'keep').every((b) => b.complete)).toBe(true);
    for (const type of ['orchard', 'woodcutter', 'quarry'] as const) {
      const built = state.buildings.find((b) => b.type === type && b.playerId === 0)!;
      expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: built.id, delta: 1 })).toBe(true);
    }
    const needWood = KEEP_UPGRADE_COST[1].wood ?? 0;
    const needStone = KEEP_UPGRADE_COST[1].stone ?? 0;
    for (let i = 0; i < 8000 && (state.players[0].stocks.wood < needWood || state.players[0].stocks.stone < needStone); i++) {
      step(state, []);
    }
    expect(state.players[0].stocks.wood).toBeGreaterThanOrEqual(needWood);
    expect(state.players[0].stocks.stone).toBeGreaterThanOrEqual(needStone);
    expect(state.buildings.filter((b) => b.playerId === 0 && b.type !== 'keep').every((b) => BUILDINGS[b.type].keepLevel <= 1)).toBe(true);
    const keep = playerKeep(state, 0)!;
    expect(applyCommand(state, { kind: 'upgrade', playerId: 0, buildingId: keep.id })).toBe(true);
    for (let i = 0; i < 2000 && playerKeep(state, 0)!.level < 2; i++) step(state, []);
    expect(playerKeep(state, 0)!.level).toBe(2);
  });
});
