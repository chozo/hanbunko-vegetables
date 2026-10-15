import { StarShape, paint, type Vec3 } from '../geometry/mesh';
import { cell3, clamp01, fbm, fibDirs, mix, rng, smooth, type VegDef } from './common';

// ブロッコリー：小房がもこもこと集まった丸い頭（花蕾）と、下へ伸びる太い茎。
// 頭と茎を「中心から見た方向ごとの半径」でひとつの星形の立体にまとめる（なめらかな最大値でつなぐ）。
// 頭は片側へ大きく寄っていて、茎も少し傾くので、茎の付け根で切っても半分にならない。
// 断面は、表面の濃い緑のつぼみの層と、枝分かれする淡い緑の軸。

const r0 = rng(77);
/** 小房の中心方向（上半分に寄せる）と大きさ。こぶは丸いドーム形 */
const FLORETS = fibDirs(70)
  .filter((d) => d[1] > -0.25)
  .map((d) => ({ d, size: 0.27 + 0.08 * r0(), h: 0.15 + 0.06 * r0() }));
/** 小房の上にさらに小さなこぶ（つぼみの集まり）。どの小房に付くかも覚えておく */
const SUBS = fibDirs(420)
  .filter((d) => d[1] > -0.3)
  .map((d) => {
    let best = 0, bc = -2;
    FLORETS.forEach((f, k) => {
      const c = d[0] * f.d[0] + d[1] * f.d[1] + d[2] * f.d[2];
      if (c > bc) { bc = c; best = k; }
    });
    return { d, size: 0.1 + 0.03 * r0(), h: 0.045 + 0.02 * r0(), parent: best };
  });

/** 小房ごとの小さなこぶ（近くの小房のものだけ調べて計算を軽くする） */
const SUBS_OF: (typeof SUBS)[] = FLORETS.map((_, k) => SUBS.filter((f) => f.parent === k));

/** 小房のこぶの高さ（大きなこぶ + 小さなこぶ） */
function floretBump(dx: number, dy: number, dz: number): number {
  let big = 0, small = 0;
  for (let k = 0; k < FLORETS.length; k++) {
    const f = FLORETS[k];
    const c = dx * f.d[0] + dy * f.d[1] + dz * f.d[2];
    if (c < 0.85) continue;
    if (c > 0.9) {
      const a = Math.acos(Math.min(1, c));
      big = Math.max(big, f.h * Math.sqrt(Math.max(0, 1 - (a / f.size) ** 2)));
    }
    for (const g of SUBS_OF[k]) {
      const cs = dx * g.d[0] + dy * g.d[1] + dz * g.d[2];
      if (cs < 0.99) continue;
      const a = Math.acos(Math.min(1, cs));
      small = Math.max(small, g.h * Math.sqrt(Math.max(0, 1 - (a / g.size) ** 2)));
    }
  }
  return big + small;
}

/** 茎：中心から下へ STALK_L まで、半径 STALK_R の円柱（少し傾く） */
const STALK_R = 0.27;
const STALK_L = 1.15;
const TILT: Vec3 = (() => {
  const v: Vec3 = [0.24, -1, 0.08];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

function smax(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (a - b)) / k);
  return b + (a - b) * h + k * h * (1 - h);
}

/** 頭全体のふくらみ：上は丸く、下（茎の側）へ向かってすぼまる。+x 側へ寄る */
function headBase(dx: number, dy: number, dz: number): number {
  const r = 0.62 + 0.38 * smooth(-0.75, 0.15, dy);
  // -x 側の上は低く垂れる（横幅は変えずに、重さだけ +x 側へ寄せる）
  const droop = 1 - 0.3 * Math.max(0, -dx) * Math.max(0, dy) * 2;
  return r * droop * (1 + 0.2 * dx * smooth(-0.5, 0.4, dy) + 0.06 * dz);
}

function headR(dx: number, dy: number, dz: number): number {
  // 小房のこぶ：最も近い小房が丸く盛り上がり、小房の間は深くくびれる
  return headBase(dx, dy, dz) + floretBump(dx, dy, dz) * smooth(-0.5, 0.0, dy);
}

function stalkR(dx: number, dy: number, dz: number): number {
  const c = dx * TILT[0] + dy * TILT[1] + dz * TILT[2];
  if (c <= 0.02) return 0;
  const sn = Math.sqrt(Math.max(1e-9, 1 - c * c));
  return Math.min(STALK_L / c, STALK_R / sn);
}

const shape = new StarShape((dx, dy, dz) => smax(headR(dx, dy, dz), stalkR(dx, dy, dz), 0.12));

/**
 * 断面に描く枝：茎の上端から各小房の中心へ伸びる軸と、そこから小さなこぶへ分かれる小枝。
 * （模様だけで、形には影響しない）
 */
interface Branch { a: Vec3; b: Vec3; ra: number; rb: number }
const STEM_TOP: Vec3 = [TILT[0] * 0.15, TILT[1] * 0.15, TILT[2] * 0.15];
/** 小房ごとに、主の軸 1 本と小枝 */
const BRANCHES: { main: Branch; twigs: Branch[] }[] = FLORETS.map((f, k) => {
  const d = f.d;
  const R = headBase(d[0], d[1], d[2]) * 0.86;
  const c: Vec3 = [d[0] * R, d[1] * R, d[2] * R];
  const m: Vec3 = [STEM_TOP[0] + (c[0] - STEM_TOP[0]) * 0.7, STEM_TOP[1] + (c[1] - STEM_TOP[1]) * 0.7, STEM_TOP[2] + (c[2] - STEM_TOP[2]) * 0.7];
  const twigs = SUBS_OF[k].map((g) => {
    const r = headR(g.d[0], g.d[1], g.d[2]) - 0.09;
    return { a: m, b: [g.d[0] * r, g.d[1] * r, g.d[2] * r] as Vec3, ra: 0.035, rb: 0.022 };
  });
  return { main: { a: STEM_TOP, b: c, ra: 0.11, rb: 0.06 }, twigs };
});

function branchDepth(B: Branch, x: number, y: number, z: number): number {
  const ex = B.b[0] - B.a[0], ey = B.b[1] - B.a[1], ez = B.b[2] - B.a[2];
  const t = Math.max(0, Math.min(1, ((x - B.a[0]) * ex + (y - B.a[1]) * ey + (z - B.a[2]) * ez) / (ex * ex + ey * ey + ez * ez)));
  const d = Math.hypot(x - B.a[0] - ex * t, y - B.a[1] - ey * t, z - B.a[2] - ez * t);
  const r = B.ra + (B.rb - B.ra) * t;
  return d < r ? 1 - d / r : -1;
}

/** 点がどれかの枝の中にあれば、枝の表面からの深さの割合（0..1）、なければ -1 */
function inBranch(x: number, y: number, z: number): number {
  const l = Math.hypot(x, y, z) || 1e-9;
  let best = -1;
  for (let k = 0; k < FLORETS.length; k++) {
    const f = FLORETS[k];
    // 中心の近くは向きが定まらないので主の軸をすべて調べる。外側は近い小房だけ
    if (l > 0.3 && (x * f.d[0] + y * f.d[1] + z * f.d[2]) / l < 0.75) continue;
    const B = BRANCHES[k];
    best = Math.max(best, branchDepth(B.main, x, y, z));
    if (l > 0.3) for (const t of B.twigs) best = Math.max(best, branchDepth(t, x, y, z));
  }
  return best;
}

export const broccoli: VegDef = {
  id: 'broccoli',
  name: 'ブロッコリー',
  skin: {
    roughness: 0.75,
    sheen: 0.4,
    sheenColor: 0x9fc0a0,
    bumpScale: 2.4,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 頭の細かなつぼみの粒（茎には弱く）
        float head = smoothstep(-0.55, -0.3, p.y);
        vec2 w = worley(p * 48.0);
        float bud = 1.0 - smoothstep(0.15, 0.6, w.x);
        vec2 w2 = worley(p * 30.0);
        float cluster = 1.0 - smoothstep(0.3, 0.9, w2.x);
        col *= mix(1.0, 0.7 + 0.45 * bud * (0.7 + 0.3 * cluster), head);
        col = mix(col, col * vec3(0.8, 0.9, 1.1), head * smoothstep(0.5, 0.8, fbm(p * 3.0)) * 0.5);
        bump = head * (bud * 0.8 + cluster * 0.5) + (1.0 - head) * vnoise(p * vec3(8.0, 40.0, 8.0)) * 0.3;
      }`,
  },
  extrasRoughness: 0.6,
  capRoughness: 0.4,
  glow: 0x8cff66,
  palette: [0x4caf3a, 0xa8f07a, 0x1f6a2a, 0xe8ffd0],
  initialRotation: [0.3, -2.2, 0.2],
  sound: 'leafy',
  build(q = 1) {
    const body = shape.build(220 * q, 160 * q);
    paint(body, (p) => {
      const head = smooth(-0.6, -0.25, p[1]);
      const stalk: Vec3 = mix([0.62, 0.74, 0.42], [0.5, 0.66, 0.34], fbm(p[0] * 4, p[1] * 4, p[2] * 4));
      let crown: Vec3 = mix([0.08, 0.24, 0.1], [0.13, 0.32, 0.12], fbm(p[0] * 5 + 2, p[1] * 5, p[2] * 5));
      // 小房のすき間（くびれ）は影になって暗い
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      const lift = (l - headBase(p[0] / l, p[1] / l, p[2] / l)) / 0.2;
      crown = mix(crown, [0.02, 0.07, 0.03], smooth(0.65, 0.1, lift) * 0.9);
      let c = mix(stalk, crown, head);
      c = mix(c, [0.82, 0.86, 0.68], smooth(-1.05, -1.15, p[1]) * 0.8); // 茎の切り口のまわり
      return c;
    });

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const s = shape.depth(x, y, z);
      const l = Math.hypot(x, y, z) || 1e-9;
      const dx = x / l, dy = y / l, dz = z / l;
      const inHead = headR(dx, dy, dz) > stalkR(dx, dy, dz);
      if (inHead && dy > -0.55) {
        // つぼみの層（表面の濃い緑の粒）
        if (s > 0.92) {
          const cb = cell3(x * 48, y * 48, z * 48);
          return mix([0.07, 0.22, 0.08], [0.2, 0.42, 0.16], smooth(0.5, 0.2, cb.d) * (0.6 + 0.4 * cb.id));
        }
        // 茎から小房へ枝分かれする淡い軸。軸のすき間は奥が暗い緑に見える
        const b = inBranch(x, y, z);
        if (b >= 0) {
          let c: Vec3 = mix([0.66, 0.8, 0.46], [0.9, 0.94, 0.74], smooth(0.0, 0.6, b));
          c = mix(c, [0.82, 0.9, 0.64], 0.3 * fbm(x * 30, y * 8, z * 30));
          return c;
        }
        return mix([0.16, 0.3, 0.12], [0.24, 0.38, 0.16], fbm(x * 9, y * 9, z * 9));
      }
      // 茎：外側に繊維質の皮、中は淡い緑白色
      const rr = (() => {
        const c = dx * TILT[0] + dy * TILT[1] + dz * TILT[2];
        const along = l * c;
        const px = x - TILT[0] * along, py = y - TILT[1] * along, pz = z - TILT[2] * along;
        return Math.hypot(px, py, pz) / STALK_R;
      })();
      if (rr > 0.9) return mix([0.62, 0.76, 0.42], [0.48, 0.64, 0.3], smooth(0.9, 1.0, rr));
      let c: Vec3 = mix([0.94, 0.96, 0.82], [0.84, 0.92, 0.64], smooth(0.2, 0.9, rr));
      c = mix(c, [0.78, 0.88, 0.58], Math.exp(-(((rr - 0.72) / 0.03) ** 2)) * 0.6); // 維管束の輪
      return c;
    };
    return { body, extras: null, flesh, extrasCapColor: [0.8, 0.88, 0.6] };
  },
};
