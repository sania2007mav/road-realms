import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/world';
import { applyCommand, deserialize, serialize, step } from '../src/sim/update';
import { hashState } from '../src/sim/hash';
import { packSnapshot, unpackSnapshot } from '../src/save/slots';
import { Terrain } from '../src/sim/types';

describe('сохранения', () => {
  it('сжатый снимок возвращает тот же хеш, в том числе дорогу', async () => {
    const state = createGame(6, { ai: 0 });
    const y = state.roadY + 7;
    state.terrain[y * state.mapW + 18] = Terrain.Land;
    applyCommand(state, { kind: 'road', playerId: 0, x: 18, y });
    step(state, []);
    const raw = await packSnapshot(state, { savedAt: 1, slot: 1, campaignId: null, session: null });
    expect(raw.includes('"v":2')).toBe(true);
    expect(raw.length).toBeLessThan(serialize(state).length);
    const loaded = await unpackSnapshot(raw);
    expect(loaded).not.toBeNull();
    expect(hashState(loaded!.state)).toBe(hashState(state));
    step(state, []);
    step(loaded!.state, []);
    expect(hashState(loaded!.state)).toBe(hashState(state));
  });

  it('старый json без дорог и битый конверт не роняют загрузку', async () => {
    const state = createGame(3, { ai: 0 });
    const legacy = JSON.parse(serialize(state)) as { roads?: number[] };
    delete legacy.roads;
    const loaded = await unpackSnapshot(JSON.stringify(legacy));
    expect(loaded).not.toBeNull();
    expect(hashState(loaded!.state)).toBe(hashState(state));
    expect(deserialize(JSON.stringify(legacy)).roads.length).toBe(state.mapW * state.mapH);
    expect(await unpackSnapshot('не сохранение')).toBeNull();
    expect(await unpackSnapshot('{"v":2,"payload":"@@@"}')).toBeNull();
  });
});
