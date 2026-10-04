import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const url = process.env.SOAK_URL || 'http://127.0.0.1:4174/road-realms/';
const minutes = Number(process.env.SOAK_MINUTES || 30);
const out = process.env.SOAK_OUT || 'test-results/soak.json';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
await page.addInitScript(() => localStorage.setItem('dorozhnye-kraya-tutorial', '1'));
await page.goto(url);
await page.getByTestId('new-game').click();
await page.evaluate(() => window.__game.setSpeed(2));
const client = await page.context().newCDPSession(page);
await client.send('Performance.enable');
const samples = [];
for (let minute = 1; minute <= minutes; minute++) {
  await page.waitForTimeout(60_000);
  const metrics = await client.send('Performance.getMetrics');
  const heap = metrics.metrics.find((row) => row.name === 'JSHeapUsedSize')?.value ?? 0;
  const crash = await page.locator('#crash').isVisible();
  samples.push({ minute, heap, crash });
  console.log(JSON.stringify(samples.at(-1)));
  if (crash) errors.push('crash panel visible');
}
const first = samples[4]?.heap || samples[0].heap;
const last = samples.at(-1).heap;
const grew = last > first * 1.8 && last - first > 40 * 1024 * 1024;
const report = { url, minutes, samples, errors, grew, first, last };
writeFileSync(out, JSON.stringify(report, null, 2));
await browser.close();
if (errors.length || grew) {
  console.error(JSON.stringify({ errors, grew, first, last }));
  process.exit(1);
}
