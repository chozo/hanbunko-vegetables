import { buildRings, buildTube, mergeMeshes, paint, type MeshData, type Vec3 } from '../geometry/mesh';
import { Revolve, buildRibbon, capEnd, fbm, mix, rng, smooth, vnoise, type VegDef } from './common';

// 二股大根：太い青首から下へ細くなり、途中（股）で 2 本の足に分かれる。足は長さが違い、外へ開きながら先がとがる。
// 本体は「胴」と「2 本の足」の 3 つの閉じた面でできている。胴の底（股の高さ YF の水平な円）を
// 2 本の足の上端（半円ずつ）がちょうど分け合うので、重なりもすき間もなく、体積は 3 つの和になる。
// 足の断面は、上端の半円から下へ行くにつれて丸い断面に変わるので、外側の表面は胴から足へ途切れずにつながる。
// 皮：青首の緑、横じわ、2 列に並ぶひげ根の跡のくぼみ。上の葉の軸とひげ根は体積から除外する。

const Y1 = 1.15;
/** 股の高さ */
const YF = -0.45;
/** 股での胴の半径 */
const RF = 0.43 * 0.8;

function lump(y: number, ph: number): number {
  // ゆるいでこぼこ（完全な回転体に見えないように）
  return 1 + 0.025 * (vnoise(Math.cos(ph) * 1.5 + 3, y * 2.2, Math.sin(ph) * 1.5) - 0.5) * 2;
}

function bodyAxis(y: number): [number, number] {
  const u = (Y1 - y) / (Y1 - YF);
  return [0.07 * u * u + 0.025 * Math.sin(u * 3.5), -0.02 * u * u];
}

function bodyR(y: number, ph: number): number {
  const u = (y - YF) / (Y1 - YF); // 0: 股, 1: 首
  let r = 0.43 * (0.8 + 0.2 * smooth(0.0, 0.8, u));
  r *= 1 + 0.05 * Math.exp(-(((u - 0.82) / 0.12) ** 2)); // 首の少し下がふくらむ
  r *= capEnd(Y1 - y, 0.13); // 上は角を丸めた平ら
  r *= 1 + 0.03 * Math.cos(ph - 0.8) * smooth(0.3, 0.9, u) * (1 - smooth(0.0, 0.15, -u));
  // 股の近くでは股の円（半径 RF）に合わせる
  return mix1(r * lump(y, ph), RF, smooth(0.12, 0.0, u));
}

const mix1 = (a: number, b: number, t: number) => a + (b - a) * t;

/** 足が分かれる向き（xz 平面） */
const BETA = 0.35;
const NX = Math.cos(BETA), NZ = Math.sin(BETA);
/** 半円の重心までの距離 */
const DC = (4 * RF) / (3 * Math.PI);

interface Leg {
  side: 1 | -1;
  /** 先端の高さ */
  yTip: number;
  /** 先へ行くほど外へ開く量 */
  spread: number;
  /** 前後へのねじれ */
  curl: number;
  shape: Revolve;
}

function makeLeg(side: 1 | -1, len: number, spread: number, curl: number): Leg {
  const yTip = YF - len;
  const [fx, fz] = bodyAxis(YF);
  const c0x = fx + side * NX * DC, c0z = fz + side * NZ * DC;
  const axis = (y: number): [number, number] => {
    const t = Math.min(1, Math.max(0, (YF - y) / len));
    const o = spread * t ** 1.4;
    const k = curl * t * t;
    return [c0x + side * NX * o - NZ * k, c0z + side * NZ * o + NX * k];
  };
  /** 上端の半円（股の円を分け合う）を、半円の重心から見た方向 ph の半径で表す */
  const halfDisk = (ph: number) => {
    const ux = Math.cos(ph), uz = Math.sin(ph);
    const un = side * (ux * NX + uz * NZ); // 外向き成分
    const tLine = un < -1e-9 ? DC / -un : Infinity;
    const b = DC * un;
    const tCirc = -b + Math.sqrt(b * b - (DC * DC - RF * RF));
    return Math.min(tLine, tCirc);
  };
  const r0 = RF * 0.74;
  const radius = (y: number, ph: number) => {
    const t = Math.min(1, Math.max(0, (YF - y) / len));
    const round = r0 * (1 - t) ** 0.8 * (1 + 0.06 * Math.exp(-(((t - 0.18) / 0.15) ** 2)));
    const w = smooth(0.0, 0.2, t);
    return mix1(halfDisk(ph), round * lump(y, ph), w);
  };
  return { side, yTip, spread, curl, shape: new Revolve(yTip, YF, radius, axis) };
}

const LEGS: Leg[] = [makeLeg(1, 1.25, 0.3, 0.1), makeLeg(-1, 0.95, 0.24, -0.06)];

/** リング 0 の頂点の法線を、隣のリングの法線で置き換える（平らな底・上端の面と平均されて陰が乗るのを防ぐ） */
function fixSeamNormals(mesh: MeshData, nS: number): void {
  const n = mesh.normals;
  for (let j = 0; j < nS; j++) {
    const a = (1 + j) * 3, b = (1 + nS + j) * 3;
    n[a] = n[b];
    n[a + 1] = n[b + 1];
    n[a + 2] = n[b + 2];
  }
}

function buildBody(q: number): MeshData {
  const nR = Math.round(90 * q), nS = Math.round(96 * q);
  const [fx, fz] = bodyAxis(YF);
  const yAt = (i: number) => YF + (Y1 - YF) * Math.sin(((i / nR) * Math.PI) / 2);
  const m = buildRings(
    nR,
    nS,
    (i, j) => {
      const y = yAt(i);
      const ph = (j / nS) * Math.PI * 2;
      const r = i === 0 ? RF : bodyR(y, ph);
      const [ax, az] = bodyAxis(y);
      return [ax + r * Math.cos(ph), y, az + r * Math.sin(ph)];
    },
    [fx, YF, fz],
    [bodyAxis(Y1)[0], Y1, bodyAxis(Y1)[1]],
  );
  fixSeamNormals(m, nS);
  return m;
}

function buildLeg(L: Leg, q: number): MeshData {
  const nR = Math.round(80 * q), nS = Math.round(96 * q);
  const len = YF - L.yTip;
  const yAt = (i: number) => YF - len * Math.sin(((i / nR) * Math.PI) / 2);
  const s = L.shape;
  const c0 = s.axis(YF);
  const tip = s.axis(L.yTip);
  const m = buildRings(
    nR,
    nS,
    (i, j) => {
      const y = yAt(i);
      const ph = (j / nS) * Math.PI * 2;
      const r = s.radius(y, ph);
      const [ax, az] = s.axis(y);
      return [ax + r * Math.cos(ph), y, az + r * Math.sin(ph)];
    },
    [c0[0], YF, c0[1]],
    [tip[0], L.yTip, tip[1]],
  );
  fixSeamNormals(m, nS);
  return m;
}

/** 点の正規化深さ（中心 0、表面 1）と、その点を含む部分の方向・高さ */
function localInfo(x: number, y: number, z: number): { s: number; ph: number } {
  if (y >= YF) {
    const [ax, az] = bodyAxis(y);
    const dx = x - ax, dz = z - az;
    const ph = Math.atan2(dz, dx);
    return { s: Math.hypot(dx, dz) / Math.max(1e-6, bodyR(y, ph)), ph };
  }
  let best = { s: 9, ph: 0 };
  for (const L of LEGS) {
    const l = L.shape.local(x, y, z);
    if (l.s < best.s) best = { s: l.s, ph: l.ph };
  }
  return best;
}

/** 皮の色（頂点色）。高さで青首の緑から白へ、先と足は少し土色 */
function skinColor(p: Vec3): Vec3 {
  const y = p[1];
  let c: Vec3 = mix([0.95, 0.94, 0.89], [0.9, 0.89, 0.83], fbm(p[0] * 4, p[1] * 2, p[2] * 4));
  // 青首：上の方が薄い緑。境目は縦にすじ状にゆらぐ
  const g = smooth(0.0, 1.0, y + 0.18 * (fbm(p[0] * 5 + 4, p[1] * 0.8, p[2] * 5) - 0.5) * 2);
  c = mix(c, [0.74, 0.85, 0.58], g * 0.85);
  c = mix(c, [0.56, 0.72, 0.36], smooth(0.95, 1.13, y) * 0.75);
  // 足の先は土で少し黄ばむ
  c = mix(c, [0.84, 0.78, 0.62], smooth(YF - 0.4, YF - 1.3, y) * 0.55);
  return c;
}

export const daikon: VegDef = {
  id: 'daikon',
  name: '大根',
  skin: {
    roughness: 0.4,
    clearcoat: 0.45,
    clearcoatRoughness: 0.35,
    sheen: 0.25,
    sheenColor: 0xf0f4e8,
    bumpScale: 0.6,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 横じわ：途切れながら横に走る細い溝
        float ring = vnoise(p * vec3(5.0, 55.0, 5.0) + vec3(0.0, fbm(p * 2.0) * 3.0, 0.0));
        float line = smoothstep(0.7, 0.92, ring) * smoothstep(0.35, 0.6, vnoise(p * vec3(9.0, 3.0, 9.0)));
        // ひげ根の跡：向かい合う 2 列に並ぶ小さなくぼみ（列は少しねじれる）
        float a = atan(p.z, p.x) - 0.6 - p.y * 0.35;
        float rowW = pow(abs(cos(a)), 40.0);
        vec2 w = worley(vec3(cos(a) * 3.0, p.y * 9.0, sin(a) * 3.0));
        float pit = (1.0 - smoothstep(0.05, 0.13, w.x)) * rowW;
        // 皮目（小さな横長の点）
        vec2 w2 = worley(p * vec3(26.0, 60.0, 26.0));
        float lent = (1.0 - smoothstep(0.015, 0.04, w2.x)) * 0.18;
        col *= 0.95 + 0.08 * vnoise(p * 34.0);
        col = mix(col, col * vec3(0.93, 0.92, 0.87), line * 0.3);
        col = mix(col, col * vec3(0.84, 0.8, 0.7), pit * 0.4);
        col = mix(col, col * vec3(0.86, 0.82, 0.7), lent);
        // みずみずしい透明感：うっすらとした縦のムラ
        col *= 0.97 + 0.05 * vnoise(p * vec3(14.0, 2.0, 14.0));
        bump = -line * 0.45 - pit * 0.5 - lent * 0.15;
      }`,
  },
  extrasRoughness: 0.55,
  capRoughness: 0.26,
  glow: 0xe6fff2,
  palette: [0xffffff, 0xd8f5c0, 0x8fd65a, 0xf6f2dc],
  initialRotation: [0.1, 0.3, 0.55],
  sound: 'crisp',
  displayScale: 1.35,
  build(q = 1) {
    const parts = [buildBody(q), ...LEGS.map((L) => buildLeg(L, q))];
    for (const m of parts) paint(m, (p) => skinColor(p));
    const body = mergeMeshes(parts);

    // 上の切り口から出る葉の軸（短く切ってある）。外側ほど寝て、断面は平たい
    const [tx, tz] = bodyAxis(Y1);
    const r = rng(11);
    const extras: MeshData[] = [];
    for (let k = 0; k < 13; k++) {
      const a = k * 2.39996 + r() * 0.3;
      const d = k < 3 ? 0.02 + 0.03 * k : 0.07 + r() * 0.13;
      const lean = 0.1 + d * 2.2 + r() * 0.15;
      const len = 0.3 + r() * 0.22 - d * 0.5;
      const x0 = tx + d * Math.cos(a), z0 = tz + d * Math.sin(a);
      const ca = Math.cos(a), sa = Math.sin(a);
      extras.push(
        buildRibbon(
          (t) => [x0 + ca * lean * len * t, Y1 - 0.07 + len * t - 0.05 * lean * t * t, z0 + sa * lean * len * t],
          (t) => 0.04 - 0.008 * t,
          (t) => 0.022 - 0.004 * t,
          () => [ca, 0, sa],
          8,
          10,
        ),
      );
    }
    // ひげ根：2 列のくぼみと足の先から出る細い根
    const hairs = (x0: number, y0: number, z0: number, dx: number, dz: number, len: number) => {
      const w = r() * 6;
      extras.push(
        buildTube(
          (t) => [x0 + dx * len * t * (1 - 0.4 * t), y0 - 0.9 * len * t * t, z0 + dz * len * t * (1 - 0.4 * t) + 0.012 * Math.sin(w + t * 7)],
          (t) => 0.0045 - 0.0025 * t,
          6,
          5,
        ),
      );
    };
    for (let k = 0; k < 6; k++) {
      const y = YF - 0.05 + r() * 0.75;
      const rowSide = k % 2 ? 0 : Math.PI;
      const a = 0.6 + y * 0.35 + rowSide + (r() - 0.5) * 0.2;
      const [ax, az] = bodyAxis(y);
      const R = bodyR(y, a) * 0.97;
      hairs(ax + R * Math.cos(a), y, az + R * Math.sin(a), Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.07 + r() * 0.07);
    }
    for (const L of LEGS) {
      for (let k = 0; k < 3; k++) {
        const y = L.yTip + 0.06 + k * 0.14;
        const [ax, az] = L.shape.axis(y);
        const a = r() * Math.PI * 2;
        const R = L.shape.radius(y, a) * 0.95;
        hairs(ax + R * Math.cos(a), y, az + R * Math.sin(a), Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.07 + r() * 0.09);
      }
    }
    const ex = mergeMeshes(extras);
    paint(ex, (p) =>
      p[1] > Y1 - 0.1
        ? mix([0.62, 0.76, 0.36], [0.32, 0.54, 0.18], smooth(Y1, Y1 + 0.35, p[1]))
        : mix([0.86, 0.82, 0.68], [0.72, 0.64, 0.48], fbm(p[0] * 9, p[1] * 9, p[2] * 9)),
    );

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const { s, ph } = localInfo(x, y, z);
      const green = smooth(0.2, 0.95, y);
      if (s > 0.975) return mix([0.88, 0.87, 0.8], [0.66, 0.78, 0.48], green);
      let c: Vec3 = mix([0.97, 0.97, 0.93], [0.92, 0.93, 0.86], smooth(0.2, 0.95, s));
      c = mix(c, [0.86, 0.94, 0.72], green * 0.5 * smooth(0.6, 0.97, s));
      // 形成層の輪（皮の少し内側の、半透明な線）
      c = mix(c, [0.84, 0.85, 0.8], Math.exp(-(((s - 0.9) / 0.012) ** 2)) * 0.8);
      // 中心から放射状に伸びる細い筋
      const ray = Math.abs(Math.sin(ph * 24 + fbm(x * 3, y * 3, z * 3) * 6));
      c = mix(c, [0.9, 0.9, 0.86], (1 - smooth(0.0, 0.15, ray)) * 0.45 * smooth(0.1, 0.5, s) * (1 - smooth(0.85, 0.9, s)));
      // みずみずしいムラ
      c = mix(c, [1.0, 1.0, 0.98], 0.3 * smooth(0.55, 0.8, fbm(x * 14, y * 4, z * 14)));
      return c;
    };
    return { body, extras: ex, flesh, extrasCapColor: [0.75, 0.86, 0.6] };
  },
};
