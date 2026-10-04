import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
  await expect(page.getByTestId('scenario-intro')).toContainText('Прокормите 15 человек');
  await page.screenshot({ path: `${shots}/campaign_intro.png` });
  await page.getByTestId('scenario-start').click();
  await expect(page.getByTestId('goals')).toBeVisible();
  await expect(page.getByTestId('goals')).toContainText('Прокормите 15 человек');
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
    };
  }
}
