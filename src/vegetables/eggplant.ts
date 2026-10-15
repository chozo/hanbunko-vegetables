import { buildTube, mergeMeshes, paint, type MeshData, type Vec3 } from '../geometry/mesh';
import { Revolve, buildRibbon, capEnd, cell3, clamp01, fbm, mix, smooth, type VegDef } from './common';

// ナス：下（花の側）がふくらみ、上のヘタの側へ細くなって弓なりに反る。
// 皮は黒に近い濃い紫でつやがある。ヘタ（ガクと軸）は紫がかった黒で、体積から除外する。ガクに隠れていた首は白っぽい黄緑。
// 断面は淡いクリーム色の果肉に、種の点が長さ方向に並ぶ帯がある。

const Y0 = -1.3;
const Y1 = 1.05;

/** なめらかな最大値 */
function smax(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (a - b)) / k);
  return b + (a - b) * h + k * h * (1 - h);
}

const shape = new Revolve(
  Y0,
  Y1,
  (y, ph) => {
    const bulb = 0.47 * Math.sqrt(Math.max(0, 1 - ((y + 0.5) / 0.85) ** 2));
    const neck = 0.27 * Math.sqrt(Math.max(0, 1 - ((y - 0.45) / 0.75) ** 2));
    let r = smax(bulb, neck, 0.2);
    r *= capEnd(y - Y0, 0.18) * capEnd(Y1 - y, 0.08);
    r *= 1 + 0.03 * Math.cos(ph - 2.4) * smooth(0.4, -0.6, y) + 0.012 * Math.cos(4 * ph);
    return r;
  },
  (y) => {
    const u = (y - Y0) / (Y1 - Y0);
    return [0.42 * u * u - 0.08 * u, 0.04 * u];
  },
);

export const eggplant: VegDef = {
  id: 'eggplant',
  name: 'ナス',
  skin: {
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    bumpScale: 0.08,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        float n = fbm(p * vec3(3.0, 12.0, 3.0));
        col *= 0.88 + 0.22 * n;
        bump = n * 0.3;
      }`,
  },
  extrasRoughness: 0.7,
  capRoughness: 0.4,
  glow: 0xd59cff,
  palette: [0xa24cff, 0xe2b8ff, 0x5c1a8a, 0x7ad04a],
  initialRotation: [0.2, -0.5, 1.25],
  sound: 'soft',
  build(q = 1) {
    const body = shape.build(150 * q, 80 * q);
    paint(body, (p) => {
      let c: Vec3 = mix([0.11, 0.02, 0.13], [0.06, 0.01, 0.08], fbm(p[0] * 2.5, p[1] * 2.5, p[2] * 2.5));
      // ガクに覆われていた首は白っぽい
      const band = smooth(Y1 - 0.42, Y1 - 0.28, p[1] + 0.05 * Math.sin(Math.atan2(p[2], p[0]) * 5));
      c = mix(c, mix([0.62, 0.42, 0.62], [0.82, 0.86, 0.66], smooth(Y1 - 0.34, Y1 - 0.2, p[1])), band * 0.9);
      c = mix(c, [0.58, 0.68, 0.42], smooth(Y1 - 0.12, Y1, p[1]) * 0.7);
      return c;
    });

    // ヘタ：首を包む 5 枚のガク（反り返る先がとがった帯）と、太い軸
    const parts: MeshData[] = [];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      parts.push(
        buildRibbon(
          (t) => {
            const y = Y1 - 0.04 - 0.48 * t;
            const [ax, az] = shape.axis(y);
            const R = shape.radius(y, a) + 0.012 + 0.05 * t * t;
            return [ax + R * ca, y, az + R * sa];
          },
          (t) => 0.12 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - 0.6 * t),
          () => 0.012,
          () => [ca, 0, sa],
          14,
          10,
        ),
      );
    }
    const top = shape.axis(Y1);
    parts.push(buildTube((t) => [top[0] - 0.02 + 0.04 * t, Y1 - 0.12 + 0.38 * t + 0.04 * Math.sin(t * 3), top[1] + 0.03 * t], (t) => 0.075 - 0.02 * t, 10, 12));
    parts.push(buildTube((t) => [top[0], Y1 - 0.1 + 0.1 * t, top[1]], () => 0.17, 4, 20)); // ガクの付け根
    const extras = mergeMeshes(parts);
    // 紫がかった黒に、灰色の細かな毛（とげ）の白っぽさ
    paint(extras, (p) => mix([0.16, 0.1, 0.16], [0.3, 0.24, 0.3], fbm(p[0] * 9, p[1] * 9, p[2] * 9)));

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const L = shape.local(x, y, z);
      const s = L.s;
      if (s > 0.985) return [0.25, 0.06, 0.26];
      if (s > 0.96) return mix([0.86, 0.9, 0.7], [0.62, 0.48, 0.62], smooth(0.96, 0.985, s));
      let c: Vec3 = mix([0.94, 0.92, 0.8], [0.88, 0.9, 0.72], smooth(0.3, 0.96, s));
      c = mix(c, [0.98, 0.97, 0.88], 0.3 * fbm(x * 14, y * 14, z * 14)); // スポンジ状のムラ
      // 種：下のふくらみの、軸の周りの層に小さな点
      // 種：軸の周りの帯に、長さ方向に並ぶ小さな平たい点（周りの果肉は少し黄ばむ）
      const seedZone = smooth(0.12, 0.28, s) * (1 - smooth(0.58, 0.72, s)) * smooth(0.75, 0.2, y);
      if (seedZone > 0.05) {
        c = mix(c, [0.9, 0.84, 0.64], seedZone * 0.5);
        const cs = cell3(x * 11, y * 6, z * 11);
        if (cs.d < 0.3 && cs.id < 0.8) c = mix(c, cs.d < 0.18 ? [0.5, 0.36, 0.16] : [0.78, 0.66, 0.4], seedZone);
      }
      // 中心の筋
      if (s < 0.12) c = mix(c, [0.88, 0.9, 0.7], 0.5);
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.7, 0.78, 0.5] };
  },
};
