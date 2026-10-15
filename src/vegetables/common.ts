import { buildRings, computeNormals, cross, flipWinding, normalize, type MeshData, type Vec3 } from '../geometry/mesh';

/** 切ったときの手応えの音。crisp: シャキッ、soft: やわらか、juicy: みずみずしい、leafy: 葉が重なったザクッ、hard: 固いザクン */
export type Sound = 'crisp' | 'soft' | 'juicy' | 'leafy' | 'hard';

export interface VegModel {
  /** 体積の対象（皮・芯を含む可食部の本体）。閉じたメッシュ。空洞は向きを反転した閉じた面で表す */
  body: MeshData;
  /** 体積から除外する部分（ヘタ・葉・根）。表示と切断はするが体積には数えない */
  extras: MeshData | null;
  /** ローカル座標の点の断面色（sRGB 0..1）。断面テクスチャの生成に使う */
  flesh: (x: number, y: number, z: number) => Vec3;
  /** ヘタ・葉・根の断面色 */
  extrasCapColor: Vec3;
}

export interface VegDef {
  id: string;
  name: string;
  /** q はメッシュの細かさの倍率（検証用。ゲームでは 1） */
  build: (q?: number) => VegModel;
  skin: {
    roughness: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    sheen?: number;
    sheenColor?: number;
    /** 凹凸の強さ */
    bumpScale: number;
    /**
     * 皮の細かな模様（GLSL）。次の関数を定義する:
     * void skinDetail(vec3 p, inout vec3 col, out float bump)
     */
    glsl: string;
  };
  extrasRoughness: number;
  /** 断面のツヤ（小さいほど濡れて見える） */
  capRoughness: number;
  /** 断面が光るときの色 */
  glow: number;
  /** 成功時の祝福の粒の色 */
  palette: number[];
  /** 初期姿勢（XYZ オイラー角, ラジアン） */
  initialRotation: Vec3;
  sound: Sound;
  /**
   * 表示の倍率（省略時 1）。表示の大きさは「どの向きでも画面に収まる球」に合わせるので、
   * 細長い野菜は小さく見える。その分を大きくする（1.3 で、縦長画面に横向きに置いても幅の 9 割ほど）
   */
  displayScale?: number;
}

// ---- 決定的な乱数とノイズ（毎回同じ形・模様になるように） ----

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export function fbm(x: number, y: number, z: number, oct = 3): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleC = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const hex = (h: number): Vec3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** 楕円体の内側判定量（1 未満なら内側）。軸は ex/ey/ez（単位ベクトル）、半径 a/b/c */
export function ellipsoid(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number,
  ex: Vec3, ey: Vec3, ez: Vec3,
  a: number, b: number, c: number,
): number {
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  const x = (dx * ex[0] + dy * ex[1] + dz * ex[2]) / a;
  const y = (dx * ey[0] + dy * ey[1] + dz * ey[2]) / b;
  const z = (dx * ez[0] + dy * ez[1] + dz * ez[2]) / c;
  return x * x + y * y + z * z;
}

/** 種などを描くときの、輪郭に少し明るい縁を付けた色 */
export function seedColor(e: number, base: Vec3, rim: Vec3): Vec3 {
  return mix(base, rim, smooth(0.55, 1.0, e));
}

/**
 * 3 次元のセルノイズ。最も近い特徴点までの距離（格子 1 あたり）と、その点の番号（0..1 の乱数）を返す。
 * 種・気孔・芽など、ばらばらに散った粒を描くのに使う。
 */
export function cell3(x: number, y: number, z: number): { d: number; id: number } {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9, id = 0;
  for (let k = -1; k <= 1; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i, cy = yi + j, cz = zi + k;
        const px = cx + hash3(cx, cy, cz), py = cy + hash3(cx + 17, cy, cz), pz = cz + hash3(cx, cy + 31, cz);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < best) {
          best = d;
          id = hash3(cx, cy + 7, cz + 13);
        }
      }
  return { d: best, id };
}

/**
 * 縦軸（y）まわりの回転体。高さ y の水平断面を「軸の位置 axis(y)」と「方向 φ ごとの半径 radius(y, φ)」で決める。
 * 軸を曲げられるので、ナスの反りや大根の曲がりも表せる。radius は両端 y0・y1 で 0 に近づける。
 * 同じ定義から、任意の点の「表面からの深さ」を逆算できる（断面の模様が形と一致する）。
 */
export class Revolve {
  constructor(
    readonly y0: number,
    readonly y1: number,
    readonly radius: (y: number, ph: number) => number,
    readonly axis: (y: number) => [number, number] = () => [0, 0],
  ) {}

  build(nR: number, nS: number): MeshData {
    const { y0, y1 } = this;
    const yAt = (t: number) => y0 + (y1 - y0) * ((1 - Math.cos(Math.PI * t)) / 2);
    const a0 = this.axis(y0), a1 = this.axis(y1);
    return buildRings(
      nR,
      nS,
      (i, j) => {
        const y = yAt((i + 1) / (nR + 1));
        const ph = (j / nS) * Math.PI * 2;
        const r = this.radius(y, ph);
        const [ax, az] = this.axis(y);
        return [ax + r * Math.cos(ph), y, az + r * Math.sin(ph)];
      },
      [a0[0], y0, a0[1]],
      [a1[0], y1, a1[1]],
    );
  }

  /** s: 軸 0・表面 1 の正規化半径（外は 1 超）、rho: 軸からの距離、ph: 方向 */
  local(x: number, y: number, z: number): { s: number; rho: number; ph: number; R: number; dx: number; dz: number } {
    const [ax, az] = this.axis(y);
    const dx = x - ax, dz = z - az;
    const rho = Math.hypot(dx, dz);
    const ph = Math.atan2(dz, dx);
    const R = y <= this.y0 || y >= this.y1 ? 0 : this.radius(y, ph);
    return { s: R > 1e-6 ? rho / R : 2, rho, ph, R, dx, dz };
  }
}

/** 閉じたメッシュの向きを反転して「空洞」にする（体積が負になり、外側のメッシュと合わせると中が空く） */
export function asCavity(mesh: MeshData): MeshData {
  flipWinding(mesh);
  computeNormals(mesh);
  return mesh;
}

/** 回転体の端を丸めて閉じる係数（端からの距離 d、丸める長さ len）。0..1 */
export function capEnd(d: number, len: number): number {
  const t = clamp01(d / len);
  return Math.sqrt(1 - (1 - t) * (1 - t));
}

/**
 * 平たい帯（葉・ガク・皮のめくれなど）。中心線 path(t) に沿って、幅 width(t)、厚み thick(t) の楕円断面で作る閉じたメッシュ。
 * up(t) は帯の面の法線のおおよその向き（厚み方向）。
 */
export function buildRibbon(
  path: (t: number) => Vec3,
  width: (t: number) => number,
  thick: (t: number) => number,
  up: (t: number) => Vec3,
  nRings = 14,
  nSeg = 10,
): MeshData {
  const at = (i: number) => i / (nRings - 1);
  const frame = (t: number) => {
    const a = path(Math.max(0, t - 0.01)), b = path(Math.min(1, t + 0.01));
    const tan = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const side = normalize(cross(tan, up(t)));
    const nrm = cross(side, tan);
    return { c: path(t), tan, side, nrm };
  };
  const f0 = frame(0), f1 = frame(1);
  return buildRings(
    nRings,
    nSeg,
    (i, j) => {
      const t = at(i);
      const f = frame(t);
      const a = (j / nSeg) * Math.PI * 2;
      const w = width(t) * Math.cos(a), h = thick(t) * Math.sin(a);
      return [f.c[0] + f.side[0] * w + f.nrm[0] * h, f.c[1] + f.side[1] * w + f.nrm[1] * h, f.c[2] + f.side[2] * w + f.nrm[2] * h];
    },
    [f0.c[0] - f0.tan[0] * 0.004, f0.c[1] - f0.tan[1] * 0.004, f0.c[2] - f0.tan[2] * 0.004],
    [f1.c[0] + f1.tan[0] * 0.004, f1.c[1] + f1.tan[1] * 0.004, f1.c[2] + f1.tan[2] * 0.004],
  );
}

/** 球面上にほぼ均等に並べた n 個の方向（フィボナッチ格子） */
export function fibDirs(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996323;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}
