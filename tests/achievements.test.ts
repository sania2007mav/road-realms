import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/world';
import { hashState } from '../src/sim/hash';
import {
  ACHIEVEMENTS,
  achievementRows,
  addPlayMs,
  beginMatch,
  emptyMeta,
  favoriteUnit,
  formatPlay,
  noteTrade,
  noteUnit,
  observe,
  progressOf,
  unlockedCount,
  type ObservePulse,
} from '../src/meta/achievements';

function pulse(partial: Partial<ObservePulse> = {}): ObservePulse {
  return {
    gold: 0,
    pop: 5,
    happy: true,
    wood: 0,
    beer: 0,
    bread: 0,
    apples: 0,
    market: false,
    soldiers: 0,
    cavalry: false,
    siege: false,
    spear: false,
    razed: 0,
    roads: 0,
    season: 'spring',
    hunger: false,
    storm: false,
    fair: false,
    outcome: 'playing',
    hadWall: false,
    wallBroken: false,
    engineerKeep: false,
    raidDown: 0,
    partyJoined: false,
    net: false,
    speed: 1,
    cruel: false,
    campaignFirst: false,
    campaignAll: false,
    ...partial,
  };
}

describe('достижения', () => {
  it('держит около тридцати целей и не трогает хеш партии', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ACHIEVEMENTS.map((item) => item.id)).size).toBe(ACHIEVEMENTS.length);
    const state = createGame(7, { ai: 1 });
    const before = hashState(state);
    observe(emptyMeta(), pulse({ gold: 1000, pop: 100 }));
    expect(hashState(state)).toBe(before);
  });

  it('открывает тысячу золота и счастливую сотню с полоской прогресса', () => {
    const poor = observe(emptyMeta(), pulse({ gold: 400, pop: 40, happy: true }));
    expect(poor.fresh.map((item) => item.id)).toEqual(['gold-100']);
    expect(progressOf(poor.meta, 'gold-1000')).toEqual({ value: 400, goal: 1000 });
    const rich = observe(poor.meta, pulse({ gold: 1000, pop: 100, happy: true }));
    expect(rich.fresh.map((item) => item.id)).toEqual(expect.arrayContaining(['gold-1000', 'happy-100']));
    const again = observe(rich.meta, pulse({ gold: 1200, pop: 120, happy: true }));
    expect(again.fresh).toEqual([]);
    expect(unlockedCount(rich.meta).done).toBe(3);
  });

  it('считает десять разных сделок и прячет секрет до открытия', () => {
    let meta = emptyMeta();
    for (let i = 0; i < 10; i++) meta = noteTrade(meta, i);
    meta = noteTrade(meta, 0);
    const traded = observe(meta, pulse());
    expect(traded.fresh.map((item) => item.id)).toEqual(expect.arrayContaining(['trade-1', 'trade-10']));
    const hidden = achievementRows(emptyMeta()).find((row) => row.id === 'secret-road');
    expect(hidden?.hidden).toBe(true);
    expect(hidden?.title).toBe('Скрытое достижение');
    const walked = observe(emptyMeta(), pulse({ roads: 40 }));
    expect(achievementRows(walked.meta).find((row) => row.id === 'secret-road')?.hidden).toBe(false);
  });

  it('сытая зима открывает весну, голодная нет', () => {
    const cold = observe(emptyMeta(), pulse({ season: 'winter', hunger: false }));
    const spring = observe(cold.meta, pulse({ season: 'spring' }));
    expect(spring.fresh.map((item) => item.id)).toEqual(expect.arrayContaining(['winter-fed', 'seasons-loop']));
    const hungry = observe(emptyMeta(), pulse({ season: 'winter', hunger: true }));
    const after = observe(hungry.meta, pulse({ season: 'spring' }));
    expect(after.fresh).toEqual([]);
  });

  it('победа со стеной без пролома, инженеры и жестокий сосед', () => {
    const won = observe(
      beginMatch(emptyMeta(), false),
      pulse({ outcome: 'victory', hadWall: true, wallBroken: false, engineerKeep: true, cruel: true, speed: 3 }),
    );
    expect(won.meta.wins).toBe(1);
    expect(won.meta.games).toBe(1);
    expect(won.fresh.map((item) => item.id)).toEqual(
      expect.arrayContaining(['wall-win', 'engineer-keep', 'secret-cruel', 'secret-pace']),
    );
    const broken = observe(beginMatch(emptyMeta(), false), pulse({ outcome: 'victory', hadWall: true, wallBroken: true }));
    expect(broken.fresh.map((item) => item.id)).not.toContain('wall-win');
  });

  it('собирает статистику: время, победы и любимый отряд', () => {
    let meta = beginMatch(emptyMeta(), true);
    meta = addPlayMs(meta, 90 * 60000);
    meta = noteUnit(meta, 'spear');
    meta = noteUnit(meta, 'spear');
    meta = noteUnit(meta, 'bow');
    const done = observe(meta, pulse({ outcome: 'victory', net: true }));
    expect(done.meta.netWins).toBe(1);
    expect(done.fresh.map((item) => item.id)).toEqual(expect.arrayContaining(['net-play', 'net-win']));
    expect(favoriteUnit(done.meta)).toBe('копейщик');
    expect(formatPlay(done.meta.playMs)).toBe('1 ч 30 мин');
    expect(unlockedCount(done.meta).total).toBe(ACHIEVEMENTS.length);
  });
});
