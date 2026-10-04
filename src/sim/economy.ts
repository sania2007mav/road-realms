import { RATION_PER_PERSON } from './balance';
import { FOODS, type Food, type Ration, type Resource } from './types';

export interface MealResult {
  stocks: Record<Resource, number>;
  types: number;
  consumed: number;
  hunger: boolean;
  shortage: number;
}

/**
 * Eats a meal from the settlement stores.
 * Variety is counted before the meal. Food is taken round-robin so one type
 * is not emptied while others sit untouched.
 */
export function consumeFood(
  stocks: Record<Resource, number>,
  people: number,
  ration: Ration,
): MealResult {
  const next: Record<Resource, number> = { ...stocks };
  const types = FOODS.filter((f) => stocks[f] > 0).length;
  const per = RATION_PER_PERSON[ration];
  let need = Math.ceil(people * per - 1e-9);
  if (need < 0) need = 0;
  if (per === 0 || people <= 0 || need === 0) {
    return { stocks: next, types, consumed: 0, hunger: false, shortage: 0 };
  }
  let consumed = 0;
  let guard = 0;
  while (need > 0 && guard < 100000) {
    let progressed = false;
    for (const f of FOODS) {
      if (need <= 0) break;
      if (next[f] > 0) {
        next[f] -= 1;
        need -= 1;
        consumed += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
    guard += 1;
  }
  return {
    stocks: next,
    types,
    consumed,
    hunger: need > 0,
    shortage: need,
  };
}

export function totalFood(stocks: Record<Resource, number>): number {
  return FOODS.reduce((sum, f: Food) => sum + stocks[f], 0);
}
