import { buildTube, mergeMeshes, paint, type MeshData, type Vec3 } from '../geometry/mesh';
import { Revolve, buildRibbon, capEnd, fbm, hash3, mix, rng, smooth, type VegDef } from './common';

// とうもろこし（皮をむいた 1 本）：根元が太く、先へ細くなって丸く閉じる。少し反っている。
// 表面は淡い黄色の粒が 16 列にまっすぐ並び、隣の列とは半粒ずれる。先の方の粒は小さく、色も淡い。
// 根元は平たい切り口（クリーム色の芯）。むいた皮・軸・ひげは体積から除外する。
// 断面は中心の白い芯（スポンジ状）と、そのまわりに放射状に並ぶ粒（根元側は白い胚）。

const Y0 = -1.4;
const Y1 = 1.4;
const L = Y1 - Y0;
/** 粒の列の数 */
const ROWS = 16;
/** 粒の高さ（くびれの底からの盛り上がり） */
const KH = 0.045;
/** 粒の間隔：根元 A、先へ行くほど B だけ詰まる */
const SP_A = 0.074;
const SP_B = 0.026;

const axis = (y: number): [number, number] => {
  const u = (y - Y0) / L;
  return [0.12 * u * u - 0.03 * u, 0.02 * u];
};

/** 粒のくびれの底の半径（根元が太く、先へ細る） */
function baseR(y: number): number {
  const u = (y - Y0) / L;
  const r = 0.45 * (1 + 0.06 * Math.sin(Math.PI * Math.min(1, u * 1.6))) * (1 - 0.32 * smooth(0.25, 1.0, u) ** 1.4);
  return r * capEnd(y - Y0, 0.05) * capEnd(Y1 - y, 0.38);
}

/** 粒の座標：列 a（0..ROWS）と、根元からの粒の番号 b（間隔が先へ行くほど詰まる） */
function kernelCoord(y: number, ph: number): { a: number; b: number; u: number } {
  const u = Math.min(1, Math.max(0, (y - Y0) / L));
  const a = ((ph / (Math.PI * 2)) * ROWS + ROWS * 4) % ROWS;
  const b = (L / SP_B) * Math.log(SP_A / (SP_A - SP_B * u));
  return { a, b, u };
}

/** 粒のふくらみ（0..1）と、粒ごとの乱数 */
function kernel(y: number, ph: number): { pillow: number; id: number; fa: number; fb: number; u: number } {
  const { a, b, u } = kernelCoord(y, ph);
  const row = Math.floor(a);
  const bb = b + (row % 2) * 0.5;
  const fa = a - row, fb = bb - Math.floor(bb);
  const id = hash3(row, Math.floor(bb), 7);
  const pillow = Math.sin(Math.PI * fa) ** 0.6 * Math.sin(Math.PI * fb) ** 0.6;
  return { pillow, id, fa, fb, u };
}

function radius(y: number, ph: number): number {
  const k = kernel(y, ph);
  // 先の粒は小さく、ところどころ育っていない
  const grow = (1 - smooth(0.82, 0.98, k.u)) * (k.u > 0.8 && k.id < 0.25 ? 0.4 : 1);
  const h = KH * k.pillow * (0.85 + 0.3 * k.id) * grow;
  return baseR(y) + h * capEnd(y - Y0, 0.05) * capEnd(Y1 - y, 0.38);
}

const shape = new Revolve(Y0, Y1, radius, axis);

export const corn: VegDef = {
  id: 'corn',
  name: 'とうもろこし',
  skin: {
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    bumpScale: 0.2,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 粒の表面のごく細かなムラと、薄い皮の透け
        float n = vnoise(p * 40.0);
        col *= 0.95 + 0.08 * n;
        bump = n * 0.3;
      }`,
  },
  extrasRoughness: 0.7,
  capRoughness: 0.35,
  glow: 0xffe066,
  palette: [0xffe066, 0xfff4b8, 0xd8b030, 0x9fd06a],
  initialRotation: [0.35, 0.6, 1.2],
  sound: 'crisp',
  displayScale: 1.3,
  build(q = 1) {
    const body = shape.build(360 * q, 192 * q);
    paint(body, (p) => {
      const [ax, az] = axis(p[1]);
      const ph = Math.atan2(p[2] - az, p[0] - ax);
      const k = kernel(p[1], ph);
      // 粒の頂は明るい黄色、くびれは少し濃く影になる。粒ごとにわずかに色が違い、先の粒は淡い
      let c: Vec3 = mix([0.96, 0.72, 0.16], [1.0, 0.82, 0.3], k.id);
      c = mix(c, [0.78, 0.52, 0.1], (1 - smooth(0.15, 0.6, k.pillow)) * 0.75);
      c = mix(c, [0.98, 0.9, 0.6], smooth(0.78, 0.98, k.u) * 0.6);
      // 根元の切り口：中心はクリーム色の芯
      if (p[1] < Y0 + 0.04) {
        const rho = Math.hypot(p[0] - ax, p[2] - az) / Math.max(0.01, baseR(Y0 + 0.06));
        c = rho < 0.55 ? mix([0.94, 0.9, 0.74], [0.86, 0.8, 0.6], fbm(p[0] * 20, 0, p[2] * 20)) : mix([0.9, 0.82, 0.55], c, smooth(0.6, 0.9, rho));
      }
      return c;
    });

    // むいた皮（根元から外へ垂れる）、軸、先のひげ
    const parts: MeshData[] = [];
    const r = rng(41);
    const [bx, bz] = axis(Y0);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4 + r() * 0.4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const len = 0.55 + r() * 0.25;
      const out = 0.35 + r() * 0.2;
      parts.push(
        buildRibbon(
          (t) => {
            const d = 0.3 + out * Math.sin(t * 1.4);
            return [bx + ca * d, Y0 + 0.12 - len * t, bz + sa * d];
          },
          (t) => (0.36 + 0.12 * Math.sin(Math.PI * t)) * (1 - 0.7 * t),
          () => 0.012,
          () => [ca, 0, sa],
          16,
          10,
        ),
      );
    }
    parts.push(buildTube((t) => [bx, Y0 + 0.06 - 0.32 * t, bz], (t) => 0.16 - 0.03 * t, 6, 16));
    const tip = axis(Y1);
    for (let k = 0; k < 14; k++) {
      const a = r() * Math.PI * 2;
      const len = 0.18 + r() * 0.25;
      const w = r() * 6;
      parts.push(
        buildTube(
          (t) => [tip[0] + 0.03 * Math.cos(a) + len * t * (0.5 * Math.cos(a) + 0.4), Y1 - 0.03 + len * t * 0.6 - 0.15 * t * t, tip[1] + 0.03 * Math.sin(a) + len * t * 0.5 * Math.sin(a) + 0.02 * Math.sin(w + t * 6)],
          () => 0.006,
          8,
          4,
        ),
      );
    }
    const extras = mergeMeshes(parts);
    paint(extras, (p) => {
      if (p[1] > Y1 - 0.1) return mix([0.86, 0.72, 0.42], [0.6, 0.42, 0.22], smooth(Y1, Y1 + 0.2, p[1])); // ひげ
      if (p[1] < Y0 + 0.07 && Math.hypot(p[0] - bx, p[2] - bz) < 0.17) return [0.74, 0.76, 0.5]; // 軸
      return mix([0.66, 0.8, 0.42], [0.52, 0.7, 0.32], fbm(p[0] * 6, p[1] * 6, p[2] * 6)); // 皮
    });

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const Lc = shape.local(x, y, z);
      const R0 = baseR(y);
      const rr = R0 > 1e-4 ? Lc.rho / R0 : 2;
      // 中心の芯：白いスポンジ状、外側に薄い殻の輪
      if (rr < 0.48) return mix([0.97, 0.95, 0.86], [0.92, 0.9, 0.78], fbm(x * 18, y * 18, z * 18));
      if (rr < 0.56) return mix([0.9, 0.82, 0.6], [0.84, 0.74, 0.5], fbm(x * 30, y * 30, z * 30));
      if (Lc.s > 0.985) return [0.96, 0.74, 0.2];
      // 粒：芯から放射状に伸び、根元側は白い胚、外側は黄色。粒の境目は細い線
      const k = kernel(y, Lc.ph);
      let c: Vec3 = mix([0.98, 0.94, 0.76], [0.98, 0.8, 0.28], smooth(0.62, 0.85, rr));
      c = mix(c, [1.0, 0.86, 0.4], 0.2 * k.id);
      const edge = Math.min(k.fa, 1 - k.fa, k.fb, 1 - k.fb);
      c = mix(c, [0.86, 0.72, 0.4], (1 - smooth(0.02, 0.08, edge)) * 0.7);
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.8, 0.86, 0.6] };
  },
};
