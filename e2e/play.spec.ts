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

test('карточка главного здания показывает цену улучшения', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await page.evaluate(() => localStorage.removeItem('dorozhnye-kraya-tutorial'));
  await page.getByTestId('new-game').click();
  await page.getByTestId('tutorial-skip').click();
  const cost = page.getByTestId('upgrade-cost');
  await expect(cost).toBeVisible();
  await expect(cost).toContainText('Дерево');
  await expect(cost).toContainText('36/25');
  await expect(cost).toContainText('Камень 10/15');
  await expect(cost.locator('.cost-short')).toHaveText('Камень 10/15');
  await expect(page.getByTestId('upgrade-keep')).toBeDisabled();
  await expect(page.getByTestId('upgrade-reason')).toHaveText('Не хватает ресурсов');
  await expect(page.locator('#panel')).toContainText('Нужен свободный человек');
  await expect(page.locator('#panel')).toContainText('Время стройки');
  await expect(page.locator('#panel')).toContainText('Бытовка');
  await page.locator('#panel').screenshot({ path: `${shots}/keep_upgrade.png` });
  await page.getByTestId('tab-industry').click();
  await expect(page.getByTestId('build-mine').locator('small')).toHaveText('Нужен уровень главного здания 2');
  await expect(page.getByTestId('build-quarry').locator('small')).not.toContainText('Нужен уровень');
});

test('полоса, подсказка и список построек не перекрываются', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const views = [
    { width: 1280, height: 800, phone: false },
    { width: 1024, height: 640, phone: false },
    { width: 390, height: 844, phone: true },
  ];
  for (const view of views) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto('/road-realms/');
    await page.evaluate(() => localStorage.removeItem('dorozhnye-kraya-tutorial'));
    await page.getByTestId('new-game').click();
    await page.getByTestId('tutorial-skip').click();
    await page.getByTestId('tab-housing').click();
    await expect(page.getByTestId('hint')).toBeVisible();
    await expect(page.locator('.res', { hasText: 'Дерево' })).toBeVisible();
    await expect(page.locator('.res', { hasText: 'Камень' })).toBeVisible();
    const layout = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el || (el as HTMLElement).hidden) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const hit = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) =>
        a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const bad: string[] = [];
      for (const [a, b] of [
        ['#hint', '#resources'],
        ['#hint', '#status'],
        ['#log', '#resources'],
        ['#log', '#hint'],
        ['#log', '#status'],
        ['#dock', '#topbar'],
      ] as const) {
        const ra = box(a);
        const rb = box(b);
        if (ra && rb && hit(ra, rb)) bad.push(`${a}×${b}`);
      }
      const covered: string[] = [];
      for (const label of ['Дерево', 'Камень']) {
        const el = [...document.querySelectorAll('.res')].find((node) => node.textContent?.includes(label));
        if (!el) {
          covered.push(label);
          continue;
        }
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(8, r.height / 2));
        if (!top || !el.contains(top)) covered.push(label);
      }
      return { bad, covered };
    });
    expect(layout.bad, `${view.width}×${view.height}`).toEqual([]);
    expect(layout.covered, `${view.width}×${view.height}`).toEqual([]);

    const buttons = page.locator('#buttons button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      await button.scrollIntoViewIfNeeded();
      const name = (await button.locator('b').innerText()).trim();
      const fit = await button.evaluate((el) => {
        const host = document.querySelector('#buttons');
        if (!host) return { ok: false };
        const er = el.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        const title = el.querySelector('b');
        const nameOk = !title || title.scrollWidth <= title.clientWidth + 2;
        return {
          ok: er.left >= hr.left - 2 && er.right <= hr.right + 2 && er.top >= hr.top - 2 && er.bottom <= hr.bottom + 2 && nameOk,
          nameOk,
          left: Math.round(er.left - hr.left),
          right: Math.round(hr.right - er.right),
          top: Math.round(er.top - hr.top),
          bottom: Math.round(hr.bottom - er.bottom),
          ew: Math.round(er.width),
          hw: Math.round(hr.width),
        };
      });
      expect(fit.ok, `${view.width}: ${name} ${JSON.stringify(fit)}`).toBe(true);
    }
    const overflow = await page.locator('#buttons').evaluate((el) => el.scrollWidth > el.clientWidth + 4);
    if (overflow) await expect(page.getByTestId('build-next')).toBeVisible();
    if (view.phone) await page.screenshot({ path: `${shots}/iso_phone.png` });
  }
});

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
