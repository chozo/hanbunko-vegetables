import { StarShape, buildTube, mergeMeshes, mul3, paint, rotZ3, scale3, type Vec3 } from '../geometry/mesh';
import { cell3, ellipsoid, fbm, mix, seedColor, smooth, type VegDef } from './common';

// かぼちゃ（西洋かぼちゃ）：上下につぶれた球で、浅い縦の溝が並ぶ。片側が大きくふくらんでいる。
// 皮は濃い緑に灰緑のまだら、地面に接していた所は黄色。
// 断面は厚い皮、濃いオレンジの果肉、中央のわたと種（わたと種も体積に含める）。軸は体積から除外する。

const shape = new StarShape(
  (dx, dy, dz) => {
    const th = Math.acos(Math.max(-1, Math.min(1, dy)));
    const ph = Math.atan2(dz, dx);
    const s = Math.sin(th);
    let r = 1;
    // 縦の溝（10 本、深さは少しずつ違う）
    const g = (0.5 + 0.5 * Math.cos(10 * ph + 0.2 * Math.sin(3 * ph))) ** 10;
    r -= (0.04 + 0.015 * Math.sin(3 * ph)) * g * s ** 1.5;
    // 上下のくぼみ
    r -= 0.22 * Math.exp(-((th / 0.35) ** 2));
    r -= 0.12 * Math.exp(-(((Math.PI - th) / 0.32) ** 2));
    // 片側のふくらみ
    const t = dx * 0.9 + dz * 0.44;
    r += 0.2 * (t * t * t - 0.55 * t) * s;
    r += 0.02 * Math.cos(2 * ph + 0.8) * s;
    return r;
  },
  mul3(rotZ3(0.08), scale3(1, 0.7, 0.97)),
);

export const pumpkin: VegDef = {
  id: 'pumpkin',
  name: 'かぼちゃ',
  skin: {
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    bumpScale: 0.7,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 灰緑の細かなまだら（溝に沿って縦に流れる）と、小さなイボ
        vec2 cs = normalize(p.xz + 1e-5);
        vec3 q = vec3(cs.x * 3.0, p.y * 9.0, cs.y * 3.0);
        vec2 w0 = worley(vec3(cs.x * 9.0, p.y * 22.0, cs.y * 9.0));
        float fleck = (1.0 - smoothstep(0.1, 0.35, w0.x)) * smoothstep(0.35, 0.7, fbm(q + 3.0));
        col = mix(col, col * vec3(3.2, 2.0, 2.8), fleck * 0.6);
        vec2 w = worley(p * 34.0);
        float wart = 1.0 - smoothstep(0.03, 0.12, w.x);
        col = mix(col, col * 1.4, wart * 0.25);
        col *= 0.88 + 0.16 * vnoise(p * 50.0);
        bump = wart * 0.5 + fleck * 0.1;
      }`,
  },
  extrasRoughness: 0.9,
  capRoughness: 0.48,
  glow: 0xffa03a,
  palette: [0xff9a1a, 0xffd36a, 0x2f5a2a, 0xfff0c0],
  initialRotation: [0.85, 0, 0.35],
  sound: 'hard',
  build(q = 1) {
    const body = shape.build(176 * q, 104 * q);
    paint(body, (p) => {
      const qq = shape.toShapeSpace(p[0], p[1], p[2]);
      let c: Vec3 = mix([0.05, 0.13, 0.06], [0.03, 0.09, 0.04], fbm(p[0] * 2, p[1] * 2, p[2] * 2));
      // 地面に接していた黄色い部分
      c = mix(c, [0.78, 0.6, 0.18], smooth(0.6, 0.9, -qq[0] * 0.5 - qq[1] * 0.85) * 0.85);
      // 溝は少し暗い
      const ph = Math.atan2(qq[2], qq[0]);
      c = mix(c, [0.03, 0.08, 0.03], (0.5 + 0.5 * Math.cos(10 * ph)) ** 10 * 0.6);
      return c;
    });

    // 軸：コルク質の太い五角柱が少し曲がる
    const top = shape.surfacePoint(0, 1, 0);
    const parts = [
      buildTube((t) => [top[0] + 0.06 * t * t, top[1] - 0.08 + 0.32 * t, top[2] + 0.02 * t], (t) => 0.12 - 0.03 * t + 0.04 * Math.exp(-((t / 0.12) ** 2)), 10, 5),
    ];
    const extras = mergeMeshes(parts);
    paint(extras, (p) => mix([0.42, 0.44, 0.28], [0.7, 0.64, 0.46], smooth(top[1], top[1] + 0.25, p[1])));

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const s = shape.depth(x, y, z);
      // 皮：外は濃い緑、すぐ内側に薄い黄緑の層
      if (s > 0.982) return [0.08, 0.18, 0.08];
      if (s > 0.962) return mix([0.98, 0.7, 0.06], [0.62, 0.66, 0.18], smooth(0.962, 0.98, s));
      const qq = shape.toShapeSpace(x, y, z);
      // 果肉：鮮やかな黄橙。わたの近くは少し濃い
      let c: Vec3 = mix([0.98, 0.6, 0.02], [0.99, 0.72, 0.08], smooth(0.5, 0.95, s));
      c = mix(c, [1.0, 0.78, 0.2], 0.18 * fbm(x * 12, y * 12, z * 12));
      // わたと種の部屋：ふちが不規則な楕円体
      const wob = 0.22 * (fbm(qq[0] * 3 + 4, qq[1] * 3, qq[2] * 3) - 0.5);
      const e = ellipsoid(qq[0], qq[1], qq[2], 0.02, 0.0, 0.0, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.52, 0.44, 0.52) - wob;
      if (e < 1.15) c = mix(c, [0.96, 0.52, 0.0], smooth(1.15, 1.0, e) * 0.5);
      if (e < 1) {
        // 繊維質のわた：糸のような筋が中心から放射状に伸びる
        const l = Math.hypot(qq[0], qq[1], qq[2]) || 1e-9;
        const fib = fbm((qq[0] / l) * 9, (qq[1] / l) * 9, (qq[2] / l) * 9 + l * 2);
        c = mix([1.0, 0.72, 0.16], [0.88, 0.5, 0.04], smooth(0.35, 0.65, fib));
        if (e < 0.45) c = mix(c, [0.95, 0.68, 0.22], 0.4);
        // 種：わたの中に散らばる平たいしずく形
        if (e > 0.2) {
          const cs = cell3(qq[0] * 5.5, qq[1] * 7.5, qq[2] * 5.5);
          if (cs.id < 0.75) {
            const se = (cs.d / 0.34) ** 2;
            if (se < 1) c = seedColor(se, [0.98, 0.9, 0.7], [0.78, 0.64, 0.4]);
          }
        }
      }
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.86, 0.82, 0.6] };
  },
};
