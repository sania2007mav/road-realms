import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts/screenshots';

test('изометрия: работники, посад, весь тракт и призрак стройки', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.goto('/road-realms/');
  await expect(page.getByRole('heading', { name: 'Дорожные края' })).toBeVisible();
  await page.getByTestId('new-game').click();
  await page.getByTestId('tutorial-skip').click();
  await page.getByTestId('speed-3').click();

  await place(page, 'storage', 'granary');
  await place(page, 'food', 'orchard');
  await place(page, 'housing', 'shack');

  await page.waitForFunction(() => {
    const snap = window.__game?.snapshot();
    if (!snap) return false;
    return ['granary', 'orchard', 'shack'].every((type) => snap.buildings.some((b) => b.type === type && b.complete));
  });

  const orchardId = await page.evaluate(() => {
    const orchard = window.__game!.snapshot().buildings.find((b) => b.type === 'orchard');
    window.__game!.select(orchard!.id);
    window.__game!.focusTile(orchard!.x, orchard!.y);
    return orchard!.id;
  });
  await page.getByTestId('worker-plus').click();
  await expect
    .poll(async () => {
      return page.evaluate((id) => window.__game!.snapshot().buildings.find((b) => b.id === id)?.workers ?? 0, orchardId);
    })
    .toBe(1);
  await expect
    .poll(async () => page.locator('[data-testid="worker-status"]').first().innerText(), { timeout: 20000 })
    .toMatch(/работает|несёт яблоки/);
  await page.evaluate(() => {
    const snap = window.__game!.snapshot();
    const orchard = snap.buildings.find((b) => b.type === 'orchard');
    const keep = snap.buildings.find((b) => b.type === 'keep');
    if (orchard && keep) window.__game!.focusTile((orchard.x + keep.x) / 2, (orchard.y + keep.y) / 2);
    window.__game!.zoom(1.2);
    window.__game!.setSpeed(1);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${shots}/iso_base_workers.png` });
  await page.getByTestId('speed-3').click();

  await page.keyboard.press('Escape');
  await page.getByTestId('tab-industry').click();
  await page.getByTestId('build-woodcutter').click();
  const forest = await page.evaluate(() => window.__game!.suggest('woodcutter'));
  expect(forest).not.toBeNull();
  const ghost = await page.evaluate((spot) => {
    window.__game!.focusTile(spot!.x, spot!.y);
    window.__game!.zoom(1.15);
    return window.__game!.tileCenter(spot!.x, spot!.y);
  }, forest);
  const box = await page.locator('#world').boundingBox();
  if (!box) throw new Error('нет холста');
  await page.mouse.move(box.x + ghost.x, box.y + ghost.y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/iso_ghost.png` });
  await page.keyboard.press('Escape');

  await place(page, 'storage', 'stockpile');
  await place(page, 'industry', 'woodcutter');
  const hunterTile = await page.evaluate(() => window.__game!.suggest('hunter'));
  if (hunterTile) await place(page, 'food', 'hunter');

  await page.waitForFunction(() => {
    const snap = window.__game?.snapshot();
    if (!snap) return false;
    return ['stockpile', 'woodcutter'].every((type) => snap.buildings.some((b) => b.type === type && b.complete));
  });
  await page.evaluate(() => {
    window.__game!.zoom(0.7);
    window.__game!.focusHome();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/iso_settlement.png` });

  await page.waitForFunction(() => (window.__game?.snapshot().tick ?? 0) >= 10 * 60);
  const after = await page.evaluate(() => window.__game!.snapshot());
  expect(after.popularity).toBeGreaterThanOrEqual(0);
  expect(after.people).toBeGreaterThanOrEqual(5);
  expect(after.apples).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__game!.setSpeed(0);
    window.__game!.zoom(0.05);
    window.__game!.focusHome();
  });
  await page.waitForTimeout(400);
  const frame = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#world');
    if (!canvas) return { corner: -1, mid: -1 };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { corner: -1, mid: -1 };
    const corner = ctx.getImageData(2, 2, 1, 1).data;
    const mid = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    const dark = (p: Uint8ClampedArray) => p[0] < 50 && p[1] < 40 && p[2] < 40;
    return { corner: dark(corner) ? 1 : 0, mid: dark(mid) ? 1 : 0 };
  });
  expect(frame.corner).toBe(1);
  expect(frame.mid).toBe(0);
  await page.screenshot({ path: `${shots}/iso_world.png` });

  const snap = await page.evaluate(() => window.__game!.snapshot());
  expect(snap.buildings.some((b) => b.type === 'granary' && b.complete)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'orchard' && b.complete && b.workers === 1)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'shack' && b.complete)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'stockpile' && b.complete)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'woodcutter' && b.complete)).toBe(true);
  expect(snap.cap).toBeGreaterThan(5);
  await expect(page.getByTestId('hint')).toBeHidden();
});

async function place(page: import('@playwright/test').Page, tab: string, type: string) {
  await page.getByTestId(`tab-${tab}`).click();
  await page.getByTestId(`build-${type}`).click();
  const tile = await page.evaluate((kind) => window.__game!.suggest(kind), type);
  expect(tile).not.toBeNull();
  const point = await page.evaluate((spot) => {
    window.__game!.focusTile(spot!.x, spot!.y);
    return window.__game!.tileCenter(spot!.x, spot!.y);
  }, tile);
  const box = await page.locator('#world').boundingBox();
  if (!box) throw new Error('нет холста');
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForFunction((kind) => window.__game?.snapshot().buildings.some((b) => b.type === kind) ?? false, type);
}

declare global {
  interface Window {
    __game?: {
      suggest: (type: string) => { x: number; y: number } | null;
      focusTile: (x: number, y: number) => void;
      focusHome: () => void;
      zoom: (z: number) => void;
      tileCenter: (x: number, y: number) => { x: number; y: number };
      select: (id: number) => void;
      setSpeed: (n: number) => void;
      snapshot: () => {
        tick: number;
        idle: number;
        used: number;
        cap: number;
        popularity: number;
        people: number;
        apples: number;
        buildings: { id: number; type: string; complete: boolean; workers: number; x: number; y: number }[];
      };
    };
  }
}
