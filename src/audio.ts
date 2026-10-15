// 効果音はすべて Web Audio API で合成する（音声ファイルの読み込みなし）。
// AudioContext は最初のユーザー操作で作る。使えない環境でもゲームは止めない。
import { CONFIG } from './config';
import type { Sound } from './vegetables/common';

const MUTE_KEY = 'hanbunko-muted';

/** 告知動画用に記録した効果音（時刻は秒） */
export interface SfxEvent {
  name: string;
  args: unknown[];
  t: number;
}

export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private swipe: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  muted = false;
  failed = false;
  /** 記録中は、鳴らした効果音を時刻つきで残す（告知動画の音声を後で書き出すため） */
  private recClock: (() => number) | null = null;
  events: SfxEvent[] = [];
  /** 書き出し中は、各効果音をこの時刻に鳴らす */
  private tOverride: number | null = null;

  startRecording(clock: () => number): void {
    this.events = [];
    this.recClock = clock;
  }

  stopRecording(): void {
    this.recClock = null;
  }

  private rec(name: string, args: unknown[] = []): void {
    if (this.recClock && this.tOverride === null) this.events.push({ name, args, t: this.recClock() });
  }

  private now(): number {
    return this.tOverride ?? this.ctx?.currentTime ?? 0;
  }

  /** 書き出し先の AudioContext ごとの出力（こすれる音は呼び出しをまたいで続くので保持する） */
  private offline: { ctx: BaseAudioContext; master: GainNode; noise: AudioBuffer; swipe: Sfx['swipe'] } | null = null;

  /** 記録した効果音を 1 つ、別の AudioContext（OfflineAudioContext など）の時刻 when に同じ合成方法で鳴らす */
  renderAt(ctx: BaseAudioContext, name: string, args: unknown[], when: number, out: AudioNode = ctx.destination): void {
    if (this.offline?.ctx !== ctx) {
      const master = ctx.createGain();
      master.gain.value = CONFIG.audio.masterVolume;
      master.connect(out);
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.offline = { ctx, master, noise, swipe: null };
    }
    const o = this.offline;
    const saved = { ctx: this.ctx, master: this.master, noise: this.noise, muted: this.muted, swipe: this.swipe };
    Object.assign(this, { ctx: o.ctx, master: o.master, noise: o.noise, muted: false, swipe: o.swipe });
    this.tOverride = when;
    try {
      (this as unknown as Record<string, (...a: unknown[]) => void>)[name]?.(...args);
    } finally {
      o.swipe = this.swipe;
      this.tOverride = null;
      Object.assign(this, saved);
    }
  }

  /** 記録した効果音をまとめて鳴らし直す */
  replay(ctx: BaseAudioContext, out: AudioNode, events: SfxEvent[]): void {
    this.offline = null;
    for (const e of events) this.renderAt(ctx, e.name, e.args, e.t, out);
    this.offline = null;
  }

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* ストレージが使えなくても続行 */
    }
  }

  /** ユーザー操作の中で呼ぶ */
  unlock(): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : CONFIG.audio.masterVolume;
        // 鋭い音が割れないように軽く圧縮
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 4;
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void (this.ctx as AudioContext).resume().catch(() => {});
    } catch (e) {
      console.warn('[audio] disabled:', e);
      this.failed = true;
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* noop */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : CONFIG.audio.masterVolume, this.now(), 0.02);
  }

  private safe(fn: (ctx: BaseAudioContext, out: GainNode) => void): void {
    if (!this.ctx || !this.master || this.muted) return;
    try {
      fn(this.ctx, this.master);
    } catch (e) {
      console.warn('[audio]', e);
    }
  }

  private tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, freq: number, t0: number, dur: number, vol: number, endFreq?: number): void {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(ctx: BaseAudioContext, out: AudioNode, t0: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1): void {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.02);
  }

  swipeStart(): void {
    this.rec('swipeStart', []);
    this.safe((ctx, out) => {
      this.swipeStop();
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 2.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(out);
      src.start(this.now());
      this.swipe = { src, filter, gain };
    });
  }

  /** speed: CSS px / 秒 */
  swipeMove(speed: number): void {
    this.rec('swipeMove', [speed]);
    if (!this.swipe || !this.ctx) return;
    const k = Math.min(1, speed / 2500);
    const t = this.now();
    this.swipe.filter.frequency.setTargetAtTime(900 + 4200 * k, t, 0.03);
    this.swipe.gain.gain.setTargetAtTime(0.22 * k, t, 0.03);
  }

  swipeStop(): void {
    this.rec('swipeStop', []);
    if (!this.swipe || !this.ctx) return;
    const s = this.swipe;
    this.swipe = null;
    try {
      s.gain.gain.setTargetAtTime(0, this.now(), 0.02);
      s.src.stop(this.now() + 0.15);
    } catch {
      /* noop */
    }
  }

  /** 「シャキン」＋野菜ごとの手応え（シャキッ・サクッ・ザクッ） */
  cut(kind: Sound): void {
    this.rec('cut', [kind]);
    this.safe((ctx, out) => {
      const t = this.now() + 0.005;
      // シャッ（高域ノイズ）
      this.burst(ctx, out, t, 0.16, 0.55, 'highpass', 5200, 0.7);
      // キン（金属的な非整数倍音）
      const base = 2350;
      [1, 1.47, 2.09, 2.76, 3.93].forEach((r, i) => this.tone(ctx, out, 'sine', base * r, t + 0.01, 0.55 - i * 0.08, 0.16 / (1 + i * 0.5)));
      // 魔法っぽい上昇音
      this.tone(ctx, out, 'triangle', 1800, t, 0.3, 0.06, 5200);
      // 果肉の手応え
      const body = ctx.createGain();
      body.gain.value = 1;
      body.connect(out);
      if (kind === 'crisp') {
        this.burst(ctx, body, t + 0.02, 0.09, 0.7, 'bandpass', 2100, 1.4);
        this.tone(ctx, body, 'sine', 220, t + 0.02, 0.09, 0.35, 120);
      } else if (kind === 'soft') {
        this.burst(ctx, body, t + 0.02, 0.12, 0.5, 'bandpass', 1300, 1.0);
        this.tone(ctx, body, 'sine', 180, t + 0.02, 0.1, 0.3, 90);
      } else if (kind === 'juicy') {
        this.burst(ctx, body, t + 0.02, 0.18, 0.75, 'bandpass', 900, 0.9);
        this.burst(ctx, body, t + 0.07, 0.22, 0.25, 'lowpass', 2400, 0.7);
        this.tone(ctx, body, 'sine', 150, t + 0.02, 0.16, 0.45, 70);
      } else if (kind === 'hard') {
        // 固い身に刃が入る「ザクン」
        this.burst(ctx, body, t + 0.02, 0.16, 0.8, 'lowpass', 1500, 0.8);
        this.burst(ctx, body, t + 0.03, 0.06, 0.5, 'bandpass', 3000, 2);
        this.tone(ctx, body, 'sine', 120, t + 0.02, 0.2, 0.5, 55);
      } else {
        // 重なった葉を切る「ザクザク」
        for (let i = 0; i < 7; i++) this.burst(ctx, body, t + 0.02 + i * 0.016 + Math.random() * 0.01, 0.035, 0.45, 'bandpass', 2400 + Math.random() * 1400, 3);
        this.tone(ctx, body, 'sine', 300, t + 0.02, 0.08, 0.2, 160);
      }
    });
  }

  success(): void {
    this.rec('success', []);
    this.safe((ctx, out) => {
      const t = this.now() + 0.02;
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        this.tone(ctx, out, 'triangle', f, t + i * 0.075, 0.55, 0.16);
        this.tone(ctx, out, 'sine', f * 2, t + i * 0.075, 0.3, 0.04);
      });
      for (let i = 0; i < 8; i++) this.tone(ctx, out, 'sine', 3000 + Math.random() * 3000, t + 0.3 + i * 0.05, 0.12, 0.035);
    });
  }

  fail(): void {
    this.rec('fail', []);
    this.safe((ctx, out) => {
      const t = this.now() + 0.02;
      this.tone(ctx, out, 'triangle', 392, t, 0.22, 0.16);
      this.tone(ctx, out, 'triangle', 311, t + 0.18, 0.35, 0.14);
    });
  }

  reject(): void {
    this.rec('reject', []);
    this.safe((ctx, out) => {
      const t = this.now();
      this.tone(ctx, out, 'sine', 420, t, 0.12, 0.08, 260);
    });
  }

  click(): void {
    this.rec('click', []);
    this.safe((ctx, out) => this.tone(ctx, out, 'sine', 1400, this.now(), 0.06, 0.08, 900));
  }

  appear(): void {
    this.rec('appear', []);
    this.safe((ctx, out) => {
      const t = this.now();
      this.tone(ctx, out, 'sine', 660, t, 0.18, 0.08, 1320);
      this.tone(ctx, out, 'triangle', 990, t + 0.06, 0.2, 0.05);
    });
  }

  fanfare(): void {
    this.rec('fanfare', []);
    this.safe((ctx, out) => {
      const t = this.now() + 0.02;
      const seq: [number, number, number][] = [
        [784, 0, 0.18], [784, 0.16, 0.12], [784, 0.28, 0.12], [1046.5, 0.42, 0.7],
        [1318.5, 0.42, 0.7], [1568, 0.42, 0.7], [2093, 0.62, 0.6],
      ];
      for (const [f, d, l] of seq) this.tone(ctx, out, 'triangle', f, t + d, l, 0.12);
      for (let i = 0; i < 14; i++) this.tone(ctx, out, 'sine', 2500 + Math.random() * 4000, t + 0.6 + i * 0.06, 0.15, 0.03);
    });
  }
}
