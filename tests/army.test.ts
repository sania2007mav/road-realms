import { describe, expect, it } from 'vitest';
import { focusTile, worldToScreen, type Camera } from '../src/render/camera';
import { soldiersInScreenRect } from '../src/select';
import { applyCommand, createGame, createMob, createSoldier, step } from '../src/sim';

describe('управление войском', () => {
  it('рамка на экране выбирает своих солдат внутри проекции', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1.2 };
    focusTile(camera, 40, 40);
    const viewW = 900;
    const viewH = 600;
    const soldiers = [
      { id: 1, playerId: 0, x: 40, y: 40, hp: 10 },
      { id: 2, playerId: 0, x: 41, y: 40.2, hp: 10 },
      { id: 3, playerId: 0, x: 48, y: 40, hp: 10 },
      { id: 4, playerId: 1, x: 40.2, y: 40.2, hp: 10 },
      { id: 5, playerId: 0, x: 40.4, y: 40.4, hp: 0 },
    ];
    const a = worldToScreen(camera, viewW, viewH, 40, 40);
    const b = worldToScreen(camera, viewW, viewH, 41, 40.2);
    const far = worldToScreen(camera, viewW, viewH, 48, 40);
    const rect = {
      left: Math.min(a.x, b.x) - 8,
      right: Math.max(a.x, b.x) + 8,
      top: Math.min(a.y, b.y) - 8,
      bottom: Math.max(a.y, b.y) + 8,
    };
    const outside = far.x < rect.left || far.x > rect.right || far.y < rect.top || far.y > rect.bottom;
    expect(outside).toBe(true);
    expect(soldiersInScreenRect(soldiers, camera, viewW, viewH, rect, 0)).toEqual([1, 2]);
  });

  it('приказ идти ставит солдат сеткой вокруг точки', () => {
    const state = createGame(1, { ai: 0 });
    const ids = [0, 1, 2, 3].map((i) => createSoldier(state, 0, 10 + i, 10, 'club').id);
    expect(
      applyCommand(state, {
        kind: 'army',
        playerId: 0,
        ids,
        mode: 'move',
        x: 20,
        y: 22,
        target: 'none',
        targetId: 0,
      }),
    ).toBe(true);
    const squad = state.soldiers.filter((s) => ids.includes(s.id));
    const spots = new Set(squad.map((s) => `${s.destX.toFixed(3)},${s.destY.toFixed(3)}`));
    expect(spots.size).toBe(4);
    for (const soldier of squad) {
      expect(soldier.order).toBe('move');
      expect(Math.hypot(soldier.destX - 20, soldier.destY - 22)).toBeLessThan(2);
    }
  });

  it('атака области добивает зверя в точке', () => {
    const state = createGame(7, { ai: 0 });
    state.mobs = [];
    const wolf = createMob(state, 'wolf', 90, 20);
    wolf.hp = 5;
    const soldier = createSoldier(state, 0, 86, 20, 'club');
    expect(
      applyCommand(state, {
        kind: 'army',
        playerId: 0,
        ids: [soldier.id],
        mode: 'attackmove',
        x: 90,
        y: 20,
        target: 'none',
        targetId: 0,
      }),
    ).toBe(true);
    let guard = 0;
    while (wolf.alive && guard < 800) {
      step(state, []);
      guard += 1;
    }
    expect(wolf.alive).toBe(false);
  });
});
