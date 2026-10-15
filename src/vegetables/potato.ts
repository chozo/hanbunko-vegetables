import { StarShape, mul3, paint, rotZ3, scale3, type Vec3 } from '../geometry/mesh';
import { fbm, fibDirs, mix, rng, smooth, vnoise, type VegDef } from './common';

// じゃがいも：でこぼこした楕円体。片方の端が太く、芽のくぼみ（目）が散らばる。
// 断面は皮のすぐ内側の維管束の輪と、中心の少し透けた髄。

const r0 = rng(31);
/** 芽のくぼみの方向 */
const EYES = fibDirs(14).map((d) => {
  const j: Vec3 = [d[0] + (r0() - 0.5) * 0.4, d[1] + (r0() - 0.5) * 0.4, d[2] + (r0() - 0.5) * 0.4];
  const l = Math.hypot(j[0], j[1], j[2]);
  return [j[0] / l, j[1] / l, j[2] / l] as Vec3;
});

const shape = new StarShape(
  (dx, dy, dz) => {
    let r = 1 + 0.07 * (vnoise(dx * 1.6 + 3, dy * 1.6, dz * 1.6) - 0.5) * 2 + 0.03 * (vnoise(dx * 4, dy * 4 + 7, dz * 4) - 0.5) * 2;
    // 片方の端（+x）が太く、反対側は少し細い
    r += 0.14 * (dx * dx * dx - 0.5 * dx);
    r += 0.04 * dy * dx;
    for (const e of EYES) {
      const c = dx * e[0] + dy * e[1] + dz * e[2];
      if (c > 0.985) r -= 0.025 * smooth(0.985, 0.999, c);
    }
    return r;
  },
  mul3(rotZ3(0.12), scale3(1.05, 0.66, 0.76)),
);

export const potato: VegDef = {
  id: 'potato',
  name: 'じゃがいも',
  skin: {
    roughness: 0.82,
    bumpScale: 0.6,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 皮目（ごく小さな茶色の点）と、薄い網目・ムラ
        vec2 w = worley(p * 28.0);
        float dotm = 1.0 - smoothstep(0.03, 0.08, w.x);
        float net = smoothstep(0.55, 0.75, fbm(p * 9.0));
        col = mix(col, col * vec3(0.78, 0.7, 0.58), net * 0.35);
        col = mix(col, col * vec3(0.45, 0.35, 0.25), dotm * 0.45);
        col *= 0.92 + 0.14 * vnoise(p * 30.0);
        bump = dotm * 0.4 + net * 0.2;
      }`,
  },
  extrasRoughness: 0.8,
  capRoughness: 0.42,
  glow: 0xfff0a0,
  palette: [0xffe680, 0xfff6c8, 0xc89a5a, 0xffb84a],
  initialRotation: [0.65, 0.7, 0.35],
  sound: 'crisp',
  build(q = 1) {
    const body = shape.build(144 * q, 96 * q);
    paint(body, (p) => {
      const qq = shape.toShapeSpace(p[0], p[1], p[2]);
      const l = Math.hypot(qq[0], qq[1], qq[2]);
      const d: Vec3 = [qq[0] / l, qq[1] / l, qq[2] / l];
      let c: Vec3 = mix([0.78, 0.64, 0.4], [0.64, 0.5, 0.28], fbm(p[0] * 3 + 1, p[1] * 3, p[2] * 3));
      // 芽のくぼみは暗く、周りが少し赤っぽい
      for (const e of EYES) {
        const cc = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
        if (cc > 0.975) {
          // 芽の跡は小さく浅い。周りはわずかに暗い
          c = mix(c, [0.58, 0.44, 0.26], smooth(0.985, 0.996, cc) * 0.3);
          c = mix(c, [0.42, 0.3, 0.16], smooth(0.997, 0.9995, cc) * 0.7);
        }
      }
      return c;
    });

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const s = shape.depth(x, y, z);
      if (s > 0.98) return [0.62, 0.46, 0.26];
      if (s > 0.955) return mix([0.98, 0.9, 0.62], [0.92, 0.82, 0.52], smooth(0.955, 0.98, s));
      let c: Vec3 = mix([0.99, 0.94, 0.7], [0.98, 0.91, 0.62], smooth(0.3, 0.95, s));
      c = mix(c, [1.0, 0.96, 0.78], 0.25 * fbm(x * 10, y * 10, z * 10));
      // 維管束の輪（皮の内側の細い線）
      const ring = s + 0.03 * (fbm(x * 5, y * 5, z * 5) - 0.5);
      c = mix(c, [0.94, 0.86, 0.56], Math.exp(-(((ring - 0.88) / 0.01) ** 2)) * 0.5);
      // 髄（中心の少し透けた部分、枝分かれしながら芽の方へ伸びる）
      const qq = shape.toShapeSpace(x, y, z);
      const pith = 0.42 + 0.12 * (fbm(qq[0] * 4 + 2, qq[1] * 4, qq[2] * 4) - 0.5) * 2;
      if (s < pith) c = mix(c, [0.96, 0.92, 0.74], smooth(pith, pith - 0.06, s) * 0.7);
      return c;
    };
    return { body, extras: null, flesh, extrasCapColor: [0.8, 0.7, 0.5] };
  },
};
