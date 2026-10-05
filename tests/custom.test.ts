import { describe, expect, it } from 'vitest';
import {
  blankMap,
  compileCustom,
  decodeShare,
  encodeShare,
  exportJson,
  importMap,
  roadMask,
  validateMap,
} from '../src/sim/custom';
import { hashState } from '../src/sim/hash';
import { deserialize, serialize } from '../src/sim/update';
import { Terrain } from '../src/sim/types';
import { createGame } from '../src/sim/world';

describe('своя карта', () => {
  it('принимает заготовку и отвергает плохие старты', () => {
    expect(validateMap(blankMap())).toEqual([]);
    const close = blankMap();
    close.starts[1] = { x: close.starts[0].x + 2, y: close.starts[0].y, team: 1 };
    expect(validateMap(close).join(' ')).toContain('слишком близко');
    const blocked = blankMap();
    blocked.starts[0] = { x: 8, y: 8, team: 0 };
    for (let x = 0; x < 120; x++) {
      blocked.paint[20 * 120 + x] = Terrain.Rock;
      blocked.paint[21 * 120 + x] = Terrain.Rock;
    }
    expect(validateMap(blocked).join(' ')).toContain('не достаёт до тракта');
    const bare = blankMap();
    bare.paint.fill(Terrain.Land);
    expect(validateMap(bare).join(' ')).toContain('мало леса');
  });

  it('код, сезон и хэш совпадают у одной карты и молчат у случайной', () => {
    const map = blankMap('small', 'cross');
    map.seasonStart = 'winter';
    const back = importMap(exportJson(map));
    expect(back.road).toBe('cross');
    expect(back.seasonStart).toBe('winter');
    expect(decodeShare(encodeShare(map)).starts).toEqual(map.starts);

    const custom = createGame(7, { custom: map, humans: 1 });
    expect(custom.season).toBe('winter');
    expect(custom.weather === 'snow' || custom.weather === 'clear').toBe(true);
    expect(custom.mapHash).toMatch(/^[0-9a-f]{8}$/);
    const twin = createGame(7, { custom: map, humans: 1 });
    expect(hashState(twin)).toBe(hashState(custom));
    expect(serialize(twin)).toBe(serialize(custom));
    const tweaked = deserialize(serialize(custom));
    expect(tweaked.mapHash).toBe(custom.mapHash);
    tweaked.mapHash = '00000000';
    expect(hashState(tweaked)).not.toBe(hashState(custom));

    const painted = blankMap('small', 'cross');
    painted.paint[10] = Terrain.Water;
    expect(compileCustom(painted).mapHash).not.toBe(compileCustom(map).mapHash);
    expect(hashState(createGame(7, { custom: painted, humans: 1 }))).not.toBe(hashState(custom));

    const procedural = createGame(7, { ai: 1 });
    const other = createGame(7, { ai: 1 });
    expect(procedural.mapHash).toBeUndefined();
    expect(serialize(procedural)).toBe(serialize(other));
    expect(serialize(procedural).includes('mapHash')).toBe(false);
    expect(hashState(procedural)).toBe(hashState(other));
  });

  it('ведёт тракт от края до края', () => {
    for (const layout of ['straight', 'bend', 'cross'] as const) {
      const mask = roadMask(120, 80, layout);
      const column = (x: number) => mask[39 * 120 + x] || mask[40 * 120 + x] || mask[41 * 120 + x];
      expect(column(0)).toBe(1);
      expect(column(119)).toBe(1);
    }
    const cross = roadMask(120, 80, 'cross');
    expect(cross[60]).toBe(1);
    expect(cross[79 * 120 + 60]).toBe(1);
  });
});
