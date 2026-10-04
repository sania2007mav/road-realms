import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OFFLINE_NOTE, appCheckSiteKey, friendlyNetError } from '../src/firebase';

describe('релиз', () => {
  it('App Check выключен, пока ключ сайта пустой', () => {
    expect(appCheckSiteKey).toBe('');
  });

  it('сетевая ошибка объясняется по-русски и не путает обычный отказ', () => {
    expect(friendlyNetError({ code: 'auth/network-request-failed', message: 'network' }, 'запас')).toBe(OFFLINE_NOTE);
    expect(friendlyNetError(new Error('Не удалось создать лобби'), 'запас')).toBe('Не удалось создать лобби');
    expect(friendlyNetError('timeout of deadline-exceeded', 'запас')).toBe(OFFLINE_NOTE);
    expect(OFFLINE_NOTE).toContain('кампания');
  });

  it('копия правил Firebase закрывает корень и описывает лобби', () => {
    const rules = JSON.parse(readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8')) as {
      rules: { '.read': boolean; '.write': boolean; lobbies: unknown };
    };
    expect(rules.rules['.read']).toBe(false);
    expect(rules.rules['.write']).toBe(false);
    expect(rules.rules.lobbies).toBeTruthy();
  });
});
