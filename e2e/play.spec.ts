import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const shots = '/opt/cursor/artifacts/screenshots';

test('изометрия: работники, посад, весь тракт и призрак стройки', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.goto('/road-realms/');
  await expect(page.getByRole('heading', { name: 'Дорожные края' })).toBeVisible();
  await page.getByTestId('know-game').click();
  await page.getByTestId('new-game').click();
  const stacked = await page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>('#toast')!;
    const hint = document.querySelector<HTMLElement>('#hint')!;
    toast.hidden = false;
    toast.textContent = 'Строим: амбар';
    const tr = toast.getBoundingClientRect();
    const hr = hint.getBoundingClientRect();
    toast.hidden = true;
    return { overlap: tr.bottom > hr.top + 1 && tr.top < hr.bottom - 1, toastBottom: tr.bottom, hintTop: hr.top, hintHidden: hint.hidden };
  });
  expect(stacked.hintHidden, 'подсказка должна быть видна').toBe(false);
  expect(stacked.overlap, `тост перекрывает подсказку ${stacked.toastBottom} / ${stacked.hintTop}`).toBe(false);
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
  await page.getByTestId('know-game').click();
  await page.getByTestId('new-game').click();
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

test('рамка выделяет солдат, атака области показывает красный маркер', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await page.getByTestId('know-game').click();
  await page.getByTestId('new-game').click();
  await page.evaluate(() => {
    window.__game!.debugArmy();
    window.__game!.focusArmy();
    window.__game!.zoom(1.35);
    window.__game!.setSpeed(0);
  });
  const points = await page.evaluate(() => window.__game!.armyPoints());
  expect(points).toHaveLength(4);
  const box = await page.locator('#world').boundingBox();
  if (!box) throw new Error('нет холста');
  const pad = 24;
  const x0 = box.x + Math.min(...points.map((p) => p.x)) - pad;
  const y0 = box.y + Math.min(...points.map((p) => p.y)) - pad;
  const x1 = box.x + Math.max(...points.map((p) => p.x)) + pad;
  const y1 = box.y + Math.max(...points.map((p) => p.y)) + pad;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 12 });
  await expect(page.getByTestId('army-count')).toContainText('Всего 4');
  await expect(page.getByTestId('army-hold')).toBeVisible();
  await page.screenshot({ path: `${shots}/army_select.png` });
  await page.mouse.up();

  await page.getByTestId('army-attack').click();
  const bandit = await page.evaluate(() => window.__game!.banditScreen());
  expect(bandit).not.toBeNull();
  for (let i = 0; i < 12; i++) {
    const clear = await page.evaluate(() => {
      const spot = window.__game!.banditScreen();
      const dock = document.querySelector('#dock')?.getBoundingClientRect();
      return !!spot && !!dock && spot.y < dock.top - 20 && spot.y > 80;
    });
    if (clear) break;
    await page.keyboard.down('s');
    await page.waitForTimeout(60);
    await page.keyboard.up('s');
  }
  const aim = await page.evaluate(() => window.__game!.banditScreen());
  expect(aim).not.toBeNull();
  await page.mouse.click(box.x + aim!.x, box.y + aim!.y);
  await page.getByTestId('speed-3').click();
  await page.waitForTimeout(450);
  await expect.poll(async () => page.evaluate(() => window.__game!.markerKind())).toBe('attack');
  await page.screenshot({ path: `${shots}/army_attack.png` });
});

test('полоса, подсказка и список построек не перекрываются', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const views = [
    { width: 1280, height: 800, phone: false },
    { width: 1024, height: 640, phone: false },
    { width: 1024, height: 576, phone: false },
    { width: 390, height: 844, phone: true },
  ];
  for (const view of views) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto('/road-realms/');
    await page.evaluate(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
    await page.getByTestId('new-game').click();
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
    if (view.width === 1024 && view.height === 576) {
      await page.evaluate(() => window.__game!.debugScene('season-winter'));
      await page.waitForTimeout(200);
      const bar = await page.evaluate(() => {
        const lines = (el: Element | null) => {
          if (!el) return { w: 0, h: 0, text: '', title: '' };
          return {
            w: el.scrollWidth - el.clientWidth,
            h: el.scrollHeight - el.clientHeight,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            title: (el as HTMLElement).title || '',
          };
        };
        const status = document.querySelector('#status');
        const resources = document.querySelector('#resources');
        const pitch = [...document.querySelectorAll('.res')].find((node) => node.textContent?.includes('Смола')) as HTMLElement | undefined;
        pitch?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        const host = resources?.getBoundingClientRect();
        const chip = pitch?.getBoundingClientRect();
        const pitchFit =
          !!pitch &&
          !!host &&
          !!chip &&
          chip.left >= host.left - 1 &&
          chip.right <= host.right + 1 &&
          pitch.scrollWidth <= pitch.clientWidth + 1;
        return {
          status: status ? status.scrollWidth - status.clientWidth : 99,
          fps: lines(document.querySelector('#fps')),
          people: lines(document.querySelector('#people-btn')),
          badge: lines(document.querySelector('#season-badge')),
          pitchFit,
        };
      });
      expect(bar.status, 'status row').toBeLessThanOrEqual(1);
      expect(bar.fps.h, `fps ${bar.fps.text}`).toBeLessThanOrEqual(1);
      expect(bar.fps.w, `fps ${bar.fps.text}`).toBeLessThanOrEqual(1);
      expect(bar.people.h, `people ${bar.people.text}`).toBeLessThanOrEqual(1);
      expect(bar.people.w, `people ${bar.people.text}`).toBeLessThanOrEqual(1);
      expect(bar.badge.text.startsWith('❄'), bar.badge.text).toBe(true);
      expect(bar.badge.text.includes('дальше'), bar.badge.text).toBe(false);
      expect(bar.badge.title.includes('дальше'), bar.badge.title).toBe(true);
      expect(bar.badge.w, bar.badge.text).toBeLessThanOrEqual(1);
      expect(bar.badge.h).toBeLessThanOrEqual(1);
      expect(bar.pitchFit, 'Смола').toBe(true);
      await page.screenshot({ path: `${shots}/topbar_1024.png` });
    }

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

test('обучение не даёт пропустить основу и десять минут держат людей', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await page.evaluate(() => localStorage.removeItem('dorozhnye-kraya-tutorial'));
  await page.getByTestId('new-game').click();
  await expect(page.getByTestId('guide-title')).toHaveText('Амбар');
  await expect(page.getByTestId('build-granary')).toHaveClass(/guide-pulse/);
  await page.screenshot({ path: `${shots}/guide_granary.png` });
  await page.getByTestId('tab-housing').click();
  await expect(page.getByTestId('build-shack').locator('small')).toHaveText('Сначала поставьте Амбар');
  await page.getByTestId('build-shack').click();
  await expect.poll(async () => page.evaluate(() => window.__game!.snapshot().buildings.some((b) => b.type === 'shack'))).toBe(false);

  for (const [tab, type] of [
    ['storage', 'granary'],
    ['storage', 'stockpile'],
    ['food', 'orchard'],
    ['industry', 'woodcutter'],
  ] as const) {
    await place(page, tab, type);
  }
  await expect(page.getByTestId('guide-title')).toHaveText('Работники');
  await page.screenshot({ path: `${shots}/guide_workers.png` });
  await page.getByTestId('speed-3').click();
  await page.waitForFunction(() => {
    const snap = window.__game?.snapshot();
    if (!snap) return false;
    return ['orchard', 'woodcutter'].every((kind) => snap.buildings.some((b) => b.type === kind && b.complete));
  });
  for (let i = 0; i < 2; i++) {
    await expect(page.getByTestId('worker-plus')).toBeEnabled();
    await page.getByTestId('worker-plus').click();
  }
  await expect(page.getByTestId('guide')).toBeHidden();
  const mark = await page.evaluate(() => ({
    tick: window.__game!.snapshot().tick,
    people: window.__game!.snapshot().people,
  }));
  await page.waitForFunction((from) => (window.__game?.snapshot().tick ?? 0) >= from + 10 * 60, mark.tick);
  const after = await page.evaluate(() => window.__game!.snapshot());
  expect(after.popularity).toBeGreaterThanOrEqual(0);
  expect(after.people).toBeGreaterThanOrEqual(mark.people);
});

test('сетевая игра: два браузера в одном лобби', async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const lobbyName = `Тракт ${Date.now().toString(36)}`.slice(0, 32);
  const host = await browser.newContext();
  const guest = await browser.newContext();
  await host.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Хозяин');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  await guest.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Гость');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  const a = await host.newPage();
  const b = await guest.newPage();
  try {
    await a.goto('/road-realms/');
    await b.goto('/road-realms/');
    await a.getByTestId('net-game').click();
    await expect(a.getByTestId('lobby-list')).toBeVisible();
    await a.waitForTimeout(1500);
    await a.screenshot({ path: `${shots}/mp_lobbies.png` });
    await a.getByTestId('lobby-name').fill(lobbyName);
    await a.getByTestId('lobby-create').click();
    await expect(a.getByTestId('lobby-room')).toBeVisible({ timeout: 20_000 });

    await b.getByTestId('net-game').click();
    const row = b.locator('.lobby-row', { hasText: lobbyName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByTestId('lobby-join').click();
    await expect(a.getByTestId('lobby-room')).toContainText('Гость');
    await expect(b.getByTestId('lobby-room')).toContainText('Хозяин');
    await a.screenshot({ path: `${shots}/mp_room.png` });

    await a.getByTestId('lobby-ready').click();
    await b.getByTestId('lobby-ready').click();
    await expect(a.getByTestId('lobby-start')).toBeEnabled({ timeout: 15_000 });
    await a.getByTestId('lobby-start').click();
    await expect(a.getByTestId('speed-1')).toBeDisabled({ timeout: 20_000 });
    await expect(b.getByTestId('speed-1')).toBeDisabled({ timeout: 20_000 });
    await a.locator('#ration').selectOption('feast');

    await expect
      .poll(async () => {
        const left = await a.evaluate(() => window.__game?.mp());
        const right = await b.evaluate(() => window.__game?.mp());
        if (!left || !right || !left.hash || left.hash !== right.hash) return false;
        return left.turn >= 4 && right.turn >= 4 && left.local !== right.local;
      }, { timeout: 40_000 })
      .toBe(true);

    await a.screenshot({ path: `${shots}/mp_match_a.png` });
    await b.screenshot({ path: `${shots}/mp_match_b.png` });
    await expect(a.getByTestId('presence')).toContainText('в сети');
    await expect(b.getByTestId('presence')).toContainText('в сети');
  } finally {
    await a.evaluate(() => window.__game?.cleanupNet()).catch(() => {});
    await host.close();
    await guest.close();
  }
});

test('подробные текстуры: посёлок, жильё, крепость, еда и стройка', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await page.getByTestId('open-menu').click();
  const gfx = page.getByTestId('gfx-toggle');
  await expect(gfx).toHaveText('Графика: высокая');
  await gfx.click();
  await expect(gfx).toHaveText('Графика: простая');
  await gfx.click();
  await expect(gfx).toHaveText('Графика: высокая');
  await page.locator('#close-menu').click();

  const shoot = async (kind: string, file: string) => {
    await page.evaluate((scene) => window.__game!.debugScene(scene), kind);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.screenshot({ path: `${shots}/${file}` });
  };
  await shoot('settlement', 'art_settlement.png');
  await shoot('housing', 'art_housing.png');
  await shoot('keep', 'art_keep.png');
  await shoot('food', 'art_food.png');
  await shoot('site', 'art_site.png');
});

test('оборона: стены, осада и меню', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  const shoot = async (kind: string, file: string) => {
    await page.evaluate((scene) => window.__game!.debugScene(scene), kind);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.screenshot({ path: `${shots}/${file}` });
  };
  await shoot('walls', 'art_walls.png');
  await shoot('siege', 'art_siege.png');
  await page.getByTestId('tab-defence').click();
  await expect(page.getByTestId('build-palisade')).toBeVisible();
  await expect(page.getByTestId('build-gate')).toBeVisible();
  await expect(page.getByTestId('build-woodtower')).toBeVisible();
  await page.screenshot({ path: `${shots}/art_defence_menu.png` });
});

test('цели: настройка, панель и итог', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await expect(page.getByTestId('victory')).toBeVisible();
  await expect(page.getByTestId('victory')).toHaveValue('conquest');
  await expect(page.getByTestId('new-game')).toHaveText('Начать');
  await expect(page.getByTestId('gold-target')).toBeHidden();
  await expect(page.getByTestId('pop-target')).toBeHidden();
  await expect(page.getByTestId('survive-min')).toBeHidden();
  await page.screenshot({ path: `${shots}/goal_setup.png` });
  await page.screenshot({ path: `${shots}/setup_short.png` });
  await page.getByTestId('victory').selectOption('wealth');
  await expect(page.getByTestId('gold-target')).toBeVisible();
  await expect(page.getByTestId('pop-target')).toBeHidden();
  await page.getByTestId('victory').selectOption('bloom');
  await expect(page.getByTestId('pop-target')).toBeVisible();
  await expect(page.getByTestId('gold-target')).toBeHidden();
  await page.getByTestId('victory').selectOption('survival');
  await expect(page.getByTestId('survive-min')).toBeVisible();
  await page.getByTestId('victory').selectOption('wealth');
  await page.getByTestId('know-game').click();
  await page.getByTestId('new-game').click();
  await page.evaluate(() => window.__game!.debugBoard());
  await expect(page.getByTestId('goals')).toContainText('Богатство');
  await expect(page.getByText('Сосед «Ковыль» достиг 4 уровня')).toBeVisible();
  await page.screenshot({ path: `${shots}/goal_panel.png` });
  await page.evaluate(() => window.__game!.debugResults());
  await expect(page.getByTestId('results-title')).toHaveText('Победа');
  await expect(page.getByTestId('results-detail')).toContainText('Богатство');
  await expect(page.getByTestId('results-detail')).toContainText('выполнено');
  await expect(page.getByTestId('results-detail')).toContainText('Ваш посад');
  await expect(page.getByTestId('goals')).toBeHidden();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.getByTestId('again')).toHaveText('Реванш');
  await expect(page.getByTestId('to-menu')).toHaveText('В меню');
  await expect(page.getByTestId('results-title')).toBeVisible();
  await expect(page.locator('.results-table')).toBeVisible();
  await page.screenshot({ path: `${shots}/goal_results.png` });
  await page.screenshot({ path: `${shots}/goal_results_fixed.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.results-player').first()).toBeVisible();
  await expect(page.locator('.results-scroll')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByTestId('to-menu').click();
  await expect(page.getByRole('heading', { name: 'Дорожные края' })).toBeVisible();
});

test('ии: сложность, войско и стены', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await expect(page.getByTestId('advanced')).toBeVisible();
  await expect(page.getByTestId('neighbours')).toBeHidden();
  await page.getByTestId('advanced').locator('summary').click();
  await expect(page.getByTestId('neighbours')).toBeVisible();
  await expect(page.getByTestId('diff-0')).toBeVisible();
  await expect(page.getByTestId('pers-0')).toHaveValue('merchant');
  await expect(page.getByTestId('pers-1')).toHaveValue('warlord');
  await expect(page.getByTestId('pers-2')).toHaveValue('builder');
  await page.getByTestId('diff-0').selectOption('cruel');
  await page.getByTestId('pers-0').selectOption('merchant');
  await page.getByTestId('diff-1').selectOption('easy');
  await page.getByTestId('pers-1').selectOption('warlord');
  await page.getByTestId('diff-2').selectOption('hard');
  await page.getByTestId('pers-2').selectOption('builder');
  await expect(page.getByTestId('ai-note')).toContainText('1 золото');
  await page.screenshot({ path: `${shots}/ai_setup.png` });
  await page.getByTestId('new-game').click();
  const frame = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  await page.evaluate(() => window.__game!.debugScene('mid'));
  await frame();
  await page.screenshot({ path: `${shots}/balance_settlement.png` });
  await page.evaluate(() => window.__game!.debugScene('ai-attack'));
  await frame();
  await page.screenshot({ path: `${shots}/ai_attack.png` });
  await page.evaluate(() => window.__game!.debugScene('ai-walls'));
  await frame();
  await page.screenshot({ path: `${shots}/ai_walls.png` });
});

test('кампания: карта, вступление и цель первой стоянки', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
    localStorage.removeItem('dorozhnye-kraya-campaign');
  });
  await page.goto('/road-realms/');
  await page.getByTestId('campaign-open').click();
  await expect(page.getByTestId('campaign-map')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Кампания' })).toBeVisible();
  await expect(page.getByTestId('campaign-node-1')).toBeEnabled();
  await expect(page.getByTestId('campaign-node-2')).toBeDisabled();
  await page.screenshot({ path: `${shots}/campaign_map.png` });
  await page.getByTestId('campaign-node-1').click();
  await expect(page.getByTestId('scenario-intro')).toBeVisible();
  await expect(page.getByTestId('scenario-intro')).toContainText('Прокормите 10 человек');
  await page.screenshot({ path: `${shots}/campaign_intro.png` });
  await page.getByTestId('scenario-start').click();
  await expect(page.getByTestId('goals')).toBeVisible();
  await expect(page.getByTestId('goals')).toContainText('Прокормите 10 человек');
  const result = await page.evaluate(() => window.__game!.playCampaignScript());
  expect(result?.outcome).toBe('victory');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.getByTestId('results-title')).toHaveText('Победа');
  await expect(page.getByTestId('campaign-stars')).toContainText('★');
  await expect(page.getByTestId('campaign-next')).toHaveText('Далее');
  await page.screenshot({ path: `${shots}/campaign_results.png` });
  expect(errors).toEqual([]);
});

test('звук: панель настроек', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await page.getByTestId('audio-open').click();
  await expect(page.getByTestId('audio-settings')).toBeVisible();
  await page.getByTestId('audio-master').fill('40');
  await page.getByTestId('audio-muted').check();
  await expect(page.getByTestId('mute-audio')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${shots}/audio_settings.png` });
  expect(errors).toEqual([]);
});

test('справка, сохранения, песок, дорога и кадры', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-book')).toBeVisible();
  await expect(page.getByTestId('help-book')).toContainText('Главное здание');
  await expect(page.getByTestId('help-book')).toContainText('Мечник');
  await expect(page.getByTestId('help-book')).toContainText('пшеница');
  await page.screenshot({ path: `${shots}/encyclopedia.png` });
  await page.getByTestId('help-close').click();

  await page.getByTestId('new-game').click();
  await page.getByTestId('open-menu').click();
  await page.getByTestId('save-game').click();
  await expect(page.getByTestId('save-panel')).toBeVisible();
  await expect(page.getByTestId('save-panel')).toContainText('Ячейка 1');
  await page.screenshot({ path: `${shots}/save_panel.png` });
  await page.getByTestId('save-panel').getByRole('button', { name: 'Сохранить' }).first().click();
  await expect(page.getByTestId('save-panel')).toContainText('партия');
  await page.getByTestId('save-close').click();

  await page.evaluate(() => {
    document.getElementById('app')?.classList.add('frame-bare');
    window.__game!.setGfxMode('high');
    window.__game!.focusTerrain('desert', 1.15);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/sand_normal.png` });
  await page.evaluate(() => window.__game!.focusTerrain('desert', 2.6));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/sand_closeup.png` });
  await page.evaluate(() => window.__game!.setGfxMode('simple'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/sand_closeup_simple.png` });
  await page.evaluate(() => {
    document.getElementById('app')?.classList.remove('frame-bare');
    window.__game!.setGfxMode('high');
  });

  await page.evaluate(() => window.__game!.stageRoad());
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/road_in_use.png` });

  await page.evaluate(() => window.__game!.debugScene('mid'));
  await page.evaluate(() => window.__game!.setChunks(false));
  await page.evaluate(() => window.__game!.measureFps(400));
  const before = await page.evaluate(() => window.__game!.measureFps(1200));
  await page.evaluate(() => window.__game!.setChunks(true));
  await page.evaluate(() => window.__game!.measureFps(400));
  const after = await page.evaluate(() => window.__game!.measureFps(1200));
  writeFileSync(`${shots}/fps.json`, JSON.stringify({ before, after }));
  expect(after).toBeGreaterThan(0);
  expect(before).toBeGreaterThan(0);
});

async function phoneProbe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const visible = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el || (el as HTMLElement).hidden) return null;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return r;
    };
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const bad: string[] = [];
    for (const [a, b] of [
      ['#hint', '#resources'],
      ['#hint', '#status'],
      ['#hint', '#panel'],
      ['#hint', '#log'],
      ['#hint', '#phone-goal'],
      ['#log', '#resources'],
      ['#log', '#status'],
      ['#log', '#phone-goal'],
      ['#panel', '#status'],
      ['#panel', '#buildbar'],
      ['#panel', '#speeds'],
      ['#panel', '#topbar'],
      ['#tutorial', '#panel'],
      ['#tutorial', '#speeds'],
      ['#dock', '#topbar'],
      ['#banner', '#panel'],
    ] as const) {
      const ra = visible(a);
      const rb = visible(b);
      if (ra && rb && hit(ra, rb)) bad.push(`${a}×${b}`);
    }
    const nodes = ['#topbar', '#dock', '#panel', '#hint', '#tutorial', '#banner', '#phone-goal', '#log', '#army', '#goals', '#speeds', '#mapwrap', '#toast']
      .map((sel) => visible(sel))
      .filter((rect): rect is DOMRect => !!rect);
    let clear = 0;
    let total = 0;
    for (let y = 4; y < innerHeight; y += 12) {
      for (let x = 4; x < innerWidth; x += 12) {
        total += 1;
        if (!nodes.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) clear += 1;
      }
    }
    return {
      bad,
      share: clear / total,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      home: document.querySelector('#home')?.getBoundingClientRect().height ?? 0,
    };
  });
}

test('телефон: портрет 360×640, 390×844 и альбом', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await expect(page.getByTestId('phone-goal')).toBeVisible();
  await page.evaluate(() => {
    const log = document.querySelector('#log');
    if (!log) return;
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('button');
      line.className = 'log-line';
      line.type = 'button';
      line.textContent = 'Тракт пролегает через весь край. Поставьте амбар и склад.';
      log.append(line);
    }
  });
  const shownLogs = await page.locator('#log .log-line').evaluateAll((nodes) =>
    nodes.filter((node) => getComputedStyle(node).display !== 'none').length,
  );
  expect(shownLogs).toBe(1);
  await expect(page.locator('#buildbar')).toBeVisible();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#speeds')).toBeHidden();
  const portrait = await phoneProbe(page);
  expect(portrait.bad).toEqual([]);
  expect(portrait.share).toBeGreaterThan(0.58);
  expect(portrait.overflow).toBeLessThanOrEqual(1);
  expect(portrait.home).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${shots}/phone_portrait.png` });

  const keep = await page.evaluate(() => window.__game!.snapshot().buildings.find((b) => b.type === 'keep')!.id);
  await page.evaluate((id) => window.__game!.select(id), keep);
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#panel')).toContainText('Главное здание');
  const card = await phoneProbe(page);
  expect(card.bad).toEqual([]);
  expect(card.share).toBeGreaterThan(0.55);
  await page.screenshot({ path: `${shots}/phone_portrait_card.png` });
  await page.locator('#close-panel').click();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#buildbar')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const tall = await phoneProbe(page);
  expect(tall.bad).toEqual([]);
  expect(tall.share).toBeGreaterThan(0.58);
  expect(tall.overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.res', { hasText: 'Дерево' })).toBeVisible();
  await page.screenshot({ path: `${shots}/phone_390.png` });

  await page.setViewportSize({ width: 640, height: 360 });
  await page.waitForTimeout(200);
  const wide = await phoneProbe(page);
  expect(wide.bad).toEqual([]);
  expect(wide.share).toBeGreaterThan(0.58);
  expect(wide.overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('res-toggle')).toBeVisible();
  await page.screenshot({ path: `${shots}/phone_landscape.png` });
});

test('заставка, об игре и установка', async ({ page }) => {
  mkdirSync(shots, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.goto('/road-realms/');
  await expect(page.getByTestId('boot')).toBeHidden();
  await expect(page.getByTestId('version')).toHaveText(/^v1\.0\.0 · /);
  await page.screenshot({ path: `${shots}/title_version.png` });
  await page.getByTestId('about-open').click();
  await expect(page.getByTestId('about')).toContainText('ИП Мельничук');
  await expect(page.getByTestId('about')).toContainText('кодом');
  await page.screenshot({ path: `${shots}/about.png` });
  await page.getByTestId('about-close').click();
  await page.evaluate(() => window.__game!.offerInstall());
  await expect(page.getByTestId('install-banner')).toContainText('Установить');
  await page.screenshot({ path: `${shots}/install_prompt.png` });
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/road-realms/manifest.webmanifest');
    return response.json() as Promise<{ name: string; short_name: string; display: string; icons: { sizes: string; purpose?: string }[] }>;
  });
  expect(manifest.name).toBe('Дорожные края');
  expect(manifest.short_name.length).toBeGreaterThan(0);
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512', '512x512']);
  const privacy = await page.evaluate(async () => (await fetch('/road-realms/privacy.html')).text());
  expect(privacy).toContain('анонимно');
  expect(privacy).toContain('localStorage');
});

test('кадры для витрины 1280×720', async ({ page, browser }) => {
  test.setTimeout(180_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
    localStorage.setItem('dorozhnye-kraya-name', 'Хозяин');
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  const quiet = async () => {
    await page.waitForTimeout(500);
    await expect(page.getByTestId('hint')).toBeHidden();
    await expect(page.locator('#banner')).toBeHidden();
    await expect(page.locator('#log')).toHaveText('');
    await expect(page.locator('#clock')).toContainText('18');
  };
  await page.evaluate(() => window.__game!.debugScene('settlement'));
  await quiet();
  await page.screenshot({ path: `${shots}/store_settlement.png` });
  await page.evaluate(() => window.__game!.debugScene('siege'));
  await quiet();
  await page.screenshot({ path: `${shots}/store_siege.png` });

  await page.goto('/road-realms/');
  await page.getByTestId('campaign-open').click();
  await page.getByTestId('campaign-node-1').click();
  await page.getByTestId('scenario-start').click();
  await expect(page.getByTestId('goal-title')).toHaveText('Корм для тракта');
  await page.evaluate(() => window.__game!.debugScene('settlement'));
  await quiet();
  await expect(page.getByTestId('goal-title')).toHaveText('Корм для тракта');
  await expect(page.getByTestId('goals')).toContainText('Прокормите 10 человек');
  await page.screenshot({ path: `${shots}/store_campaign.png` });

  const lobbyName = `Витрина ${Date.now().toString(36)}`.slice(0, 32);
  const guest = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const third = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await guest.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Путник');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  await third.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Караван');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  const b = await guest.newPage();
  const c = await third.newPage();
  try {
    await page.goto('/road-realms/');
    await page.getByTestId('net-game').click();
    await expect(page.getByTestId('lobby-list')).toBeVisible();
    await expect(page.locator('#net-error')).toHaveText('', { timeout: 20_000 });
    await page.getByTestId('lobby-max').selectOption('3');
    await page.getByTestId('lobby-name').fill(lobbyName);
    await page.getByTestId('lobby-create').click({ timeout: 15_000 });
    await expect(page.getByTestId('lobby-room')).toBeVisible({ timeout: 20_000 });
    for (const [mate, label] of [
      [b, 'Путник'],
      [c, 'Караван'],
    ] as const) {
      await mate.goto('/road-realms/');
      await mate.getByTestId('net-game').click();
      const row = mate.locator('.lobby-row', { hasText: lobbyName });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.getByTestId('lobby-join').click();
      await expect(page.getByTestId('lobby-room')).toContainText(label, { timeout: 20_000 });
    }
    await expect(page.getByTestId('lobby-room')).toContainText('Хозяин');
    await expect(page.getByTestId('lobby-room')).toContainText('3/3');
    await page.screenshot({ path: `${shots}/store_lobby.png` });
  } finally {
    await page.getByTestId('lobby-leave').click({ timeout: 4_000 }).catch(() => {});
    await b.getByTestId('lobby-leave').click({ timeout: 4_000 }).catch(() => {});
    await c.getByTestId('lobby-leave').click({ timeout: 4_000 }).catch(() => {});
    await guest.close();
    await third.close();
  }

  await page.goto('/road-realms/');
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-book')).toBeVisible();
  await page.screenshot({ path: `${shots}/store_encyclopedia.png` });

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await page.evaluate(() => window.__game!.debugScene('settlement'));
  await expect(page.getByTestId('phone-goal')).toBeVisible();
  await expect(page.getByTestId('hint')).toBeHidden();
  await expect(page.locator('#log')).toHaveText('');
  await page.screenshot({ path: `${shots}/store_phone_raw.png` });
  execFileSync('python3', ['-c', letterboxPhone(`${shots}/store_phone_raw.png`, `${shots}/store_phone.png`)]);
});

test('кнопки заставки внутри карточки', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const ids = ['new-game', 'net-game', 'continue-game', 'campaign-open', 'load-game', 'help-open', 'settings-open', 'know-game', 'about-open'];
  const viewports = [
    { width: 1280, height: 800 },
    { width: 830, height: 755 },
    { width: 360, height: 640 },
    { width: 640, height: 360 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto('/road-realms/');
    await expect(page.getByTestId('net-game')).toHaveText('Сетевая игра');
    const scales = viewport.width === 830 ? [1, 1.5] : [1];
    for (const scale of scales) {
      await page.evaluate((value) => document.documentElement.style.setProperty('--ui', String(value)), scale);
      const card = page.locator('#title .menu-card');
      const box = await card.boundingBox();
      expect(box, `${viewport.width}x${viewport.height}`).toBeTruthy();
      for (const id of ids) {
        const button = page.getByTestId(id);
        await expect(button, id).toBeVisible();
        const bounds = await button.boundingBox();
        expect(bounds, id).toBeTruthy();
        expect(bounds!.x, id).toBeGreaterThanOrEqual(box!.x - 1);
        expect(bounds!.y, id).toBeGreaterThanOrEqual(box!.y - 1);
        expect(bounds!.x + bounds!.width, id).toBeLessThanOrEqual(box!.x + box!.width + 1);
        expect(bounds!.y + bounds!.height, id).toBeLessThanOrEqual(box!.y + box!.height + 1);
      }
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--ui', '1'));
    if (viewport.width === 830) await page.screenshot({ path: `${shots}/title_830.png` });
    if (viewport.width === 360) await page.screenshot({ path: `${shots}/title_360.png` });
  }
});

test('настройки лобби видны до старта', async ({ page, browser }) => {
  test.setTimeout(180_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
    localStorage.setItem('dorozhnye-kraya-name', 'Хозяин');
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/road-realms/');
  await page.getByTestId('net-game').click();
  await expect(page.getByTestId('lobby-setup')).toBeVisible();
  await expect(page.locator('#net-error')).toHaveText('', { timeout: 20_000 });
  await page.getByTestId('lobby-max').selectOption('4');
  await page.getByTestId('lobby-map').selectOption('large');
  await page.getByTestId('lobby-speed').selectOption('2');
  await page.getByTestId('lobby-start').selectOption('high');
  await page.getByTestId('lobby-ai').selectOption('1');
  await page.getByTestId('lobby-diff').selectOption('hard');
  await page.getByTestId('lobby-teams').selectOption('pairs');
  await page.getByTestId('lobby-pass').fill('тракт');
  const lobbyName = `Усл ${Date.now().toString(36)}`.slice(0, 12);
  await page.getByTestId('lobby-name').fill(lobbyName);
  await page.getByTestId('lobby-setup').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/lobby_settings.png` });
  await page.getByTestId('lobby-create').click({ timeout: 15_000 });
  await expect(page.getByTestId('lobby-room')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('lobby-settings')).toBeVisible();
  await expect(page.getByTestId('lobby-settings')).toContainText('2×');
  await expect(page.getByTestId('lobby-settings')).toContainText('2×2');
  await expect(page.getByTestId('lobby-settings')).toContainText('богатые');
  await page.getByTestId('lobby-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/lobby_room.png` });

  const guest = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await guest.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Путник');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  const mate = await guest.newPage();
  try {
    await mate.goto('/road-realms/');
    await mate.getByTestId('net-game').click();
    const row = mate.locator('.lobby-row', { hasText: lobbyName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId('lobby-lock')).toBeVisible();
    await expect(row.getByTestId('lobby-summary')).toContainText('2×');
    await expect(row.getByTestId('lobby-summary')).toContainText('2×2');
    await row.getByTestId('lobby-join').click();
    await expect(mate.getByTestId('net-error')).toContainText('парол', { timeout: 15_000 });
    await mate.getByTestId('lobby-pass').fill('тракт');
    await row.getByTestId('lobby-join').click();
    await expect(mate.getByTestId('lobby-room')).toContainText('Хозяин', { timeout: 20_000 });
    await expect(mate.getByTestId('lobby-settings')).toContainText('2×2');
  } finally {
    await page.getByTestId('lobby-leave').click({ timeout: 4_000 }).catch(() => {});
    await mate.getByTestId('lobby-leave').click({ timeout: 4_000 }).catch(() => {});
    await guest.close();
  }
});

test('живая партия: пароль, условия, минута локстепа', async ({ browser }) => {
  test.setTimeout(180_000);
  const lobbyName = `Жив ${Date.now().toString(36)}`.slice(0, 12);
  const host = await browser.newContext();
  const guest = await browser.newContext();
  await host.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Хозяин');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  await guest.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-name', 'Путник');
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  const a = await host.newPage();
  const b = await guest.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) {
    page.on('pageerror', (err) => errors.push(err.message));
  }
  try {
    await a.goto('/road-realms/');
    await a.getByTestId('net-game').click();
    await expect(a.getByTestId('lobby-setup')).toBeVisible();
    await expect(a.locator('#net-error')).toHaveText('', { timeout: 20_000 });
    await a.getByTestId('lobby-max').selectOption('2');
    await a.getByTestId('lobby-map').selectOption('large');
    await a.getByTestId('lobby-speed').selectOption('2');
    await a.getByTestId('lobby-start').selectOption('high');
    await a.getByTestId('lobby-ai').selectOption('1');
    await a.getByTestId('lobby-diff').selectOption('hard');
    await a.getByTestId('lobby-teams').selectOption('pairs');
    await a.getByTestId('lobby-pass').fill('тракт');
    await a.getByTestId('lobby-name').fill(lobbyName);
    await a.getByTestId('lobby-create').click({ timeout: 15_000 });
    await expect(a.getByTestId('lobby-room')).toBeVisible({ timeout: 20_000 });
    await expect(a.getByTestId('lobby-settings')).toContainText('2×');
    await expect(a.getByTestId('lobby-settings')).toContainText('2×2');
    await expect(a.getByTestId('lobby-settings')).toContainText('богатые');

    await b.goto('/road-realms/');
    await b.getByTestId('net-game').click();
    const row = b.locator('.lobby-row', { hasText: lobbyName });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId('lobby-lock')).toBeVisible();
    await row.getByTestId('lobby-join').click();
    await expect(b.getByTestId('net-error')).toContainText('парол', { timeout: 15_000 });
    await b.getByTestId('lobby-pass').fill('тракт');
    await row.getByTestId('lobby-join').click();
    await expect(b.getByTestId('lobby-room')).toContainText('Хозяин', { timeout: 20_000 });
    await expect(a.getByTestId('lobby-room')).toContainText('Путник');

    await a.getByTestId('lobby-ready').click();
    await b.getByTestId('lobby-ready').click();
    await expect(a.getByTestId('lobby-start')).toBeEnabled({ timeout: 15_000 });
    await a.getByTestId('lobby-start').click();
    await expect(a.getByTestId('speed-1')).toBeDisabled({ timeout: 20_000 });
    await expect(b.getByTestId('speed-1')).toBeDisabled({ timeout: 20_000 });
    await a.locator('#ration').selectOption('feast');

    const started = Date.now();
    let matched = 0;
    let maxTurn = 0;
    while (Date.now() - started < 60_000) {
      const left = await a.evaluate(() => window.__game?.mp() ?? null);
      const right = await b.evaluate(() => window.__game?.mp() ?? null);
      expect(left && right, JSON.stringify({ left, right, errors })).toBeTruthy();
      await expect(a.locator('#syncbox')).not.toContainText('Рассинхронизация');
      await expect(b.locator('#syncbox')).not.toContainText('Рассинхронизация');
      if (left!.turn === right!.turn) {
        expect(left!.hash, JSON.stringify({ left, right })).toBe(right!.hash);
        matched += 1;
        maxTurn = Math.max(maxTurn, left!.turn);
      }
      await a.waitForTimeout(1000);
    }
    expect(maxTurn, JSON.stringify({ maxTurn, matched, errors })).toBeGreaterThan(40);
    expect(matched, 'хотя бы одна общая сверка хеша').toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await a.evaluate(() => window.__game?.cleanupNet()).catch(() => {});
    await b.evaluate(() => window.__game?.cleanupNet()).catch(() => {});
    await host.close();
    await guest.close();
  }
});

test('копейщики, конюшня и матрица контрударов', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('dorozhnye-kraya-tutorial', '1');
  });
  const overlaps = (a: { x: number; y: number; r: number; b: number } | null, b: { x: number; y: number; r: number; b: number } | null) =>
    !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  const hudBoxes = () =>
    page.evaluate(() => {
      const rect = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el || el.hidden) return null;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) return null;
        return { x: box.left, y: box.top, r: box.right, b: box.bottom };
      };
      return {
        resources: rect('#resources'),
        army: rect('#army-box'),
        topbar: rect('#topbar'),
        goals: rect('#goals'),
      };
    });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  for (const size of [
    { width: 1280, height: 800 },
    { width: 830, height: 755 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.__game!.debugScene('hud'));
    await page.waitForTimeout(250);
    const boxes = await hudBoxes();
    expect(boxes.resources, `${size.width} resources`).not.toBeNull();
    expect(boxes.army, `${size.width} army`).not.toBeNull();
    expect(overlaps(boxes.resources, boxes.army), `${size.width} resources/army ${JSON.stringify(boxes)}`).toBe(false);
    expect(overlaps(boxes.topbar, boxes.army), `${size.width} topbar/army`).toBe(false);
    expect(overlaps(boxes.goals, boxes.army), `${size.width} goals/army`).toBe(false);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.__game!.debugScene('hud'));
  await page.waitForTimeout(250);
  await expect(page.getByText('Поставьте амбар')).toBeHidden();
  await expect(page.locator('.log-line')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/hud_desktop.png` });
  await page.evaluate(() => window.__game!.debugScene('cavalry-fight'));
  await page.waitForTimeout(250);
  await expect(page.getByText('Поставьте амбар')).toBeHidden();
  await page.screenshot({ path: `${shots}/spear_cavalry.png` });
  await page.evaluate(() => window.__game!.debugScene('supply'));
  await page.waitForTimeout(250);
  await expect(page.locator('#tutorial')).toBeHidden();
  await page.screenshot({ path: `${shots}/stable_smith.png` });
  await page.evaluate(() => window.__game!.debugScene('battle'));
  await page.waitForTimeout(250);
  await expect(page.locator('.log-line')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/battle_units.png` });
  await page.evaluate(() => window.__game!.debugScene('ladders'));
  await page.waitForTimeout(250);
  await expect(page.getByText('Поставьте амбар')).toBeHidden();
  await page.screenshot({ path: `${shots}/siege_ladders.png` });
  await page.evaluate(() => window.__game!.debugScene('siege-tower'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/siege_tower.png` });
  await page.evaluate(() => window.__game!.debugScene('healer'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/healer.png` });
  await page.evaluate(() => window.__game!.debugScene('mercs'));
  await page.waitForTimeout(250);
  await expect(page.getByTestId('merc-panel')).toBeVisible();
  await page.screenshot({ path: `${shots}/mercenary_panel.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/road-realms/');
  await page.getByTestId('help-open').click();
  await expect(page.getByTestId('help-close')).toBeVisible();
  await expect(page.getByTestId('help-units')).toBeVisible();
  const phoneBg = await page.locator('#help-book').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(phoneBg).toBe('rgb(28, 22, 18)');
  await page.locator('#help-units').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.locator('#help-book').screenshot({ path: `${shots}/encyclopedia_phone.png` });
  await page.locator('#help-matrix').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.locator('.matrix-scroll').evaluate((el) => {
    el.scrollLeft = 140;
  });
  const stuck = await page.evaluate(() => {
    const cell = document.querySelector('.counter-matrix tbody th');
    const wrap = document.querySelector('.matrix-scroll');
    if (!cell || !wrap) return null;
    return { cell: cell.getBoundingClientRect().left, wrap: wrap.getBoundingClientRect().left };
  });
  expect(stuck).not.toBeNull();
  expect(Math.abs((stuck?.cell ?? 0) - (stuck?.wrap ?? 0))).toBeLessThan(3);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/road-realms/');
  await page.getByTestId('help-open').click();
  const deskBg = await page.locator('#help-book').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(deskBg).toBe('rgb(28, 22, 18)');
  await expect(page.getByTestId('help-close')).toBeVisible();
  await page.getByTestId('help-units').screenshot({ path: `${shots}/encyclopedia_units.png` });
  await page.getByTestId('help-matrix').screenshot({ path: `${shots}/counter_matrix.png` });
});

test('сезоны: одно поселение летом, осенью, зимой и в дождь', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await page.evaluate(() => window.__game!.setGfxMode('high'));
  await page.evaluate(() => window.__game!.setSpeed(0));

  const shot = async (kind: string, file: string, season: string) => {
    await page.evaluate((name) => window.__game!.debugScene(name), kind);
    await page.waitForTimeout(300);
    const climate = await page.evaluate(() => {
      const snap = window.__game!.snapshot();
      const badge = document.querySelector<HTMLElement>('#season-badge');
      return { season: snap.season, weather: snap.weather, text: badge?.textContent ?? '', title: badge?.title ?? '' };
    });
    expect(climate.season).toBe(season);
    expect(climate.text.length).toBeGreaterThan(0);
    expect(climate.title).toContain('дальше');
    await expect(page.getByTestId('season-badge')).toBeVisible();
    await page.screenshot({ path: `${shots}/${file}` });
    return climate;
  };

  await shot('season-spring', 'season_spring.png', 'spring');
  const summer = await shot('season-summer', 'season_summer.png', 'summer');
  expect(summer.weather === 'clear' || summer.weather === 'heat').toBe(true);
  await page.getByTestId('season-badge').screenshot({ path: `${shots}/season_badge.png` });
  await shot('season-autumn', 'season_autumn.png', 'autumn');
  const winter = await shot('season-winter', 'season_winter.png', 'winter');
  expect(winter.weather).toBe('snow');
  const rain = await shot('season-rain', 'season_rain.png', 'spring');
  expect(rain.weather).toBe('rain');
});

test('дорожные события: караван, налёт, ярмарка и весть', async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/road-realms/');
  await page.getByTestId('new-game').click();
  await page.evaluate(() => window.__game!.setGfxMode('high'));
  await page.evaluate(() => window.__game!.setSpeed(0));

  await page.evaluate(() => window.__game!.debugScene('event-caravan'));
  await page.waitForTimeout(300);
  await expect(page.getByTestId('caravan-box')).toBeVisible();
  await expect(page.getByTestId('caravan-buy')).toBeVisible();
  await expect(page.getByTestId('event-note')).toBeVisible();
  await page.screenshot({ path: `${shots}/event_caravan.png` });

  await page.evaluate(() => window.__game!.debugScene('event-raid'));
  await page.waitForTimeout(300);
  await expect(page.getByTestId('event-note')).toContainText('разбойники');
  await page.screenshot({ path: `${shots}/event_raid.png` });

  await page.evaluate(() => window.__game!.debugScene('event-fair'));
  await page.waitForTimeout(300);
  await expect(page.getByTestId('event-note')).toContainText('Ярмарка');
  await page.screenshot({ path: `${shots}/event_fair.png` });

  await page.evaluate(() => window.__game!.debugScene('event-note'));
  await page.waitForTimeout(200);
  await page.getByTestId('event-show').click();
  await expect(page.getByTestId('event-note')).toBeVisible();
  await page.screenshot({ path: `${shots}/event_note.png` });
});

test('достижения и статистика', async ({ page }) => {
  test.setTimeout(60_000);
  mkdirSync(shots, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/road-realms/');
  await page.evaluate(() => window.__game!.previewMeta());
  await expect(page.getByTestId('achieve-count')).toHaveText('3 / 32');
  await expect(page.getByTestId('ach-gold-1000')).toBeVisible();
  await expect(page.getByTestId('ach-secret-road')).toContainText('Скрытое');
  await page.screenshot({ path: `${shots}/achievements.png` });
  await page.getByTestId('achieve-close').click();
  await page.evaluate(() => window.__game!.previewStats());
  await expect(page.getByTestId('stats-games')).toHaveText('12');
  await expect(page.getByTestId('stats-wins')).toHaveText('5');
  await expect(page.getByTestId('stats-time')).toHaveText('1 ч 35 мин');
  await expect(page.getByTestId('stats-unit')).toHaveText('копейщик');
  await page.screenshot({ path: `${shots}/stats.png` });
  await page.getByTestId('stats-close').click();
  await page.evaluate(() => window.__game!.previewUnlock());
  await expect(page.locator('#toast')).toContainText('Собрать 1000 золота');
  await page.screenshot({ path: `${shots}/achieve_toast.png` });
});

function letterboxPhone(raw: string, out: string): string {
  return `
from PIL import Image, ImageDraw, ImageFont
raw = Image.open(${JSON.stringify(raw)}).convert('RGB')
canvas = Image.new('RGB', (1280, 720), (36, 28, 22))
height = 640
scale = height / raw.height
width = max(1, int(raw.width * scale))
phone = raw.resize((width, height), Image.Resampling.LANCZOS)
x = (1280 - width) // 2
y = (720 - height) // 2
canvas.paste(phone, (x, y))
draw = ImageDraw.Draw(canvas)
draw.rectangle([x - 4, y - 4, x + width + 3, y + height + 3], outline=(196, 160, 90), width=3)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 32)
except OSError:
    font = ImageFont.load_default()
draw.text((56, 320), 'Телефон', fill=(232, 214, 176), font=font)
canvas.save(${JSON.stringify(out)})
`;
}

test.describe('альбом телефона', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 915, height: 412 },
    deviceScaleFactor: 1,
  });

  test('удобный альбом: колонки, призрак, войско и подсказка портрета', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(shots, { recursive: true });
    await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
    await page.goto('/road-realms/');
    await page.getByTestId('new-game').click();
    await expect(page.locator('#buildbar')).toBeVisible();

    const probe = () =>
      page.evaluate(() => {
        const shown = (el: Element | null) => {
          if (!el || (el as HTMLElement).hidden) return null;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return null;
          const rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return null;
          return rect;
        };
        const clipped = (el: Element) => {
          const rect = el.getBoundingClientRect();
          let parent = el.parentElement;
          while (parent && parent !== document.body) {
            const style = getComputedStyle(parent);
            const scroll = `${style.overflow}${style.overflowY}${style.overflowX}`;
            if (/auto|scroll|hidden/.test(scroll)) {
              const host = parent.getBoundingClientRect();
              if (rect.top < host.top - 1 || rect.bottom > host.bottom + 1 || rect.left < host.left - 1 || rect.right > host.right + 1) return true;
            }
            parent = parent.parentElement;
          }
          return false;
        };
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        const bad: string[] = [];
        for (const [a, b] of [
          ['#topbar', '#dock'],
          ['#topbar', '#land-tray'],
          ['#topbar', '#army'],
          ['#dock', '#army'],
          ['#dock', '#place-confirm'],
          ['#hint', '#topbar'],
          ['#hint', '#dock'],
          ['#log', '#phone-goal'],
          ['#log', '#topbar'],
          ['#log', '#dock'],
          ['#panel', '#topbar'],
          ['#panel', '#army'],
          ['#home', '#tabs button'],
          ['#map-toggle', '#tabs button'],
        ] as const) {
          const left = shown(document.querySelector(a));
          const right = shown(document.querySelector(b));
          if (left && right && hit(left, right)) bad.push(`${a}×${b}`);
        }
        const covers = ['#topbar', '#dock', '#army', '#land-tray', '#panel', '#hint', '#phone-goal', '#log', '#place-confirm', '#banner', '#toast']
          .map((sel) => shown(document.querySelector(sel)))
          .filter((rect): rect is DOMRect => !!rect);
        let clear = 0;
        let total = 0;
        for (let y = 4; y < innerHeight; y += 12) {
          for (let x = 4; x < innerWidth; x += 12) {
            total += 1;
            if (!covers.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) clear += 1;
          }
        }
        const outside: string[] = [];
        const short: string[] = [];
        const overflow: string[] = [];
        const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        for (const button of document.querySelectorAll('button')) {
          if (!shown(button) || clipped(button)) continue;
          const rect = button.getBoundingClientRect();
          const name = button.id || textOf(button) || 'button';
          if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) outside.push(name);
          if (button.scrollWidth > button.clientWidth + 1) overflow.push(`${name}:${button.scrollWidth}>${button.clientWidth}`);
        }
        const resources = document.querySelector('#resources');
        const resourceBox = resources?.getBoundingClientRect();
        const resourceStyle = resources ? getComputedStyle(resources) : null;
        const resourceScrolls = !!(
          resources &&
          resourceStyle &&
          /auto|scroll/.test(resourceStyle.overflowY) &&
          resources.scrollHeight > resources.clientHeight + 1
        );
        for (const chip of document.querySelectorAll('#resources .res')) {
          if (!shown(chip) || !resourceBox) continue;
          if (chip.scrollWidth > chip.clientWidth + 1) overflow.push(`res:${textOf(chip)}:${chip.scrollWidth}>${chip.clientWidth}`);
          if (chip.scrollHeight > chip.clientHeight + 1) overflow.push(`res-h:${textOf(chip)}`);
          const rect = chip.getBoundingClientRect();
          const horizontal = rect.left < resourceBox.left - 1 || rect.right > resourceBox.right + 1;
          const above = rect.bottom < resourceBox.top - 1;
          const below = rect.top > resourceBox.bottom + 1;
          const partial = rect.top < resourceBox.bottom - 1 && rect.bottom > resourceBox.bottom + 1;
          if (horizontal) overflow.push(`res-cut:${textOf(chip)}:resources`);
          if ((above || below || partial) && !resourceScrolls) overflow.push(`res-cut:${textOf(chip)}:resources`);
          if (partial) overflow.push(`res-cut:${textOf(chip)}:partial`);
        }
        for (const sel of ['#open-menu', '#land-full', '#army-box', '#speeds button', '#army-groups button']) {
          for (const button of document.querySelectorAll(sel)) {
            const rect = shown(button);
            if (!rect) continue;
            if (rect.height < 44 || rect.width < 44) short.push(`${sel}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
          }
        }
        return {
          land: document.documentElement.classList.contains('phone-land'),
          coarse: window.matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches,
          share: clear / total,
          bad,
          outside,
          short,
          overflow,
        };
      });

    const tabClear = () =>
      page.evaluate(() => {
        const overlap = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
          a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        const tabs = document.querySelector<HTMLElement>('#tabs');
        const home = document.querySelector('#home');
        const map = document.querySelector('#map-toggle');
        if (!tabs || !home || !map) return ['missing'];
        const hits: string[] = [];
        const check = (label: string) => {
          const host = tabs.getBoundingClientRect();
          const buttons = [home, map].map((el) => el.getBoundingClientRect());
          for (const tab of tabs.querySelectorAll('button')) {
            const rect = tab.getBoundingClientRect();
            const top = Math.max(rect.top, host.top);
            const bottom = Math.min(rect.bottom, host.bottom);
            const left = Math.max(rect.left, host.left);
            const right = Math.min(rect.right, host.right);
            if (bottom - top < 2 || right - left < 2) continue;
            const visible = { left, right, top, bottom };
            for (const button of buttons) {
              if (overlap(button, visible)) hits.push(`${label}:${(tab.textContent || '').trim()}`);
            }
          }
          if (buttons[0].bottom > host.top + 1) hits.push(`${label}:nav-below-tabs`);
        };
        tabs.scrollTop = 0;
        check('top');
        tabs.scrollTop = Math.max(0, tabs.scrollHeight - tabs.clientHeight);
        check('end');
        tabs.scrollTop = 0;
        return hits;
      });

    for (const size of [
      { width: 800, height: 360 },
      { width: 915, height: 412 },
      { width: 740, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      if (size.width === 915 || size.width === 740) {
        expect(await tabClear(), `${size.width} tabs under nav`).toEqual([]);
      }
      const layout = await probe();
      expect(layout.land, `${size.width} class`).toBe(true);
      expect(layout.share, `${size.width} map`).toBeGreaterThan(0.6);
      expect(layout.bad, `${size.width} overlaps ${JSON.stringify(layout)}`).toEqual([]);
      expect(layout.outside, `${size.width} outside`).toEqual([]);
      expect(layout.short, `${size.width} thumbs`).toEqual([]);
      expect(layout.overflow, `${size.width} text`).toEqual([]);
    }

    await page.setViewportSize({ width: 740, height: 360 });
    await page.waitForTimeout(200);
    expect(await tabClear(), '740 shot').toEqual([]);
    await page.screenshot({ path: `${shots}/land_hud_740.png` });
    await page.setViewportSize({ width: 915, height: 412 });
    await page.evaluate(() => window.__game!.debugScene('land'));
    await page.waitForTimeout(250);
    await expect(page.getByTestId('phone-goal')).toBeVisible();
    await expect(page.getByTestId('open-menu')).toBeVisible();
    await expect(page.getByTestId('speed-0')).toBeVisible();
    expect(await tabClear(), '915 shot').toEqual([]);
    await page.screenshot({ path: `${shots}/land_hud_915.png` });

    await page.evaluate(() => window.__game!.debugScene('land-ghost'));
    await page.waitForTimeout(250);
    await expect(page.getByTestId('place-confirm')).toBeVisible();
    await expect(page.getByTestId('place-ok')).toBeVisible();
    await expect(page.getByTestId('place-cancel')).toBeVisible();
    const ghost = await probe();
    expect(ghost.bad, JSON.stringify(ghost)).toEqual([]);
    expect(ghost.outside).toEqual([]);
    expect(ghost.overflow, JSON.stringify(ghost.overflow)).toEqual([]);
    await page.screenshot({ path: `${shots}/land_ghost.png` });

    await page.evaluate(() => window.__game!.setSpeed(1));
    const before = await page.evaluate(() => window.__game!.snapshot().buildings.length);
    const canvas = page.locator('#world');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2 + 16);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__game!.snapshot().buildings.length)).toBe(before);
    await page.getByTestId('place-cancel').click();
    await expect(page.getByTestId('place-confirm')).toBeHidden();
    expect(await page.evaluate(() => window.__game!.snapshot().buildings.length)).toBe(before);

    await page.getByTestId('tab-storage').click();
    await page.getByTestId('build-granary').click();
    await expect(page.getByTestId('place-confirm')).toBeVisible();
    const granaries = await page.evaluate(() => window.__game!.snapshot().buildings.filter((b) => b.type === 'granary').length);
    await page.getByTestId('place-ok').click();
    await expect.poll(async () => page.evaluate(() => window.__game!.snapshot().buildings.filter((b) => b.type === 'granary').length)).toBe(granaries + 1);

    await page.evaluate(() => window.__game!.debugScene('land-army'));
    await page.waitForTimeout(200);
    const point = await page.evaluate(() => window.__game!.armyPoints()[0]);
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('army-attack')).toBeVisible();
    await expect(page.getByTestId('army-attack')).toHaveText('Атака');
    await expect(page.getByTestId('army-hold')).toHaveText('Стоять');
    await expect(page.getByTestId('army-home')).toHaveText('Отступить');
    await expect(page.getByTestId('army-count')).toContainText('Всего 3');
    const army = await probe();
    expect(army.bad, JSON.stringify(army)).toEqual([]);
    expect(army.overflow, JSON.stringify(army.overflow)).toEqual([]);
    expect(army.share).toBeGreaterThan(0.6);
    await page.screenshot({ path: `${shots}/land_army.png` });
    const keepId = await page.evaluate(() => window.__game!.snapshot().buildings.find((b) => b.type === 'keep')!.id);
    await page.evaluate((id) => window.__game!.select(id), keepId);
    await expect(page.locator('#panel')).toBeVisible();
    const sheet = await page.locator('#panel').boundingBox();
    expect(sheet!.x).toBeGreaterThan(700);
    expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(916);
    const sheetProbe = await probe();
    expect(sheetProbe.bad, JSON.stringify(sheetProbe)).toEqual([]);
    expect(sheetProbe.share).toBeGreaterThan(0.6);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await expect(page.getByTestId('turn-hint')).toBeVisible();
    await expect(page.getByTestId('turn-hint')).toContainText('Поверните телефон для удобства');
    await expect(page.locator('html')).not.toHaveClass(/phone-land/);
    await page.screenshot({ path: `${shots}/land_portrait_hint.png` });
    await page.getByTestId('turn-dismiss').click();
    await expect(page.getByTestId('turn-hint')).toBeHidden();

    const manifest = await page.evaluate(async () => {
      const response = await fetch('/road-realms/manifest.webmanifest');
      return response.json() as Promise<{ orientation?: string }>;
    });
    expect(manifest.orientation).toBe('landscape');
  });
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
      debugArmy: () => number[];
      armyPoints: () => { id: number; x: number; y: number }[];
      banditScreen: () => { x: number; y: number } | null;
      markerKind: () => string;
      focusArmy: () => void;
      snapshot: () => {
        tick: number;
        season: string;
        weather: string;
        idle: number;
        used: number;
        cap: number;
        popularity: number;
        people: number;
        apples: number;
        buildings: { id: number; type: string; complete: boolean; workers: number; x: number; y: number }[];
      };
      mp: () => { hash: string; turn: number; tick: number; local: number; names: string[] };
      cleanupNet: () => Promise<void>;
      debugScene: (kind: string) => void;
      debugBoard: () => void;
      debugResults: () => void;
      playCampaignScript: () => { outcome: string; tick: number } | null;
      measureFps: (ms: number) => Promise<number>;
      setChunks: (on: boolean) => void;
      focusTerrain: (kind: string, zoom?: number) => void;
      offerInstall: () => void;
      setGfxMode: (mode: 'high' | 'simple') => void;
      stageRoad: () => void;
    };
  }
}
