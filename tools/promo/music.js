// 告知動画の BGM（Web Audio で合成。外部の音源は使わない）。stage.js から読み込まれ、OfflineAudioContext に書き出す。
// 明るいポップ: ハ長調の C → G → Am → F、132 BPM。木琴のようなメロディ、跳ねるオクターブのベース、裏拍のコード、手拍子。
// 場面の切り替わり（秒）は scenario.js の流れに合わせる（config.music.marks）。

const BPM = 132;
const BEAT = 60 / BPM;
const E8 = BEAT / 2;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// コード（ルートの MIDI 番号と構成音）
const CHORDS = [
  { root: 36, notes: [60, 64, 67] }, // C
  { root: 43, notes: [59, 62, 67] }, // G
  { root: 45, notes: [60, 64, 69] }, // Am
  { root: 41, notes: [60, 65, 69] }, // F
];
// 1 小節 8 つの 8 分音符。null は休み
const MELODY = [
  [76, null, 79, 76, 84, null, 79, null],
  [74, null, 79, 74, 83, null, 79, null],
  [72, null, 76, 81, 79, null, 76, null],
  [77, null, 81, 84, 86, 84, 81, 79],
];

export default function music(ctx, out, duration, opt = {}) {
  const m = { hook: 0.63, title: 3.07, demo: 6.07, montage: 14.73, build: 22.57, climax: 23.77, end: 27.2, ...opt.marks };
  // 拍の格子は、つかみの一刀（hook）が小節の頭になるように置く
  const t0 = m.hook - Math.ceil(m.hook / (BEAT * 4)) * BEAT * 4;

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  let seed = 98765;
  for (let i = 0; i < nd.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    nd[i] = seed / 2147483648 - 1;
  }

  // 少しだけ広がる残響（短いディレイ 2 本）
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  for (const [d, pan] of [[0.17, -0.6], [0.26, 0.6]]) {
    const dl = ctx.createDelay(1);
    dl.delayTime.value = d;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    wet.connect(dl).connect(lp).connect(fb).connect(dl);
    lp.connect(p).connect(out);
  }

  const env = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const tone = (type, f, t, d, peak, { to = out, send = 0, pan = 0, f2 } = {}) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    p.pan.value = pan;
    env(g, t, 0.004, peak, d);
    o.connect(g).connect(p).connect(to);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(wet);
    }
    o.start(t);
    o.stop(t + d + 0.05);
  };
  const nz = (t, d, peak, type, f, q = 0.8, pan = 0) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = noise;
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    p.pan.value = pan;
    env(g, t, 0.002, peak, d);
    s.connect(fl).connect(g).connect(p).connect(out);
    s.start(t, (t * 7.3) % 0.7);
    s.stop(t + d + 0.05);
  };

  const kick = (t, v = 1) => tone('sine', 160, t, 0.22, 0.85 * v, { f2: 48 });
  const clap = (t) => {
    for (const k of [0, 0.011, 0.023]) nz(t + k, 0.09, 0.32, 'bandpass', 1500, 1.2);
    nz(t + 0.03, 0.16, 0.18, 'bandpass', 1200, 0.9);
  };
  const hat = (t, v = 0.12, pan = 0.25) => nz(t, 0.035, v, 'highpass', 8000, 0.7, pan);
  const shaker = (t, v) => nz(t, 0.05, v, 'bandpass', 6500, 1.5, -0.3);
  const crash = (t) => nz(t, 1.5, 0.28, 'highpass', 4000);
  const snare = (t, v = 0.3) => {
    nz(t, 0.12, v, 'bandpass', 2200, 0.8);
    tone('triangle', 220, t, 0.06, v * 0.6);
  };
  // 跳ねるベース（矩形波を丸めたもの）
  const bass = (t, n, d = E8 * 0.85) => {
    const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = midi(n);
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(1400, t);
    fl.frequency.exponentialRampToValueAtTime(380, t + d);
    env(g, t, 0.005, 0.2, d);
    o.connect(fl).connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.05);
  };
  // 裏拍のコード（短く切ったプラック）
  const stab = (t, notes, v = 0.045) => notes.forEach((n, i) => tone('square', midi(n), t, 0.11, v, { send: 0.3, pan: (i - 1) * 0.35 }));
  // 木琴・ベルのようなメロディ（基音 + 4 倍音）
  const bell = (t, n, v = 0.16, d = 0.32) => {
    tone('sine', midi(n), t, d, v, { send: 0.6, pan: 0.1 });
    tone('sine', midi(n) * 4, t, d * 0.25, v * 0.25, { send: 0.4, pan: 0.1 });
    tone('triangle', midi(n + 12), t, d * 0.4, v * 0.18, { pan: -0.2 });
  };
  const pad = (t, d, notes, v = 0.03) =>
    notes.forEach((n) => {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        fl.type = 'lowpass';
        fl.frequency.value = 2200;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v, t + 0.2);
        g.gain.setValueAtTime(v, Math.max(t + 0.2, t + d - 0.4));
        g.gain.linearRampToValueAtTime(0.0001, t + d);
        o.connect(fl).connect(g).connect(out);
        o.start(t);
        o.stop(t + d + 0.05);
      }
    });
  const riser = (a, b) => {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    s.loop = true;
    fl.type = 'bandpass';
    fl.Q.value = 2;
    fl.frequency.setValueAtTime(400, a);
    fl.frequency.exponentialRampToValueAtTime(8000, b);
    g.gain.setValueAtTime(0.0001, a);
    g.gain.exponentialRampToValueAtTime(0.3, b);
    s.connect(fl).connect(g).connect(out);
    s.start(a);
    s.stop(b + 0.02);
  };

  const section = (t) =>
    t < m.hook ? 'intro' : t < m.title ? 'full' : t < m.demo ? 'title' : t < m.montage ? 'groove' : t < m.build ? 'full' : t < m.climax ? 'build' : t < m.end ? 'full' : 'end';

  for (let i = 0; ; i++) {
    const t = t0 + i * E8;
    if (t >= Math.min(duration, m.end)) break;
    if (t < 0) continue;
    const sec = section(t);
    const step = i % 8; // 小節の中の 8 分音符
    const bar = Math.floor(i / 8) % 4;
    const ch = CHORDS[bar];
    const onBeat = step % 2 === 0;
    const beatNo = step / 2;

    if (sec === 'intro') {
      // 一刀の前：手拍子の連打で期待させる
      if (onBeat) clap(t);
      continue;
    }
    if (sec === 'build') {
      // クライマックス前：スネアの連打（だんだん細かく）とルートの連打
      const k = (t - m.build) / (m.climax - m.build);
      snare(t, 0.15 + 0.2 * k);
      if (k > 0.5) snare(t + E8 / 2, 0.15 + 0.2 * k);
      if (onBeat) bass(t, 36, E8 * 0.5);
      continue;
    }
    if (sec === 'title') {
      // タイトル：キックを減らし、メロディとコードを聞かせる
      if (step === 0) pad(t, BEAT * 4, ch.notes, 0.04);
      const n = MELODY[bar][step];
      if (n) bell(t, n, 0.2);
      if (onBeat) shaker(t, 0.06);
      if (!onBeat) hat(t, 0.08);
      if (beatNo === 1 || beatNo === 3) clap(t);
      if (step === 0 || step === 4) bass(t, ch.root, BEAT * 0.9);
      if (step === 0) kick(t, 0.7);
      continue;
    }

    // groove / full
    if (onBeat) kick(t);
    if (beatNo === 1 || beatNo === 3) clap(t);
    if (!onBeat) hat(t, 0.13);
    shaker(t + E8 / 2, 0.035);
    bass(t, ch.root + (onBeat ? 0 : 12));
    if (!onBeat) stab(t, ch.notes, sec === 'full' ? 0.04 : 0.035);
    if (sec === 'full') {
      const n = MELODY[bar][step];
      if (n) bell(t, n, 0.15);
    }
  }

  // 場面の頭のアクセント
  for (const t of [m.hook, m.title, m.montage, m.climax, m.end]) crash(t);
  kick(m.hook, 1.2);
  kick(m.climax, 1.2);
  riser(m.build, m.climax);

  // エンドカード：明るい終止（C の和音と、駆け上がるベル）
  const e = m.end;
  pad(e, Math.max(0.5, duration - e), [60, 64, 67, 72], 0.035);
  bass(e, 36, 1.2);
  [72, 76, 79, 84, 88].forEach((n, k) => bell(e + k * E8 * 0.5, n, 0.15, 0.5));
  clap(e + BEAT * 2);
  [84, 88, 91].forEach((n) => bell(e + BEAT * 2, n, 0.1, 1.2));
}
