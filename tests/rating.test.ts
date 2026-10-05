import { describe, expect, it } from 'vitest';
import { defaultProfiles, packLobbyName, tailFromLobbyName } from '../src/sim/match';
import { claimKey, cleanNick, nickOk, ratePair, tagFromUid } from '../src/meta/rating';

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