import { describe, expect, it } from 'vitest';
import { applyEvent, enact, openSession } from '../src/campaign/director';
import { civilians, goalLine, goalMet } from '../src/campaign/goals';
import { award, emptySave, isUnlocked, loadProgress, parseSave, saveProgress, starsFor } from '../src/campaign/progress';
import { playScenario } from '../src/campaign/run';
import { SCENARIOS, createCampaignGame, scenarioById } from '../src/campaign/scenarios';
import { createPerson } from '../src/sim/entities';
import { playerKeep } from '../src/sim/update';

const ids = SCENARIOS.map((scenario) => scenario.id);

describe('кампания: сохранение и звёзды', () => {
  it('пустой и битый сейв не открывают вторую стоянку', () => {
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave('не json').stars).toEqual({});
    expect(parseSave('{"version":2}')).toEqual(emptySave());
    const save = emptySave();
    expect(isUnlocked(save, 0, ids)).toBe(true);
    expect(isUnlocked(save, 1, ids)).toBe(false);
  });

  it('звезда открывает следующую стоянку и не понижает лучший результат', () => {
    let save = award(emptySave(), 'korm', 2, 30);
    expect(isUnlocked(save, 1, ids)).toBe(true);
    expect(isUnlocked(save, 2, ids)).toBe(false);
    save = award(save, 'korm', 1, 40);
    expect(save.stars.korm).toBe(2);
    expect(save.minutes.korm).toBe(30);
    save = award(save, 'korm', 3, 22.5);
    expect(save.stars.korm).toBe(3);
    expect(save.minutes.korm).toBe(22.5);
  });

  it('прогресс пишется в localStorage и читается обратно', () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true });
    try {
      saveProgress(award(emptySave(), 'korm', 3, 27));
      const loaded = loadProgress();
      expect(loaded.stars.korm).toBe(3);
      expect(loaded.minutes.korm).toBe(27);
      expect(isUnlocked(loaded, 1, ids)).toBe(true);
      expect(isUnlocked(loaded, 2, ids)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: previous, configurable: true });
    }
  });

  it('звёзды: победа, срок и дополнительная цель', () => {
    expect(starsFor(false, 10, 20, true)).toBe(0);
    expect(starsFor(true, 30, 20, false)).toBe(1);
    expect(starsFor(true, 20, 20, false)).toBe(2);
    expect(starsFor(true, 21, 20, true)).toBe(2);
    expect(starsFor(true, 18, 20, true)).toBe(3);
  });
});

describe('кампания: цели и события', () => {
  it('считает людей, камень, хлеб и золото с настроением', () => {
    const food = scenarioById('korm')!;
    const state = createCampaignGame(food);
    expect(goalMet(food.goal, state)).toBe(false);
    expect(goalLine(food.goal, state)).toContain('5/15');
    const keep = playerKeep(state, 0)!;
    for (let i = 0; i < 10; i++) createPerson(state, 0, keep.x, keep.y + 2, i);
    expect(civilians(state)).toBe(15);
    expect(goalMet(food.goal, state)).toBe(true);

    const trade = scenarioById('torg')!;
    state.players[0].gold = 300;
    state.players[0].popularity = -1;
    expect(goalMet(trade.goal, state)).toBe(false);
    state.players[0].popularity = 0;
    expect(goalMet(trade.goal, state)).toBe(true);

    const bread = scenarioById('hleb')!;
    state.players[0].stats.food.bread = 39;
    expect(goalMet(bread.goal, state)).toBe(false);
    state.players[0].stats.food.bread = 40;
    expect(goalMet(bread.goal, state)).toBe(true);

    const stone = scenarioById('kamen')!;
    state.players[0].stocks.stone = 50;
    expect(goalMet(stone.goal, state)).toBe(false);
    const home = playerKeep(state, 0)!;
    home.level = 2;
    expect(goalMet(stone.goal, state)).toBe(true);
  });

  it('караван и волна срабатывают один раз', () => {
    const trade = scenarioById('torg')!;
    const state = createCampaignGame(trade);
    const session = openSession(trade);
    const before = state.players[0].gold;
    state.tick = 6 * 60;
    enact(session, state);
    expect(state.players[0].gold).toBe(before + 40);
    enact(session, state);
    expect(state.players[0].gold).toBe(before + 40);

    const raid = scenarioById('nalet')!;
    const field = createCampaignGame(raid);
    const waves = openSession(raid);
    field.tick = 4 * 60;
    const bandits = () => field.mobs.filter((mob) => mob.kind === 'bandit').length;
    const had = bandits();
    enact(waves, field);
    expect(bandits()).toBe(had + 2);
    enact(waves, field);
    expect(bandits()).toBe(had + 2);
  });

  it('пятнадцать человек заканчивают первую стоянку', () => {
    const food = scenarioById('korm')!;
    const state = createCampaignGame(food);
    const session = openSession(food);
    const keep = playerKeep(state, 0)!;
    for (let i = 0; i < 10; i++) createPerson(state, 0, keep.x, keep.y + 2, i);
    state.tick = 10;
    enact(session, state);
    expect(state.outcome).toBe('victory');
    expect(state.winnerId).toBe(0);
  });

  it('чума снимает яблоки и пишет в журнал', () => {
    const state = createCampaignGame(scenarioById('suhoy')!);
    const before = state.players[0].stocks.apples ?? 0;
    applyEvent(state, { minute: 5, kind: 'blight', apples: 10, text: 'Чума прошла трактом и попортила яблоки.' });
    expect(state.players[0].stocks.apples).toBe(before - 10);
    expect(state.log.some((line) => line.includes('Чума'))).toBe(true);
    expect(state.clouds.length).toBeGreaterThan(0);
  });
});

describe('кампания: сценарии проходимы', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.title} берётся скриптом`, () => {
      const result = playScenario(scenario.id);
      expect(result.won, `${scenario.title}: ${result.outcome} за ${result.minutes} мин`).toBe(true);
      expect(result.minutes).toBeGreaterThan(0);
      expect(result.minutes).toBeLessThanOrEqual(scenario.proofMinutes);
      expect(result.stars).toBeGreaterThanOrEqual(1);
    }, 60_000);
  }
});
