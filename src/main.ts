import './style.css';
import { Color, Euler, Plane, Quaternion, Vector3 } from 'three';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { VEGETABLES } from './vegetables';
import { VegAssets, VegObject, type CutOutcome } from './game/vegetableObject';
import { judgeVolumes, type Judgement } from './judge';
import { Particles, Ribbon, RingFx, type RibbonPoint } from './render/fx';
import { View } from './render/view';
import { worldVolumeCheck } from './game/verify';

type State = 'title' | 'aim' | 'cutting' | 'result' | 'clear';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stageEl = $('stage');
const canvas = $<HTMLCanvasElement>('gl');
const padEl = $('pad');
const knobEl = $('pad-knob');
const resetBtn = $<HTMLButtonElement>('reset-btn');
const muteBtn = $('mute-btn');
const hintEl = $('hint');
const toastEl = $('toast');
const bannerEl = $('banner');
const labelA = $('label-a');
const labelB = $('label-b');
const card = $('result-card');
const nextBtn = $<HTMLButtonElement>('next-btn');
const retryBtn = $<HTMLButtonElement>('retry-btn');

/** デバッグモード（URL に ?debug を付ける）。失敗しても必ず次の野菜へ進める */
const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) {
  const badge = document.createElement('div');
  badge.id = 'debug-badge';
  badge.textContent = 'DEBUG';
  $('stage-label').after(badge);
}

const sfx = new Sfx();
muteBtn.classList.toggle('muted', sfx.muted);
$('veg-count').textContent = String(VEGETABLES.length);
$('clear-count').textContent = String(VEGETABLES.length);
$('howto-thr').textContent = `50:50 ±${CONFIG.judge.thresholdPercent.toFixed(CONFIG.judge.displayDecimals)}%`;

let view: View;
try {
  view = new View(canvas, stageEl);
} catch (e) {
  console.error(e);
  $('title-screen').hidden = true;
  $('error-screen').hidden = false;
  throw e;
}

const particles = new Particles(CONFIG.fx.maxParticles);
view.scene.add(particles.points);
const trail = new Ribbon(48, new Color(5, 5, 5.5), new Color(0.4, 1.6, 2.4));
const guide = new Ribbon(2, new Color(0.5, 0.6, 0.7), new Color(0.1, 0.3, 0.4), true);
const slash = new Ribbon(2, new Color(6, 6, 6), new Color(1.2, 2.2, 3.6));
view.scene.add(trail.mesh, guide.mesh, slash.mesh);
const rings = [new RingFx(), new RingFx(), new RingFx()];
for (const r of rings) view.scene.add(r.mesh);

// ---------------- 状態 ----------------
let state: State = 'title';
let stageIndex = 0;
let veg: VegObject | null = null;
const assetsCache = new Map<number, VegAssets>();
const stats = VEGETABLES.map(() => ({ tries: 0, best: Infinity, cleared: false }));
let timeScale = 1;
/** 1コマずつ進める撮影モード（告知動画用）。このとき時刻は仮想時計で進む */
let manual = false;
let vclock = 0;
const nowMs = () => (manual ? vclock * 1000 : performance.now());
/** ゲーム内時間で動くタイマー（撮影モードでも同じように進む） */
const timers: { at: number; fn: () => void }[] = [];
let gameTime = 0;
function after(sec: number, fn: () => void): void {
  timers.push({ at: gameTime + sec, fn });
}
let appearT = Infinity;
let resetAnim: { from: Quaternion; t: number } | null = null;

interface CutRun {
  outcome: CutOutcome;
  judgement: Judgement;
  /** 画面左（または上）のかけら = 0 or 1 */
  first: 0 | 1;
  t: number;
  burstDone: boolean;
  resultShown: boolean;
  S: { x: number; y: number };
  E: { x: number; y: number };
  glow: Color;
}
let run: CutRun | null = null;
let pendingCut: { S: { x: number; y: number }; E: { x: number; y: number }; frames: number } | null = null;
let slashT = Infinity;
let slashPts: { S: { x: number; y: number }; E: { x: number; y: number } } | null = null;

// 告知動画の撮影では Math.random を固定するので、呼ぶたびに参照する
const rnd = () => Math.random();
/** 告知動画の台本に知らせる出来事（__game.drainEvents で取り出す） */
let promoEvents: { type: string; [k: string]: unknown }[] = [];
const emit = (type: string, data: Record<string, unknown> = {}) => {
  if (manual) promoEvents.push({ type, ...data });
};

// ---------------- ステージ ----------------
function getAssets(i: number): VegAssets {
  let a = assetsCache.get(i);
  if (!a) {
    a = new VegAssets(VEGETABLES[i]);
    assetsCache.set(i, a);
  }
  return a;
}

function clearVeg(): void {
  if (!veg) return;
  view.scene.remove(veg.root);
  if (veg.outcome) for (const p of veg.outcome.pieces) view.scene.remove(p.group);
  veg.dispose();
  veg = null;
}

/** pose を渡すと、その姿勢で表示する（再挑戦では切ったときの角度を引き継ぐ） */
function loadStage(i: number, pose?: Quaternion): void {
  clearVeg();
  run = null;
  pendingCut = null;
  stageIndex = i;
  veg = new VegObject(getAssets(i));
  if (pose) veg.root.quaternion.copy(pose);
  view.scene.add(veg.root);
  // 次のステージを先に用意しておく（形状生成の待ち時間を隠す）
  if (i + 1 < VEGETABLES.length) setTimeout(() => getAssets(i + 1), 400);
  appearT = 0;
  view.distanceScale = 1;
  view.updateCamera();
  view.flashLight.intensity = 0;
  state = 'aim';
  card.hidden = true;
  bannerEl.classList.remove('show');
  labelA.classList.remove('show');
  labelB.classList.remove('show');
  padEl.classList.remove('disabled');
  resetBtn.disabled = false;
  hintEl.classList.remove('hide');
  updateHud();
  sfx.appear();
}

function updateHud(): void {
  $('stage-label').textContent = `STAGE ${stageIndex + 1} / ${VEGETABLES.length}`;
  $('veg-name').textContent = VEGETABLES[stageIndex].name;
  const prog = $('progress');
  prog.innerHTML = '';
  VEGETABLES.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'dot' + (stats[i].cleared ? ' done' : '') + (i === stageIndex && state !== 'clear' ? ' current' : '');
    prog.appendChild(d);
  });
}

let toastTimer = 0;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 1600);
}

function banner(text: string, color = '#fff7d6'): void {
  bannerEl.textContent = text;
  bannerEl.style.color = color;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
}
bannerEl.addEventListener('animationend', () => bannerEl.classList.remove('show'));

// ---------------- 切断 ----------------
type Pt = { x: number; y: number };

/** スワイプが切断として有効か */
function validateSwipe(S: Pt, E: Pt): 'ok' | 'short' | 'inside' | 'miss' {
  if (!veg) return 'miss';
  const len = Math.hypot(E.x - S.x, E.y - S.y);
  const minLen = Math.max(CONFIG.input.minSwipePx, Math.min(view.width, view.height) * CONFIG.input.minSwipeFraction);
  if (len < minLen) return 'short';
  const sil = veg.silhouette(view);
  const at = (p: Pt) => {
    const gx = Math.floor(p.x / sil.cell), gy = Math.floor(p.y / sil.cell);
    if (gx < 0 || gy < 0 || gx >= sil.gw || gy >= sil.gh) return 0;
    return sil.grid[gy * sil.gw + gx];
  };
  if (at(S) || at(E)) return 'inside';
  const steps = Math.ceil(len / (sil.cell * 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (at({ x: S.x + (E.x - S.x) * t, y: S.y + (E.y - S.y) * t })) return 'ok';
  }
  return 'miss';
}

/** 始点と終点を結ぶ直線を、カメラの奥行き方向へ伸ばした平面 */
function planeFromSwipe(S: Pt, E: Pt): Plane {
  const cam = view.camera.position.clone();
  const a = cam.clone().add(view.rayDir(S.x, S.y));
  const b = cam.clone().add(view.rayDir(E.x, E.y));
  return new Plane().setFromCoplanarPoints(cam, a, b);
}

/** スワイプ（またはテスト）から切断を試みる。有効なら true */
function trySwipeCut(S: Pt, E: Pt): boolean {
  if (state !== 'aim' || !veg) return false;
  const v = validateSwipe(S, E);
  if (v !== 'ok') {
    sfx.reject();
    if (v === 'short') toast('もっと長くスワイプしてください');
    else if (v === 'inside') toast('野菜の外から外へ、横切るように切ってください');
    else toast('野菜を横切るようにスワイプしてください');
    return false;
  }
  state = 'cutting';
  resetAnim = null;
  padEl.classList.add('disabled');
  resetBtn.disabled = true;
  hintEl.classList.add('hide');
  sfx.cut(VEGETABLES[stageIndex].sound);
  // 斬撃の直線（画面の外まで伸ばして、まっすぐな切断線であることを見せる）
  const dx = E.x - S.x, dy = E.y - S.y;
  const ext = Math.max(view.width, view.height) / Math.hypot(dx, dy);
  slashPts = { S: { x: S.x - dx * ext, y: S.y - dy * ext }, E: { x: E.x + dx * ext, y: E.y + dy * ext } };
  slashT = 0;
  // 光った画面を 1 フレーム描いてから重い切断処理を行う（それ自体がヒットストップになる）
  pendingCut = { S, E, frames: 0 };
  emit('slash', { stage: stageIndex });
  return true;
}

function doCut(S: Pt, E: Pt): void {
  if (!veg) return;
  const plane = planeFromSwipe(S, E);
  const outcome = veg.cut(plane, view);
  for (const p of outcome.pieces) view.scene.add(p.group);
  // 画面の左（縦切りなら左、横切りなら上）のかけらを A として表示する
  veg.layoutPieces(1, view.camera.position);
  const c0 = view.worldToScreen(veg.pieceWorldCenter(outcome.pieces[0]));
  const c1 = view.worldToScreen(veg.pieceWorldCenter(outcome.pieces[1]));
  veg.layoutPieces(0, view.camera.position);
  const horizontal = Math.abs(c1.x - c0.x) >= Math.abs(c1.y - c0.y);
  const first: 0 | 1 = horizontal ? (c0.x <= c1.x ? 0 : 1) : c0.y <= c1.y ? 0 : 1;
  const volFirst = outcome.pieces[first].volume;
  const judgement = judgeVolumes(volFirst, outcome.totalVolume);
  const st = stats[stageIndex];
  st.tries++;
  st.best = Math.min(st.best, judgement.errorPercent);
  run = {
    outcome,
    judgement,
    first,
    t: 0,
    burstDone: false,
    resultShown: false,
    S,
    E,
    glow: new Color(VEGETABLES[stageIndex].glow),
  };
  view.flashLight.color.copy(run.glow);
  view.flashLight.position.copy(outcome.capCenterWorld);
  emit('cut', { stage: stageIndex, success: judgement.success, a: judgement.displayA, b: judgement.displayB });
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

function updateCut(dt: number): void {
  if (!run || !veg) return;
  const T = CONFIG.timing;
  run.t += dt;
  const t = run.t;
  const sep = easeOut((t - T.hitStop) / T.separate);
  veg.layoutPieces(sep, view.camera.position);
  view.distanceScale = 1 + (CONFIG.fx.cameraPullBack - 1) * sep;
  view.updateCamera();

  // 断面の発光：一瞬で最大 → 少し保持 → 落ち着く
  let g: number;
  if (t < T.hitStop) g = t / T.hitStop;
  else if (t < T.hitStop + T.glowHold) g = 1 + 0.12 * Math.sin(t * 60);
  else g = (1 - Math.min(1, (t - T.hitStop - T.glowHold) / T.glowDecay)) ** 2.2;
  run.outcome.capMaterial.emissiveIntensity = CONFIG.fx.capGlowPeak * g;
  view.flashLight.intensity = 12 * Math.max(0, 1 - t / 0.45) ** 2;

  if (!run.burstDone && t >= T.hitStop) {
    run.burstDone = true;
    spawnCapParticles(CONFIG.fx.capParticles, 1);
  } else if (t < T.hitStop + T.glowHold + T.glowDecay * 0.4) {
    spawnCapParticles(Math.ceil(90 * dt), 0.5);
  }

  if (!run.resultShown && t >= T.resultDelay) {
    run.resultShown = true;
    showResult();
  }
  if (run.resultShown) placeLabels();
}

function spawnCapParticles(n: number, power: number): void {
  if (!run || !veg) return;
  const glow = run.glow;
  const white = new Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const pc = run.outcome.pieces[i % 2];
    const s = veg.sampleCap(pc, rnd);
    if (!s) continue;
    const v = s.n.multiplyScalar((0.4 + rnd() * 1.4) * power).add(new Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(0.5 * power));
    const c = (rnd() < 0.35 ? white : glow).clone().multiplyScalar(2 + rnd() * 3);
    particles.spawn(s.p, v, c, 0.035 + rnd() * 0.08, 0.5 + rnd() * 0.8, -0.35, 2.2);
  }
}

function showResult(): void {
  if (!run) return;
  const j = run.judgement;
  const def = VEGETABLES[stageIndex];
  labelA.innerHTML = `${j.displayA}<small>%</small>`;
  labelB.innerHTML = `${j.displayB}<small>%</small>`;
  labelA.classList.add('show');
  labelB.classList.add('show');
  placeLabels();
  $('ratio-a').textContent = j.displayA;
  $('ratio-b').textContent = j.displayB;
  $('result-error').textContent = `誤差 ${j.errorDisplay}%（±${CONFIG.judge.thresholdPercent.toFixed(CONFIG.judge.displayDecimals)}% 以内で成功）`;
  card.classList.toggle('success', j.success);
  card.classList.toggle('fail', !j.success);
  const last = stageIndex === VEGETABLES.length - 1;
  if (j.success) {
    stats[stageIndex].cleared = true;
    $('result-title').textContent = last ? '全ステージ成功！' : '成功！ ぴったり半分こ';
    nextBtn.textContent = last ? '結果を見る' : '次の野菜へ ▶';
    nextBtn.hidden = false;
    retryBtn.hidden = true;
    banner('成功！');
    sfx.success();
    celebrate(def.palette);
    updateHud();
  } else {
    $('result-title').textContent = j.errorPercent <= 3 ? 'おしい！' : 'ざんねん…';
    // デバッグモードでは、失敗しても次の野菜へ進むボタンを出す（クリア扱いにはしない）
    nextBtn.hidden = !DEBUG;
    nextBtn.textContent = last ? '結果を見る' : '次の野菜へ ▶';
    retryBtn.hidden = false;
    retryBtn.textContent = 'もう一度';
    sfx.fail();
  }
  card.hidden = false;
  emit('result', { stage: stageIndex, success: j.success, a: j.displayA, b: j.displayB, error: j.errorPercent });
  nextBtn.disabled = true;
  retryBtn.disabled = true;
  after(CONFIG.timing.buttonDelay, () => {
    nextBtn.disabled = false;
    retryBtn.disabled = false;
  });
  state = 'result';
}

function celebrate(palette: number[]): void {
  rings.forEach((r, i) => r.start(new Color(palette[i % palette.length]).multiplyScalar(2.2), i * 0.13, 2.2 + i * 0.5));
  const center = new Vector3();
  for (let i = 0; i < CONFIG.fx.celebrateParticles; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const dir = new Vector3(s * Math.cos(a), u, s * Math.sin(a));
    const c = new Color(palette[i % palette.length]).multiplyScalar(1.0 + rnd() * 1.3);
    particles.spawn(center.clone().addScaledVector(dir, 0.6), dir.multiplyScalar(1.6 + rnd() * 2.4), c, 0.05 + rnd() * 0.07, 1.1 + rnd() * 0.9, 1.4, 1.3);
  }
}

function placeLabels(): void {
  if (!run || !veg) return;
  const pcs = run.outcome.pieces;
  const a = view.worldToScreen(veg.pieceWorldCenter(pcs[run.first]));
  const b = view.worldToScreen(veg.pieceWorldCenter(pcs[1 - run.first]));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const r = Math.min(view.width, view.height) * 0.2;
  const place = (el: HTMLElement, p: typeof a) => {
    const d = p.clone().sub(mid);
    if (d.lengthSq() < 1) d.set(-1, 0);
    d.normalize().multiplyScalar(r);
    const x = Math.min(view.width - 50, Math.max(50, p.x + d.x));
    const y = Math.min(view.height - 24, Math.max(24, p.y + d.y));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  place(labelA, a);
  place(labelB, b);
}

// ---------------- スワイプ（野菜の表示領域） ----------------
interface Swipe {
  id: number;
  pts: { x: number; y: number; t: number }[];
  start: Pt;
}
let swipe: Swipe | null = null;
let padDrag: { id: number; x: number; y: number; ox: number; oy: number } | null = null;

const localPt = (e: PointerEvent): Pt => {
  const r = stageEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

function beginSwipe(p: Pt, id: number): boolean {
  if (state !== 'aim' || swipe || padDrag) return false;
  swipe = { id, pts: [{ ...p, t: nowMs() }], start: p };
  sfx.swipeStart();
  return true;
}

function moveSwipe(p: Pt): void {
  if (!swipe) return;
  const now = nowMs();
  const last = swipe.pts[swipe.pts.length - 1];
  const dist = Math.hypot(p.x - last.x, p.y - last.y);
  if (dist < 2) return;
  swipe.pts.push({ ...p, t: now });
  if (swipe.pts.length > 400) swipe.pts.splice(0, swipe.pts.length - 400);
  sfx.swipeMove((dist / Math.max(1, now - last.t)) * 1000);
  // 火花
  const n = Math.min(6, Math.ceil(dist / 10));
  const wp = view.screenToWorld(p.x, p.y, 0.6);
  const dir = view.screenToWorld(last.x, last.y, 0.6).sub(wp).normalize();
  for (let i = 0; i < n; i++) {
    const v = new Vector3(rnd() - 0.5, rnd() - 0.2, rnd() - 0.5).multiplyScalar(2.2).addScaledVector(dir, 0.8);
    const c = rnd() < 0.5 ? new Color(3, 2.6, 1.4) : new Color(1.4, 2.6, 3.2);
    particles.spawn(wp, v, c, 0.025 + rnd() * 0.04, 0.25 + rnd() * 0.3, 3.0, 2.5);
  }
}

function finishSwipe(p: Pt | null): boolean {
  if (!swipe) return false;
  const s = swipe;
  swipe = null;
  sfx.swipeStop();
  guide.hide();
  if (!p) return false;
  // 指を離した瞬間に、始点と終点を結ぶ直線で切断を確定する
  return trySwipeCut(s.start, p);
}

stageEl.addEventListener('pointerdown', (e) => {
  if (manual || !e.isPrimary) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  sfx.unlock();
  if (!beginSwipe(localPt(e), e.pointerId)) return;
  e.preventDefault();
  stageEl.setPointerCapture(e.pointerId);
});

stageEl.addEventListener('pointermove', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  moveSwipe(localPt(e));
});

const endSwipe = (e: PointerEvent, cancel: boolean) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  if (stageEl.hasPointerCapture(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);
  finishSwipe(cancel ? null : localPt(e));
};
stageEl.addEventListener('pointerup', (e) => endSwipe(e, false));
stageEl.addEventListener('pointercancel', (e) => endSwipe(e, true));

// ---------------- 回転パッド ----------------
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);

padEl.addEventListener('pointerdown', (e) => {
  if (manual || state !== 'aim' || padDrag || swipe) return;
  e.preventDefault();
  sfx.unlock();
  padEl.setPointerCapture(e.pointerId);
  padDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
  padEl.classList.add('active');
  resetAnim = null;
});
padEl.addEventListener('pointermove', (e) => {
  if (!padDrag || e.pointerId !== padDrag.id || !veg) return;
  const dx = e.clientX - padDrag.x, dy = e.clientY - padDrag.y;
  padDrag.x = e.clientX;
  padDrag.y = e.clientY;
  padRotate(dx, dy, e.clientX - padDrag.ox, e.clientY - padDrag.oy);
});

/** パッドのドラッグ量で回し、つまみを指の位置へ動かす（kx, ky はドラッグ開始点からのずれ） */
function padRotate(dx: number, dy: number, kx: number, ky: number): void {
  if (state !== 'aim' || !veg) return;
  const k = CONFIG.input.rotateSensitivity;
  veg.rotateWorld(AXIS_Y, dx * k);
  veg.rotateWorld(AXIS_X, dy * k);
  const r = padEl.clientWidth * 0.3;
  const l = Math.hypot(kx, ky);
  const s = l > r ? r / l : 1;
  knobEl.style.transform = `translate(calc(-50% + ${kx * s}px), calc(-50% + ${ky * s}px))`;
}
const endPad = (e: PointerEvent) => {
  if (!padDrag || e.pointerId !== padDrag.id) return;
  padDrag = null;
  padEl.classList.remove('active');
  knobEl.style.transform = '';
  // 指を離したら回転は止まり、その姿勢を保つ（慣性なし）
};
padEl.addEventListener('pointerup', endPad);
padEl.addEventListener('pointercancel', endPad);

function startReset(): void {
  if (state !== 'aim' || !veg) return;
  sfx.click();
  resetAnim = { from: veg.root.quaternion.clone(), t: 0 };
}
resetBtn.addEventListener('click', () => {
  sfx.unlock();
  startReset();
});

window.addEventListener('keydown', (e) => {
  if (state !== 'aim' || !veg) return;
  const k = CONFIG.input.keyRotateStep;
  if (e.key === 'ArrowLeft') veg.rotateWorld(AXIS_Y, -k);
  else if (e.key === 'ArrowRight') veg.rotateWorld(AXIS_Y, k);
  else if (e.key === 'ArrowUp') veg.rotateWorld(AXIS_X, -k);
  else if (e.key === 'ArrowDown') veg.rotateWorld(AXIS_X, k);
  else if (e.key === 'r' || e.key === 'R') startReset();
  else return;
  e.preventDefault();
});

// ---------------- ボタン ----------------
muteBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.setMuted(!sfx.muted);
  muteBtn.classList.toggle('muted', sfx.muted);
});

$('start-btn').addEventListener('click', () => {
  sfx.unlock();
  sfx.click();
  $('title-screen').hidden = true;
  stats.forEach((s) => Object.assign(s, { tries: 0, best: Infinity, cleared: false }));
  loadStage(0);
});

nextBtn.addEventListener('click', () => {
  if (state !== 'result') return;
  sfx.click();
  if (stageIndex + 1 >= VEGETABLES.length) showClear();
  else loadStage(stageIndex + 1);
});
retryBtn.addEventListener('click', () => {
  if (state !== 'result') return;
  sfx.click();
  // 切る前のオブジェクトの姿勢は切断時のまま残っているので、それを引き継ぐ
  loadStage(stageIndex, veg?.root.quaternion.clone());
});

function showClear(): void {
  state = 'clear';
  card.hidden = true;
  const table = $('clear-table');
  table.innerHTML = '<tr><th>野菜</th><th>挑戦</th><th>成功時の誤差</th></tr>';
  let total = 0;
  VEGETABLES.forEach((f, i) => {
    total += stats[i].tries;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.name}</td><td>${stats[i].tries}回</td><td>${stats[i].best.toFixed(CONFIG.judge.displayDecimals)}%</td>`;
    table.appendChild(tr);
  });
  $('clear-total').textContent = `合計 ${total} 回の挑戦でクリア`;
  $('clear-screen').hidden = false;
  sfx.fanfare();
  updateHud();
}

$('again-btn').addEventListener('click', () => {
  sfx.click();
  $('clear-screen').hidden = true;
  stats.forEach((s) => Object.assign(s, { tries: 0, best: Infinity, cleared: false }));
  loadStage(0);
});

// ---------------- メインループ ----------------
let lastTime = performance.now();
function frame(now: number): void {
  const dtMs = now - lastTime;
  lastTime = now;
  if (!manual) tick(Math.min(0.05, dtMs / 1000), dtMs);
  requestAnimationFrame(frame);
}

/** 1コマ分ゲームを進めて描画する（rawDt は実時間の秒、dtMs は解像度の自動調整用） */
function tick(rawDt: number, dtMs: number): void {
  const dt = rawDt * timeScale;
  gameTime += dt;
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].at <= gameTime) {
      const t = timers.splice(i, 1)[0];
      t.fn();
    }
  }

  if (pendingCut) {
    // 1 フレーム目：光った斬撃だけを描く。2 フレーム目で実際に切る
    if (pendingCut.frames++ >= 1) {
      const { S, E } = pendingCut;
      pendingCut = null;
      doCut(S, E);
    }
  }

  if (veg && state === 'aim') {
    if (appearT < CONFIG.timing.appear) {
      appearT += dt;
      const t = Math.min(1, appearT / CONFIG.timing.appear);
      const s = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // 少し行き過ぎて戻る
      veg.root.scale.setScalar(Math.max(0.01, s) * veg.assets.scale);
    }
    if (resetAnim) {
      resetAnim.t += dt / CONFIG.input.resetDuration;
      const e = easeOut(resetAnim.t);
      veg.root.quaternion.slerpQuaternions(resetAnim.from, veg.initialQuat, e);
      if (resetAnim.t >= 1) resetAnim = null;
    }
  }
  if (run) updateCut(dt);

  // 刃の軌跡
  if (swipe) {
    const tn = nowMs();
    const life = CONFIG.fx.trailLife * 1000;
    const keep = Math.max(0, swipe.pts.length - 6);
    const pts = swipe.pts.filter((p, i) => tn - p.t < life || i >= keep);
    if (pts.length === 1) pts.unshift(pts[0]);
    const n = pts.length;
    const rp: RibbonPoint[] = pts.map((p, i) => {
      const k = n > 1 ? i / (n - 1) : 1;
      return { x: p.x, y: p.y, w: 2 + 9 * k, a: Math.max(0.25 * k, Math.min(1, (1 - (tn - p.t) / life) * 1.4)) };
    });
    trail.set(rp, (x, y) => view.screenToWorld(x, y, 1));
    const cur = swipe.pts[swipe.pts.length - 1];
    guide.set(
      [
        { x: swipe.start.x, y: swipe.start.y, w: 1.4, a: 0.5 },
        { x: cur.x, y: cur.y, w: 1.4, a: 0.5 },
      ],
      (x, y) => view.screenToWorld(x, y, 1),
    );
  } else {
    trail.hide();
  }

  // 確定した直線の斬撃
  if (slashPts && slashT < CONFIG.timing.slashFlash) {
    slashT += dt;
    const t = Math.min(1, slashT / CONFIG.timing.slashFlash);
    const w = 10 * Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * (1 - t) + 1;
    slash.material.uniforms.uIntensity.value = (1 - t) ** 1.5 * 1.3;
    slash.set(
      [
        { ...slashPts.S, w, a: 1 },
        { ...slashPts.E, w, a: 1 },
      ],
      (x, y) => view.screenToWorld(x, y, 1),
    );
  } else {
    slash.hide();
  }

  particles.material.uniforms.uScale.value = view.pointScale;
  particles.update(dt);
  for (const r of rings) r.update(dt);
  view.render(dtMs);
}
requestAnimationFrame(frame);

// タイトル画面の背景として最初の野菜を表示しておく
veg = new VegObject(getAssets(0));
view.scene.add(veg.root);
updateHud();

// ---------------- テスト・検証用フック ----------------
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  get state() {
    return state;
  },
  get stage() {
    return stageIndex;
  },
  get debug() {
    return DEBUG;
  },
  get judgement() {
    return run?.judgement ?? null;
  },
  get size() {
    return { width: view.width, height: view.height };
  },
  start: () => $('start-btn').click(),
  /** 表示領域の CSS px 座標でスワイプしたものとして切る */
  cut: (x0: number, y0: number, x1: number, y1: number) => trySwipeCut({ x: x0, y: y0 }, { x: x1, y: y1 }),
  validate: (x0: number, y0: number, x1: number, y1: number) => validateSwipe({ x: x0, y: y0 }, { x: x1, y: y1 }),
  rotate: (dxPx: number, dyPx: number) => {
    if (!veg) return;
    veg.rotateWorld(AXIS_Y, dxPx * CONFIG.input.rotateSensitivity);
    veg.rotateWorld(AXIS_X, dyPx * CONFIG.input.rotateSensitivity);
  },
  quaternion: () => veg?.root.quaternion.toArray(),
  setEuler: (x: number, y: number, z: number) => veg?.root.quaternion.setFromEuler(new Euler(x, y, z)),
  next: () => nextBtn.click(),
  retry: () => retryBtn.click(),
  goStage: (i: number) => loadStage(i),
  setTimeScale: (k: number) => {
    timeScale = k;
  },
  /** 直近の切断を、独立した計算（ワールド座標で三角形を切り取る）で検算する */
  verify: () => (run && veg ? worldVolumeCheck(veg, run.outcome, run.first, run.S, run.E, view) : null),
  // ---- 告知動画の撮影用 ----
  /** 1コマずつ進める撮影モードに切り替え、効果音の記録を始める */
  manual: (on: boolean) => {
    manual = on;
    vclock = 0;
    if (on) sfx.startRecording(() => vclock);
  },
  /** 撮影モードで dtSec 秒進めて描画する */
  step: (dtSec: number) => {
    vclock += dtSec;
    tick(dtSec, 0);
  },
  /** 表示領域の CSS px 座標で指を置く・動かす・離す（本物のスワイプと同じ処理） */
  touchDown: (x: number, y: number) => beginSwipe({ x, y }, 1),
  touchMove: (x: number, y: number) => moveSwipe({ x, y }),
  touchUp: (x: number, y: number) => finishSwipe({ x, y }),
  /** 回転パッドのドラッグ（dx, dy は今回の移動量、kx, ky はつまみの位置） */
  pad: (dx: number, dy: number, kx: number, ky: number) => {
    padEl.classList.add('active');
    padRotate(dx, dy, kx, ky);
  },
  padRelease: () => {
    padEl.classList.remove('active');
    knobEl.style.transform = '';
  },
  /** 切らずに、その線で切ったときの「片側 % − 50」を返す（符号は線の向きで決まる） */
  preview: (x0: number, y0: number, x1: number, y1: number) => (veg ? veg.previewPercent(planeFromSwipe({ x: x0, y: y0 }, { x: x1, y: y1 })) - 50 : NaN),
  /** 記録した効果音を、渡された AudioContext に鳴らし直す */
  replaySfx: (ctx: BaseAudioContext, out: AudioNode) => sfx.replay(ctx, out, sfx.events),
  sfxEvents: () => sfx.events.length,
  /** 前回から起きた出来事（slash / cut / result）を返して空にする */
  drainEvents: () => promoEvents.splice(0),
  /** 効果音の記録と書き出し（promo-video スキルの約束に合わせた形） */
  audio: {
    capture: (on: boolean) => (on ? sfx.startRecording(() => 0) : sfx.stopRecording()),
    drain: () => sfx.events.splice(0).map(({ name, args }) => ({ name, args })),
    render: (ctx: BaseAudioContext, name: string, args: unknown[], when: number) => sfx.renderAt(ctx, name, args, when),
  },
  /** 切ったかけら同士の最小すき間（正なら完全に分離） */
  separation: () => veg?.separation() ?? null,
  stats: () => stats.map((s) => ({ ...s })),
  config: CONFIG,
};
