import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = '/opt/cursor/artifacts/screenshots';

test('игрок строит амбар, сад и шалаш и живёт несколько минут', async ({ page }) => {
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

  const started = await page.evaluate(() => window.__game!.snapshot().tick);
  await page.waitForFunction((from) => (window.__game?.snapshot().tick ?? 0) >= from + 180, started);

  await page.evaluate(() => {
    window.__game!.zoom(0.32);
    window.__game!.focusHome();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/world-overview.png` });

  await page.evaluate(() => {
    window.__game!.zoom(1.2);
    window.__game!.focusHome();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/base-workers.png` });

  await page.getByTestId('popularity').click();
  await page.evaluate(() => {
    const granary = window.__game!.snapshot().buildings.find((b) => b.type === 'granary');
    if (granary) window.__game!.select(granary.id);
  });
  await expect(page.getByRole('heading', { name: 'Амбар' })).toBeVisible();
  await page.screenshot({ path: `${shots}/ui-panels.png` });

  const snap = await page.evaluate(() => window.__game!.snapshot());
  expect(snap.buildings.some((b) => b.type === 'granary' && b.complete)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'orchard' && b.complete && b.workers === 1)).toBe(true);
  expect(snap.buildings.some((b) => b.type === 'shack' && b.complete)).toBe(true);
  expect(snap.cap).toBeGreaterThan(5);
});

async function place(page: import('@playwright/test').Page, tab: string, type: string) {
  await page.getByTestId(`tab-${tab}`).click();
  await page.getByTestId(`build-${type}`).click();
  const tile = await page.evaluate((kind) => window.__game!.suggest(kind), type);
  expect(tile).not.toBeNull();
  await page.evaluate((spot) => window.__game!.focusTile(spot!.x, spot!.y), tile);
  const box = await page.locator('#world').boundingBox();
  if (!box) throw new Error('нет холста');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((kind) => window.__game?.snapshot().buildings.some((b) => b.type === kind) ?? false, type);
}

declare global {
  interface Window {
    __game?: {
      suggest: (type: string) => { x: number; y: number } | null;
      focusTile: (x: number, y: number) => void;
      focusHome: () => void;
      zoom: (z: number) => void;
      select: (id: number) => void;
      snapshot: () => {
        tick: number;
        idle: number;
        used: number;
        cap: number;
        popularity: number;
        people: number;
        buildings: { id: number; type: string; complete: boolean; workers: number; x: number; y: number }[];
      };
    };
  }
}
