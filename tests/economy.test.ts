import { describe, expect, it } from 'vitest';
import {
  CONSUME_EVERY,
  START_STOCKS,
  TAX_EVERY,
  consumeFood,
  createGame,
  currentTarget,
  popularityTarget,
  step,
  taxGold,
  varietyBonus,
} from '../src/sim';

describe('еда, разнообразие и налоги', () => {
  it('считает разнообразие и порции', () => {
    expect(varietyBonus(0)).toBe(0);
    expect(varietyBonus(1)).toBe(0);
    expect(varietyBonus(2)).toBe(8);
    expect(varietyBonus(3)).toBe(14);
    expect(varietyBonus(4)).toBe(22);

    const stocks = {
      wood: 0,
      stone: 0,
      iron: 0,
      pitch: 0,
      apples: 10,
      cheese: 10,
      meat: 0,
      bread: 5,
      wheat: 3,
      flour: 0,
      hops: 0,
      beer: 0,
      horses: 0,
      weapons: 0,
      armor: 0,
      crossbows: 0,
    };
    const meal = consumeFood(stocks, 4, 'normal');
    expect(meal.types).toBe(3);
    expect(meal.consumed).toBe(4);
    expect(meal.hunger).toBe(false);
    expect(meal.stocks.apples + meal.stocks.cheese + meal.stocks.bread).toBe(21);
    expect(meal.stocks.wheat).toBe(3);

    const feast = consumeFood(stocks, 4, 'feast');
    expect(feast.consumed).toBe(12);
    expect(feast.hunger).toBe(false);

    const starving = consumeFood({ ...stocks, apples: 1, cheese: 0, meat: 0, bread: 0 }, 4, 'double');
    expect(starving.hunger).toBe(true);
    expect(starving.shortage).toBe(7);

    const half = consumeFood(stocks, 5, 'half');
    expect(half.consumed).toBe(3);

    const none = consumeFood(stocks, 5, 'none');
    expect(none.consumed).toBe(0);
    expect(none.hunger).toBe(false);
    expect(none.types).toBe(3);
  });

  it('собирает настроение из пайка, разнообразия, налога, пива и голода', () => {
    const rich = popularityTarget({
      ration: 'feast',
      foodTypes: 4,
      tax: 'normal',
      beer: true,
      hunger: false,
    });
    expect(rich.value).toBe(12 + 22 + 0 + 12);
    expect(rich.reasons.map((r) => r.label)).toEqual([
      'Паёк: пир',
      'Разнообразие: все четыре вида',
      'Налог: обычный',
      'Пиво в таверне',
    ]);

    const poor = popularityTarget({
      ration: 'none',
      foodTypes: 0,
      tax: 'cruel',
      beer: false,
      hunger: true,
    });
    expect(poor.value).toBe(-12 + 0 + -20 + -10);

    const capped = popularityTarget({
      ration: 'feast',
      foodTypes: 4,
      tax: 'none',
      beer: true,
      hunger: false,
    });
    expect(capped.value).toBe(50);
  });

  it('даёт золото по ставке налога и числу людей', () => {
    expect(taxGold(0, 'cruel')).toBe(0);
    expect(taxGold(5, 'none')).toBe(0);
    expect(taxGold(5, 'low')).toBe(5);
    expect(taxGold(5, 'normal')).toBe(10);
    expect(taxGold(5, 'high')).toBe(15);
    expect(taxGold(5, 'harsh')).toBe(20);
    expect(taxGold(5, 'cruel')).toBe(30);
  });

  it('в симуляции ест еду и собирает налог в свой тик', () => {
    const state = createGame(3, { ai: 0 });
    state.mobs = [];
    const player = state.players[0];
    const startGold = player.gold;
    const startApples = player.stocks.apples;
    for (let i = 0; i < TAX_EVERY; i++) step(state, []);
    expect(player.gold).toBe(startGold);
    expect(player.stocks.apples).toBe(startApples);
    step(state, []);
    expect(state.tick).toBe(TAX_EVERY + 1);
    expect(player.gold).toBe(startGold + taxGold(5, 'low'));

    const beforeMeal = createGame(3, { ai: 0 });
    beforeMeal.mobs = [];
    for (let i = 0; i < CONSUME_EVERY; i++) step(beforeMeal, []);
    expect(beforeMeal.players[0].stocks.apples).toBe(START_STOCKS.apples);
    step(beforeMeal, []);
    expect(beforeMeal.players[0].stocks.apples).toBe((START_STOCKS.apples ?? 0) - 5);
  });

  it('повышает цель настроения, когда в запасе больше видов еды', () => {
    const state = createGame(8, { ai: 0 });
    const before = currentTarget(state, 0).value;
    state.players[0].stocks.cheese = 4;
    state.players[0].stocks.meat = 4;
    state.players[0].stocks.bread = 4;
    const after = currentTarget(state, 0).value;
    expect(after - before).toBe(varietyBonus(4) - varietyBonus(1));
  });
});
