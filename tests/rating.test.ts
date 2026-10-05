import { describe, expect, it } from 'vitest';
import { defaultProfiles, packLobbyName, tailFromLobbyName } from '../src/sim/match';
import { claimKey, cleanNick, eloForMinutes, nickOk, openPairSlot, pairKey, ratePair, tagFromUid } from '../src/meta/rating';

describe('рейтинг', () => {
  it('держит дельту в пределах K и в нулевой сумме', () => {
    const even = ratePair(1000, 1000, 'a');
    expect(even.deltaA + even.deltaB).toBe(0);
    expect(even.deltaA).toBe(16);
    expect(even.nextA).toBe(1016);
    expect(even.nextB).toBe(984);
    const upset = ratePair(1400, 1000, 'b');
    expect(upset.deltaA + upset.deltaB).toBe(0);
    expect(Math.abs(upset.deltaA)).toBeLessThanOrEqual(32);
    expect(Math.abs(upset.deltaB)).toBeLessThanOrEqual(32);
    expect(upset.deltaB).toBeGreaterThan(0);
    expect(upset.deltaA).toBeLessThan(0);
  });

  it('кладёт рейтинговый флаг в имя и не трогает старый хвост', () => {
    const profiles = defaultProfiles();
    const ranked = packLobbyName('Рейтинговый тракт у реки', profiles, {
      speed: 3,
      teams: 'pairs',
      seasons: 'long',
      events: 'often',
      lock: 'ab12cd34',
      ranked: true,
    });
    expect(ranked.length).toBeLessThanOrEqual(32);
    expect(ranked.endsWith('r')).toBe(true);
    expect(tailFromLobbyName(ranked)).toMatchObject({ speed: 1, teams: 'ffa', seasons: 'off', events: 'off', lock: '', ranked: true });
    const casual = packLobbyName('Посад', profiles, { speed: 2, teams: 'pairs', lock: 'ab12cd34' });
    expect(casual.includes('r')).toBe(false);
    expect(tailFromLobbyName(casual).ranked).toBe(false);
    expect(tailFromLobbyName(casual).lock).toBe('ab12cd34');
  });

  it('не двигает Elo до шестой минуты и держит три слота пары', () => {
    const rated = ratePair(1000, 1000, 'a');
    expect(eloForMinutes(rated, 5, 1000, 1000)).toEqual({ deltaA: 0, deltaB: 0, nextA: 1000, nextB: 1000 });
    expect(eloForMinutes(rated, 6, 1000, 1000)).toEqual(rated);
    expect(pairKey('bob', 'alice')).toBe('alice_bob');
    const now = 1_000_000_000;
    const day = 86_400_000;
    expect(openPairSlot([0, 0, 0], now)).toBe(0);
    expect(openPairSlot([now, now - day, now], now)).toBe(1);
    expect(openPairSlot([now, now - 1000, now - day + 1], now)).toBe(-1);
  });

  it('проверяет имя и стабильную метку', () => {
    expect(nickOk(cleanNick('  Хозяин  '))).toBe(true);
    expect(cleanNick('ab')).toBe('ab');
    expect(nickOk('ab')).toBe(false);
    expect(cleanNick('имя.с#решёткой')).toBe('имясрешёткой');
    expect(tagFromUid('alice')).toMatch(/^[0-9]{4}$/);
    expect(tagFromUid('alice')).toBe(tagFromUid('alice'));
    expect(claimKey('Хозяин', '2048')).toMatch(/^[0-9a-f]+_2048$/);
  });
});