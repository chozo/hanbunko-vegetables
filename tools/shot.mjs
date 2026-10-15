// 開発用：ヘッドレス Chrome でスクリーンショットを撮る小さなスクリプト
// 使い方: node tools/shot.mjs <url> <outDir> <script.json>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [url = 'http://localhost:5199/', out = 'shots', stepsFile] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vp = steps.viewport ?? { width: 390, height: 844 };
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: steps.dpr ?? 2, hasTouch: true, isMobile: !!steps.mobile });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (steps.init) await page.addInitScript(steps.init);
await page.goto(url);
await page.waitForTimeout(1500);
for (const s of steps.steps ?? []) {
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined) console.log('[eval]', JSON.stringify(r));
  }
  if (s.drag) {
    // 実際のマウス操作（ページ座標）: [x0, y0, x1, y1, steps]
    const [x0, y0, x1, y1, n = 12] = s.drag;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= n; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
      if (s.dragShotAt === i) await page.screenshot({ path: `${out}/${s.dragShot}.png` });
    }
    await page.mouse.up();
  }
  if (s.touchDrag) {
    // タッチ操作（CDP）: [x0, y0, x1, y1, steps]
    const cdp = await page.context().newCDPSession(page);
    const [x0, y0, x1, y1, n = 12] = s.touchDrag;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= n; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  if (s.tap) await page.tap(s.tap);
  if (s.click) await page.click(s.click);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) await page.screenshot({ path: `${out}/${s.shot}.png` });
}
await browser.close();
