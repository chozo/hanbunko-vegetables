// SNS共有用の画像 public/ogp.png（1200×630）を作る。node tools/create-ogp.mjs（開発サーバーを起動しておく）
// ゲーム画面（切る前の野菜と、ぴったり半分こに成功した結果画面）を撮り、タイトルと並べる。
// 成功画面は判定をゆるめず、縦のスワイプ位置を二分探索して本当に誤差 1% 以内になる切り方を探す。
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const GAME_URL = process.env.GAME_URL || 'http://localhost:5173/';
/** 切る前の画面に使う野菜と、成功画面に使う野菜（ステージ番号、0 始まり） */
const AIM_STAGE = Number(process.env.AIM_STAGE ?? 9); // ブロッコリー
const CUT_STAGE = Number(process.env.CUT_STAGE ?? 1); // かぼちゃ

const launch = (args) => chromium.launch({ channel: 'chrome', headless: true, args });
let browser;
try {
  browser = await launch(['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']);
} catch {
  browser = await launch(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
}
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, hasTouch: true });
  await page.goto(GAME_URL);
  await page.waitForTimeout(1200);
  const g = (expr) => page.evaluate(expr);
  await page.click('#start-btn');
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: '#hint,#toast,#banner{display:none!important}' });

  // 1 枚目：切る前の野菜
  await g(`__game.goStage(${AIM_STAGE})`);
  await page.waitForTimeout(2000);
  const aim = await page.screenshot({ type: 'png' });

  // 2 枚目：縦のスワイプ位置を二分探索して、ぴったり半分こに成功する切り方を探す
  const cutAt = async (fx) => {
    await g(`__game.goStage(${CUT_STAGE})`);
    await page.waitForTimeout(1500);
    await g(`(()=>{const s=__game.size; __game.cut(s.width*${fx}, 3, s.width*${fx}+1, s.height-3)})()`);
    await page.waitForFunction(() => __game.state === 'result', null, { timeout: 15000 });
    return g('__game.judgement');
  };
  let lo = 0.3, hi = 0.7, j = await cutAt(0.5);
  for (let i = 0; i < 12 && !j.success; i++) {
    // 左のかけら（displayA）が大きすぎれば左へ、小さすぎれば右へ
    if (Number(j.displayA) > 50) hi = (lo + hi) / 2;
    else lo = (lo + hi) / 2;
    j = await cutAt((lo + hi) / 2);
  }
  if (!j.success) throw new Error(`成功する切り方が見つからなかった（最後 ${j.displayA}:${j.displayB}）`);
  // 光の演出が落ち着き、結果カードとボタンが出るまで待つ
  await page.waitForTimeout(4500);
  const result = await page.screenshot({ type: 'png' });
  console.log(`成功画面：${j.displayA} : ${j.displayB}`);

  const img = (b) => `data:image/png;base64,${b.toString('base64')}`;
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await card.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;width:1200px;height:630px;overflow:hidden;color:#fff;font-family:"Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN",sans-serif;
      background:radial-gradient(circle at 6% 10%,#ff9a1a44,transparent 22%),radial-gradient(circle at 34% 96%,#5fd03a33,transparent 24%),radial-gradient(circle at 56% 6%,#a24cff33,transparent 20%),radial-gradient(ellipse at 30% 60%,#1d1660,#0a0826 72%)}
    .copy{position:absolute;left:60px;top:140px;width:580px}
    .brand{font-size:17px;letter-spacing:6px;color:#9fe0ff;font-weight:700;margin:0 0 16px}
    h1{font-size:76px;white-space:nowrap;line-height:1.1;margin:0;font-weight:800;letter-spacing:4px;text-shadow:0 6px 0 #2d7a1f,0 0 40px #8cff6688}
    .ed{font-size:44px;white-space:nowrap;font-weight:800;margin:10px 0 0;letter-spacing:6px;color:#c8ff9a}
    .sub{font-size:31px;white-space:nowrap;font-weight:700;color:#ffd860;margin:30px 0 0;letter-spacing:2px}
    .note{margin-top:28px;display:inline-block;border:2px solid #ffffff55;border-radius:30px;padding:10px 22px;font-size:20px;letter-spacing:2px;color:#eef}
    .shot{position:absolute;width:270px;height:480px;border-radius:26px;border:6px solid #fff;overflow:hidden;box-shadow:0 24px 50px #0009;background:#000}
    .shot img{width:100%;height:100%;object-fit:cover;display:block}
    .a{left:650px;top:96px;transform:rotate(-5deg)}
    .b{left:895px;top:66px;transform:rotate(5deg)}
  </style>
  <div class="copy"><p class="brand">HANBUNKO · VEGETABLES</p><h1>ひと切り半分こ</h1><p class="ed">〜野菜編〜</p><p class="sub">体積をぴったり 50:50 に</p><p class="note">10 種類の野菜を、スワイプの一刀で</p></div>
  <div class="shot a"><img src="${img(aim)}"></div>
  <div class="shot b"><img src="${img(result)}"></div>
  </html>`);
  await card.evaluate(() => document.fonts.ready);
  await card.waitForTimeout(200);
  await card.screenshot({ path: fileURLToPath(new URL('../public/ogp.png', import.meta.url)) });
  console.log('Created public/ogp.png (1200 × 630)');
} finally {
  await browser.close();
}
