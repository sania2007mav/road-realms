import { describe, expect, it } from 'vitest';
import { PRICES } from '../src/sim/balance';
import { applyCommand, createGame, suggestedTile } from '../src/sim';
import {
  CHAINS,
  craftMargins,
  housingRows,
  marketRoundTripLoss,
  measureChain,
  measureDuel,
  measureWall,
  priceRows,
  scriptedConquest,
} from '../src/sim/measure';
import { RESOURCES } from '../src/sim/types';

describe('инварианты баланса', () => {
  it('рынок не даёт купить дёшево и продать дорого', () => {
    for (const row of priceRows()) {
      expect(row.buy, row.resource).toBeGreaterThan(row.sell);
      expect(marketRoundTripLoss(row.resource, 10)).toBeGreaterThan(0);
    }
    for (const craft of craftMargins()) expect(craft.margin, craft.name).toBeLessThan(0);

    const state = createGame(4, { ai: 0, setup: { map: 'small', ai: 0 } });
    state.mobs = [];
    const keep = state.buildings.find((building) => building.type === 'keep')!;
    keep.level = 5;
    state.players[0].stocks.wood = 80;
    const tile = suggestedTile(state, 0, 'market');
    expect(tile).not.toBeNull();
    expect(applyCommand(state, { kind: 'place', playerId: 0, building: 'market', x: tile!.x, y: tile!.y })).toBe(true);
    const market = state.buildings[state.buildings.length - 1];
    market.complete = true;
    expect(applyCommand(state, { kind: 'assign', playerId: 0, buildingId: market.id, delta: 1 })).toBe(true);
    const gold = state.players[0].gold;
    expect(applyCommand(state, { kind: 'market', playerId: 0, resource: 'wheat', mode: 'buy', qty: 10 })).toBe(true);
    expect(applyCommand(state, { kind: 'market', playerId: 0, resource: 'wheat', mode: 'sell', qty: 10 })).toBe(true);
    expect(state.players[0].gold).toBeLessThan(gold);
    expect(PRICES.bread.sell).toBeLessThan(PRICES.wheat.buy);
    expect(PRICES.bread.sell).toBeLessThan(PRICES.flour.buy);
    expect(PRICES.beer.sell).toBeLessThan(PRICES.hops.buy);
    expect(RESOURCES.length).toBe(priceRows().length);
  });

  it('хлеб и пиво окупаются, у еды разные ниши', () => {
    const bread = measureChain(CHAINS.find((chain) => chain.id === 'bread')!, 4, 10);
    const beer = measureChain(CHAINS.find((chain) => chain.id === 'beer')!, 4, 10);
    const apples = measureChain(CHAINS.find((chain) => chain.id === 'apples')!, 4, 10);
    const cheese = measureChain(CHAINS.find((chain) => chain.id === 'cheese')!, 9, 10);
    expect(bread.placed).toBe(true);
    expect(bread.paybackMin).toBeLessThan(12);
    expect(bread.perMinute).toBeGreaterThan(apples.perMinute);
    expect(beer.paybackMin).toBeLessThan(12);
    expect(apples.perTile).toBeLessThan(bread.perTile);
    expect(cheese.perTile).toBeGreaterThan(apples.perTile * 0.9);
    for (const row of housingRows()) expect(row.denserThanPrevious).toBe(true);
  });

  it('нет одной побеждающей всех фигуры, стена задерживает', () => {
    expect(measureDuel('sword', 'bow', 6, 3.2).winner).toBe('left');
    expect(measureDuel('bow', 'sword', 6, 3.2).winner).toBe('right');
    expect(measureDuel('bow', 'sword', 6, 6).winner).toBe('left');
    expect(measureDuel('sword', 'bow', 6, 6).winner).toBe('right');
    expect(measureDuel('ram', 'bow', 4, 5).winner).toBe('left');
    expect(measureDuel('bow', 'ram', 4, 5).winner).toBe('right');
    expect(measureDuel('sword', 'ram', 4, 2).winner).toBe('left');
    expect(measureDuel('ram', 'sword', 4, 2).winner).toBe('right');
    const clubs = measureWall('club', 'palisade', 6);
    const ram = measureWall('ram', 'palisade', 1);
    expect(clubs.broke).toBe(true);
    expect(ram.broke).toBe(true);
    expect(ram.minutes).toBeLessThan(clubs.minutes);
    expect(clubs.minutes).toBeGreaterThan(1);
    expect(clubs.minutes).toBeLessThan(8);
  });

  it('завоевание против нормального на обычной карте укладывается в 20–40 минут', () => {
    for (const seed of [3, 7]) {
      const match = scriptedConquest(seed, 50, 'normal');
      expect(match.finished, `зерно ${seed}`).toBe(true);
      expect(match.minutes, `зерно ${seed}`).toBeGreaterThanOrEqual(20);
      expect(match.minutes, `зерно ${seed}`).toBeLessThanOrEqual(40);
    }
  }, 30_000);
});
