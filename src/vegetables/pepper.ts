import { StarShape, buildTube, computeNormals, mergeMeshes, mul3, paint, rotX3, scale3, type MeshData, type Vec3 } from '../geometry/mesh';
import { asCavity, cell3, fbm, mix, smooth, type VegDef } from './common';

// ピーマン：4 つの山（稜）がある、縦に少し長い形。肩の山は丸く盛り上がり、真ん中は深くくぼんでヘタが沈む。
// 中は空洞で、果肉の壁は薄い。上から白い胎座（種の付くわた）が垂れ下がり、その周りに種が房のように付く。
// 谷の内側には白い隔壁のすじが通る。
// 外側と内側の 2 枚の閉じた面でできていて、内側の面は向きを反転している（体積が引かれる）。
// 胎座は内側の面のくぼみとして作るので、壁・胎座・空洞が重ならず、体積は正確に求まる。
// 1 つの山だけ大きく、底のでこぼこもそろっていないので、真ん中を切っても半分にならない。

/** 4 つの谷の向き（cos(4φ + LOBE) = -1 が谷） */
const LOBE = 0.3;
/** 谷の鋭さ（1 で谷の中心、山では 0） */
const valley = (ph: number, k: number) => (0.5 - 0.5 * Math.cos(4 * ph + LOBE)) ** k;

function outerR(dx: number, dy: number, dz: number): number {
  const th = Math.acos(Math.max(-1, Math.min(1, dy)));
  const ph = Math.atan2(dz, dx);
  const s = Math.sin(th);
  // 角ばった胴（上下が平たい）
  const P = 3.0;
  let r = (Math.abs(s) ** P + Math.abs(dy) ** P) ** (-1 / P);
  // 谷：肩と底で深く、胴の中ほどでは浅い。谷ごとに深さが少し違う
  const shoulder = Math.exp(-(((th - 0.55) / 0.32) ** 2));
  const bottom = Math.exp(-(((Math.PI - th - 0.55) / 0.35) ** 2));
  const vd = (0.04 + 0.1 * shoulder + 0.07 * bottom) * (1 + 0.25 * Math.sin(ph + 0.8));
  r -= vd * valley(ph, 5) * s;
  // 肩の山の盛り上がりと、底の 4 つのでっぱり
  const crest = Math.max(0, Math.cos(4 * ph + LOBE));
  r += 0.05 * crest * Math.exp(-(((th - 0.45) / 0.22) ** 2));
  r += 0.07 * crest * Math.exp(-(((Math.PI - th - 0.55) / 0.3) ** 2));
  r -= 0.1 * Math.exp(-(((Math.PI - th) / 0.3) ** 2));
  // 上の深いくぼみ（ヘタが沈む）
  r -= 0.38 * Math.exp(-((th / 0.4) ** 2));
  // 下へ少しすぼまる
  r *= 1 + 0.05 * dy;
  // 片側が大きい
  r *= 1 + 0.07 * Math.cos(ph - 0.3) * s;
  r *= 1 + 0.04 * dy * Math.cos(ph + 1.8);
  return r;
}

/** 壁の基本の厚み（ヘタの周りは厚い） */
const wall0 = (dy: number) => 0.06 + 0.05 * smooth(0.75, 0.97, dy);
/** 谷の内側の隔壁（白いすじ）を足した壁の厚み */
const wall = (dy: number, ph: number) => wall0(dy) + 0.06 * valley(ph, 14) * smooth(-0.6, 0.3, dy);

/**
 * 胎座：上から垂れ下がり、先は丸く、上へ向かって円錐のように広がる（双曲面 ρ² = 2R(y - y0) + K²(y - y0)²）。
 * 断面で少し 4 方向にふくらむ。漸近する円錐の頂点 y0 - R/K² が中心より上にあるので、
 * 中心からの光線が当たる距離は向きについて連続に変わる（当たらない向きへは無限遠へ伸びて壁に溶け込む）。
 */
const PL_Y0 = 0.1;
const PL_R = 0.075;
const PL_K = 0.9;
const plM = (ph: number) => 1 + 0.12 * Math.cos(4 * ph + LOBE + Math.PI) + 0.05 * Math.sin(7 * ph + 1);

/** 中心からの光線が胎座に当たる距離（当たらなければ Infinity） */
function placentaHit(dx: number, dy: number, dz: number): number {
  if (dy <= 0) return Infinity;
  const S = Math.hypot(dx, dz) / plM(Math.atan2(dz, dx));
  const K2 = PL_K * PL_K;
  const A = S * S - K2 * dy * dy;
  const B = 2 * K2 * dy * PL_Y0 - 2 * PL_R * dy;
  const C = 2 * PL_R * PL_Y0 - K2 * PL_Y0 * PL_Y0;
  let best = Infinity;
  const take = (t: number) => {
    if (t > 0 && t * dy >= PL_Y0 - 1e-9 && t < best) best = t;
  };
  if (Math.abs(A) < 1e-12) take(-C / B);
  else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      take((-B - q) / (2 * A));
      take((-B + q) / (2 * A));
    }
  }
  return best;
}

/** 胎座の表面から内側へのおおよその距離（負なら外） */
function placentaDepth(q: Vec3): number {
  const h = q[1] - PL_Y0;
  if (h <= 0) return h;
  const rho = Math.hypot(q[0], q[2]) / plM(Math.atan2(q[2], q[0]));
  const rp = Math.sqrt(2 * PL_R * h + PL_K * PL_K * h * h);
  return Math.min((rp - rho) / Math.hypot(1, PL_K), h);
}

/** なめらかな min（つなぎ目を丸める） */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function innerR(dx: number, dy: number, dz: number): number {
  return smin(outerR(dx, dy, dz) - wall(dy, Math.atan2(dz, dx)), placentaHit(dx, dy, dz), 0.14);
}

const M = mul3(rotX3(0.05), scale3(0.74, 0.95, 0.74));
const outer = new StarShape(outerR, M);
const inner = new StarShape(innerR, M);
/**
 * 輪の間隔：胎座が壁に溶け込む所（θ ≈ 0.4〜0.8）と、上下のくぼみの近くに輪を集める。
 * 密度 w(θ) の累積を逆にたどって、0..1 を θ/π へ写す。
 */
const TH_MAP = (() => {
  const w = (th: number) => 1 + 3.5 * Math.exp(-(((th - 0.62) / 0.16) ** 2)) + 0.8 * Math.exp(-((th / 0.35) ** 2)) + 0.6 * Math.exp(-(((Math.PI - th) / 0.5) ** 2));
  const N = 2048;
  const cum = [0];
  for (let i = 0; i < N; i++) cum.push(cum[i] + w((Math.PI * (i + 0.5)) / N));
  const total = cum[N];
  return (u: number) => {
    const target = u * total;
    let lo = 0, hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    return (lo + (target - cum[lo]) / (cum[lo + 1] - cum[lo] || 1)) / N;
  };
})();

/** ヘタ（がく）：5 つの先がある平たい星形。くぼみの面に沿わせて曲げる */
function buildCalyx(q: number): MeshData {
  const cal = new StarShape((dx, _dy, dz) => {
    const ph = Math.atan2(dz, dx);
    return 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(5 * ph + 0.4)) ** 1.5 + 0.05 * Math.cos(11 * ph);
  }, scale3(0.2, 0.035, 0.2));
  const m = cal.build(60 * q, 16 * q);
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    // 水平位置が同じくぼみの面の高さを探す（θ について二分法）
    const x = P[i], z = P[i + 2];
    const rho = Math.hypot(x, z), ph = Math.atan2(z, x);
    let lo = 0, hi = 1.2;
    for (let k = 0; k < 30; k++) {
      const th = (lo + hi) / 2;
      const sp = outer.surfacePoint(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      if (Math.hypot(sp[0], sp[2]) < rho) lo = th;
      else hi = th;
    }
    const th = (lo + hi) / 2;
    const sp = outer.surfacePoint(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    P[i] = sp[0];
    P[i + 1] = sp[1] + 0.012 + P[i + 1];
    P[i + 2] = sp[2];
  }
  computeNormals(m);
  return m;
}

export const pepper: VegDef = {
  id: 'pepper',
  name: 'ピーマン',
  skin: {
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    bumpScale: 0.25,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 空洞の内側（頂点色が淡い）：しっとりした淡い緑、胎座には平たい種の粒
        if (col.b > 0.3 * col.g) {
          float cream = smoothstep(0.85, 1.0, col.r / max(col.g, 0.01));
          vec2 w = worley(p * 18.0);
          float seed = (1.0 - smoothstep(0.28, 0.42, w.x)) * cream;
          col = mix(col, vec3(0.92, 0.8, 0.48), seed * 0.7);
          col *= 0.8 + 0.2 * smoothstep(0.0, 0.3, w.x - 0.3 * cream + 0.3);
          float n = fbm(p * 14.0);
          col *= 0.92 + 0.12 * n;
          bump = seed * 0.8 + n * 0.3;
          gCoat = 0.1;
          gRough = 0.7;
          return;
        }
        // 外側：ゆるいうねりと、ごく小さな淡い点
        float n = fbm(p * vec3(6.0, 2.5, 6.0));
        col *= 0.9 + 0.16 * n;
        vec2 w = worley(p * 55.0);
        float dt = 1.0 - smoothstep(0.03, 0.08, w.x);
        col = mix(col, col * vec3(1.3, 1.25, 1.1), dt * 0.2);
        bump = n * 0.3 + vnoise(p * 30.0) * 0.1;
      }`,
  },
  extrasRoughness: 0.5,
  capRoughness: 0.35,
  glow: 0x9dff6a,
  palette: [0x5fd03a, 0xc8ff9a, 0x2e8a20, 0xffffff],
  initialRotation: [0.5, 0.7, 0.15],
  sound: 'crisp',
  build(q = 1) {
    const out = outer.build(200 * q, 150 * q, TH_MAP);
    paint(out, (p) => {
      const qq = outer.toShapeSpace(p[0], p[1], p[2]);
      const l = Math.hypot(qq[0], qq[1], qq[2]) || 1;
      const dy = qq[1] / l, ph = Math.atan2(qq[2], qq[0]);
      let c: Vec3 = mix([0.09, 0.36, 0.045], [0.05, 0.25, 0.03], fbm(p[0] * 3, p[1] * 3, p[2] * 3));
      // 谷は暗く、肩の山は少し明るい
      c = mix(c, [0.025, 0.13, 0.02], valley(ph, 5) * 0.5);
      c = mix(c, [0.12, 0.38, 0.06], Math.max(0, Math.cos(4 * ph + LOBE)) * smooth(0.3, 0.8, dy) * 0.4);
      // くぼみの底（ヘタの周り）は黄緑
      c = mix(c, [0.2, 0.4, 0.08], smooth(0.9, 0.99, dy) * 0.6);
      return c;
    });
    const inn = asCavity(inner.build(200 * q, 150 * q, TH_MAP));
    paint(inn, (p) => {
      const qq = inner.toShapeSpace(p[0], p[1], p[2]);
      const l = Math.hypot(qq[0], qq[1], qq[2]) || 1;
      const dx = qq[0] / l, dy = qq[1] / l, dz = qq[2] / l;
      const ph = Math.atan2(dz, dx);
      const wallIn = outerR(dx, dy, dz) - wall(dy, ph);
      // 胎座（クリーム色）と、隔壁のすじ（白っぽい）、壁（淡い緑）
      const pl = smooth(wallIn - 0.01, wallIn - 0.05, l);
      let c: Vec3 = mix([0.24, 0.38, 0.15], [0.2, 0.33, 0.12], fbm(p[0] * 5, p[1] * 5, p[2] * 5));
      c = mix(c, [0.42, 0.5, 0.3], valley(ph, 14) * smooth(-0.6, 0.3, dy));
      return mix(c, [0.72, 0.7, 0.5], pl);
    });
    const body = mergeMeshes([out, inn]);

    // 軸：太く、かぎ状に曲がる。切り口は淡い
    const top = outer.surfacePoint(0, 1, 0);
    const stem = buildTube(
      (t) => [top[0] + 0.16 * t * t, top[1] + 0.02 + 0.34 * t - 0.08 * t * t, top[2] + 0.03 * t],
      (t) => 0.06 - 0.014 * t + 0.022 * Math.exp(-((t / 0.12) ** 2)),
      14,
      14,
    );
    const extras = mergeMeshes([buildCalyx(q), stem]);
    paint(extras, (p) => {
      let c: Vec3 = mix([0.08, 0.26, 0.04], [0.22, 0.42, 0.1], smooth(top[1] + 0.06, top[1] + 0.2, p[1]));
      // 軸の先の切り口
      if (p[0] - top[0] > 0.14) c = mix(c, [0.6, 0.64, 0.4], smooth(0.14, 0.16, p[0] - top[0]));
      return c;
    });

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const qq = outer.toShapeSpace(x, y, z);
      const l = Math.hypot(qq[0], qq[1], qq[2]) || 1e-9;
      const dx = qq[0] / l, dy = qq[1] / l, dz = qq[2] / l;
      const ph = Math.atan2(dz, dx);
      const ro = outerR(dx, dy, dz);
      if (l > ro - 0.008) return [0.04, 0.22, 0.03];
      const w0 = wall0(dy), w = wall(dy, ph);
      if (l > ro - w0 - 0.004) {
        // 果肉の壁：外は濃い緑、内側の薄皮は白っぽい
        const t = (ro - l) / w0;
        let c: Vec3 = mix([0.2, 0.5, 0.08], [0.42, 0.7, 0.22], smooth(0.15, 0.9, t));
        c = mix(c, [0.36, 0.64, 0.18], 0.3 * fbm(x * 30, y * 30, z * 30));
        if (t > 0.88) c = mix(c, [0.78, 0.88, 0.6], 0.7);
        return c;
      }
      if (l > ro - w - 0.004) {
        // 隔壁のすじ・ヘタの周りの厚い所
        return mix([0.72, 0.84, 0.52], [0.86, 0.92, 0.7], fbm(x * 20, y * 20, z * 20));
      }
      // 胎座：中は白っぽいスポンジで、ヘタに近い上の方は緑。下の方の表面に平たい種が房のように付く
      const d = placentaDepth(qq);
      let c: Vec3 = mix([0.9, 0.92, 0.76], [0.5, 0.72, 0.26], smooth(0.42, 0.62, qq[1]));
      c = mix(c, [0.98, 0.98, 0.9], 0.35 * smooth(0.45, 0.75, fbm(x * 30, y * 10, z * 30)));
      if (d < 0.11 && qq[1] < 0.5) {
        const cs = cell3(qq[0] * 11, qq[1] * 11, qq[2] * 11);
        if (cs.id < 0.9) {
          const se = cs.d / 0.42;
          if (se < 1) c = se < 0.8 ? mix([0.98, 0.9, 0.6], [0.93, 0.82, 0.5], se) : [0.72, 0.6, 0.34];
        }
      }
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.62, 0.74, 0.4] };
  },
};
