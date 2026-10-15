// 告知動画の台本。npm run promo（確認用: PROMO_EVERY=15 npm run promo）
// 切る位置は、切る前に「切らずに体積比を測る」フック（__game.preview）で探し、成功・惜しい失敗を狙って作る。
// ステージ: 0 ナス / 1 かぼちゃ / 2 じゃがいも / 3 キャベツ / 4 ピーマン / 5 玉ねぎ / 6 白菜 / 7 とうもろこし / 8 大根 / 9 ブロッコリー

export const config = {
  slug: 'hanbunko-vegetables',
  url: 'https://game.chozo.net/hanbunko-vegetables/',
  orientation: 'portrait',
  game: { width: 390, height: 693 },
  serveDir: 'dist',
  gamePath: '/hanbunko-vegetables/',
  background:
    'radial-gradient(circle at 12% 10%, #ff9a1a55, transparent 30%), radial-gradient(circle at 88% 88%, #5fd03a44, transparent 32%), radial-gradient(circle at 90% 8%, #a24cff44, transparent 26%), radial-gradient(ellipse at 50% 45%, #1d1660, #0a0826 75%)',
  // BGM は tools/promo/music.js（明るいポップ。場面の切り替わりの秒は music.js の marks の既定値）
  music: { script: 'music.js', gain: 0.3 },
};

const GREEN = '#c8ff9a';
const YELLOW = '#ffd860';
const PINK = '#ff7ab0';

export default async function scenario(p) {
  await p.seed(20261015);
  const size = await p.eval((a, w) => w.__game.size);

  /** 角度 deg の直線を、表示領域の中心から d だけずらした線の端点（内側 8px まで） */
  function lineFor(deg, d) {
    const a = (deg * Math.PI) / 180;
    const w = size.width, h = size.height, m = 8;
    const dx = Math.cos(a), dy = Math.sin(a);
    const px = w / 2 - dy * d, py = h / 2 + dx * d;
    let t0 = -Infinity, t1 = Infinity;
    for (const [q, v, lo, hi] of [[px, dx, m, w - m], [py, dy, m, h - m]]) {
      if (Math.abs(v) < 1e-9) continue;
      const ta = (lo - q) / v, tb = (hi - q) / v;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    return [px + dx * t0, py + dy * t0, px + dx * t1, py + dy * t1];
  }

  /** 「片側% − 50」が ±target になる線を二分探索で探す（切らずに測る） */
  async function findCut(deg, target) {
    const R = Math.min(size.width, size.height) * 0.4;
    const f = (d) => p.call('preview', ...lineFor(deg, d));
    let lo = -R, hi = R, flo = await f(lo);
    const fhi = await f(hi);
    if ((flo - target) * (fhi - target) > 0) target = -target;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2, fm = await f(mid);
      if ((fm - target) * (flo - target) <= 0) hi = mid;
      else { lo = mid; flo = fm; }
    }
    return lineFor(deg, (lo + hi) / 2);
  }

  /** 本物と同じ入口でスワイプする（少し弧を描く指の軌跡。切断は始点と終点の直線） */
  async function swipe(deg, target, dur = 0.3) {
    const [x0, y0, x1, y1] = await findCut(deg, target);
    const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny);
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6, b = Math.sin(Math.PI * u) * 10;
      pts.push([x0 + (x1 - x0) * u + (nx / nl) * b, y0 + (y1 - y0) * u + (ny / nl) * b]);
    }
    await p.drag(pts, dur);
  }

  /** 回転パッドを、円を描くようにドラッグする */
  async function padDrag(dur, rx = 52, ry = 30) {
    const n = Math.round(dur * 30);
    let px = 0, py = 0;
    for (let i = 1; i <= n; i++) {
      const u = i / n, env = Math.sin(Math.PI * u);
      const kx = rx * Math.sin(u * Math.PI * 2) * env, ky = ry * Math.sin(u * Math.PI * 1.3) * env;
      await p.call('pad', kx - px, ky - py, kx, ky);
      px = kx;
      py = ky;
      await p.wait(1 / 30);
    }
    await p.call('padRelease');
  }

  /** ステージを読み込み、登場アニメーションを撮らずに終わらせる */
  async function load(stage) {
    await p.call('goStage', stage);
    await p.skip(0.8);
  }

  // 切った瞬間の演出（何を出すかは場面ごとに slashFx を差し替える）
  let slashFx = () => {};
  p.on('slash', () => slashFx());
  let resultFx = () => {};
  p.on('result', (e) => resultFx(e));

  await p.call('start');
  await p.skip(0.5);

  // 0〜2.6秒 つかみ：ナスを一刀。断面が光って、ぴったり半分
  await load(0);
  p.caption('この一刀で…', { y: 0.16, dur: 1.0, size: 54 });
  await p.wait(0.3);
  slashFx = () => {
    p.flash({ strength: 0.95 });
    p.shake(14, 0.4);
    p.zoom(1.12, 0.25, { x: 0.47, y: 0.45 });
    p.fx('スパッ!!', { x: 0.42, y: 0.32, size: 96, rot: -10, dur: 1.0 });
  };
  await swipe(-62, 0.12, 0.3);
  p.speed(0.5, { badge: false });
  await p.wait(0.5);
  p.speed(1);
  p.zoom(1, 0.4);
  p.caption('ナスを\nまるごと', { y: 0.16, dur: 0.9, size: 50, color: GREEN });
  await p.wait(0.9);
  resultFx = () => {};
  await p.until((s) => s === 'result', { max: 2 });
  p.flash({ strength: 0.4 });
  p.caption('ぴったり半分こ!!', { y: 0.16, dur: 0.9, size: 60, color: YELLOW });
  await p.wait(0.9);
  // 2.6〜5.6秒 タイトル
  await load(3);
  p.flash({ strength: 1 });
  p.title({ title: 'ひと切り半分こ\n〜野菜編〜', sub: '野菜の体積を\n50:50 に切り分けろ！', dur: 2.9 });
  await p.wait(3.0);
  // 5.6〜8秒 回して観察（キャベツ）
  p.caption('ぐるっと回して\nよ〜く見る', { y: 0.16, dur: 2.2 });
  await padDrag(1.9);
  await p.wait(0.3);

  // 8〜11秒 外から外へスワイプ → 惜しい失敗
  p.caption('外から外へ\nスワイプ！', { y: 0.16, dur: 1.2 });
  slashFx = () => {
    p.flash({ strength: 0.8 });
    p.shake(8, 0.25);
    p.fx('ザクッ!', { x: 0.62, y: 0.33, size: 80, rot: 8 });
  };
  await swipe(-8, 2.6, 0.3);
  resultFx = (e) => {
    p.caption('おしい！\n1%ズレたら失敗…', { y: 0.16, dur: 1.3, color: PINK, size: 44 });
    p.fx('ガーン', { x: 0.3, y: 0.52, size: 64, rot: -6, color: '#c9d3dc', stroke: '#222', dur: 1.1 });
  };
  await p.until((s) => s === 'result', { max: 2 });
  await p.wait(1.3);

  // 11〜14秒 もう一度 → 成功
  await p.call('retry');
  await p.skip(0.3);
  p.caption('もう一度！', { y: 0.16, dur: 0.8 });
  await p.wait(0.5);
  slashFx = () => {
    p.flash({ strength: 0.9 });
    p.shake(10, 0.3);
    p.fx('ズバッ!!', { x: 0.4, y: 0.32, size: 88, rot: -8, color: '#9fe0ff', stroke: '#06213a' });
  };
  await swipe(-14, 0.15, 0.3);
  resultFx = (e) => {
    p.caption('誤差1%以内で\n成功！', { y: 0.16, dur: 1.4, color: YELLOW });
    p.fx('やった!', { x: 0.66, y: 0.55, size: 64, rot: 10, dur: 1.2 });
  };
  await p.until((s) => s === 'result', { max: 2 });
  await p.wait(1.4);
  // 14〜22秒 早送りで次々と
  p.caption('10種類の野菜に挑戦！', { y: 0.15, dur: 7.6, color: GREEN, size: 40 });
  p.speed(2);
  resultFx = () => {};
  const montage = [
    [1, 'かぼちゃ!', 25, 0.15],
    [4, 'ピーマン!', -70, 0.12],
    [5, '玉ねぎ!', 12, 0.18],
    [7, 'とうもろこし!', -80, 0.15],
    [8, '大根!', 70, 0.15],
  ];
  for (const [k, [stage, name, deg, target]] of montage.entries()) {
    await load(stage);
    await p.wait(0.15);
    slashFx = () => {
      p.flash({ strength: 0.7 });
      p.shake(7, 0.22);
      p.fx(name, { x: k % 2 ? 0.58 : 0.38, y: k % 2 ? 0.46 : 0.4, size: 70, rot: k % 2 ? 8 : -8, color: k % 2 ? '#9fe0ff' : '#ffe14d', dur: 0.95 });
    };
    await swipe(deg, target, 0.22);
    await p.wait(1.15);
  }
  p.speed(1);
  // 22〜26.5秒 クライマックス：ブロッコリーをスローで
  await load(9);
  p.caption('最後は…\nブロッコリー！', { y: 0.16, dur: 1.1, color: GREEN });
  await p.wait(0.9);
  slashFx = () => {
    p.speed(0.3);
    p.zoom(1.15, 0.2, { x: 0.47, y: 0.45 });
    p.flash({ strength: 1 });
    p.shake(16, 0.5);
    p.fx('ズバァン!!', { x: 0.45, y: 0.3, size: 100, rot: -10, dur: 1.4 });
  };
  await swipe(-35, 0.1, 0.3);
  await p.wait(0.9);
  p.speed(1);
  p.zoom(1, 0.4);
  resultFx = () => {
    p.flash({ strength: 0.5 });
    p.caption('全10種類\nぴったり制覇!!', { y: 0.16, dur: 1.6, size: 56, color: YELLOW });
  };
  await p.until((s) => s === 'result', { max: 3 });
  await p.wait(1.5);
  // 26.5〜30秒 エンドカード
  p.endCard({ title: 'ひと切り半分こ\n〜野菜編〜', sub: 'スマホでもPCでも', cta: '今すぐ遊べる！', dur: 3.4 });
  await p.wait(3.4);
}
