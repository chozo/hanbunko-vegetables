import { StarShape, buildTube, mul3, paint, rotX3, scale3, type Vec3 } from '../geometry/mesh';
import { fbm, mix, smooth, vnoise, type VegDef } from './common';

// キャベツ：葉が何重にも巻いたやや扁平な球。表面には外葉の太い葉脈が底の芯から放射状に走る。
// 断面は波打つ葉の層と、底から伸びる白い芯。底の芯の切り口は体積から除外する。

const shape = new StarShape(
  (dx, dy, dz) => {
    const th = Math.acos(Math.max(-1, Math.min(1, dy)));
    const ph = Math.atan2(dz, dx);
    const s = Math.sin(th);
    let r = 1 + 0.05 * (vnoise(dx * 2 + 5, dy * 2, dz * 2) - 0.5) * 2;
    // 外葉の重なりの段差
    r += 0.025 * Math.sin(3 * ph + 2.5 * dy) * s;
    r -= 0.1 * Math.exp(-(((Math.PI - th) / 0.35) ** 2)); // 底のくぼみ
    // 上が片側へ張り出す
    const t = dx * 0.5 + dy * 0.55 + dz * 0.67;
    r += 0.2 * (t * t * t - 0.55 * t);
    return r;
  },
  mul3(rotX3(-0.08), scale3(1, 0.86, 0.96)),
);

/** 葉の層の座標。断面に波打つ層の線を描く */
function leafLayer(s: number, x: number, y: number, z: number): number {
  return s * 13 + 1.6 * (fbm(x * 2.2 + 1, y * 2.2, z * 2.2) - 0.5) * 2;
}

export const cabbage: VegDef = {
  id: 'cabbage',
  name: 'キャベツ',
  skin: {
    roughness: 0.5,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    bumpScale: 1.0,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 底から放射状に伸びて枝分かれする葉脈
        vec3 d = normalize(p - vec3(0.0, -0.9, 0.0));
        float ang = atan(d.z, d.x);
        float wob = fbm(p * 2.0) * 3.0;
        // 太い中肋（下ほど太い）と、そこから枝分かれする細い葉脈
        float main = smoothstep(0.84 + 0.1 * smoothstep(-0.6, 0.6, p.y), 1.0, cos(ang * 7.0 + wob));
        float sub = smoothstep(0.88, 1.0, cos(ang * 23.0 + wob * 2.0 + p.y * 9.0)) * 0.6;
        float vein = max(main, sub * smoothstep(-0.4, 0.4, p.y));
        col = mix(col, col * vec3(1.8, 1.55, 1.9) + vec3(0.05), vein * 0.75);
        // 外葉のふちの重なり（少し暗い段）
        float lw = sin(ang * 3.0 + p.y * 2.5 + 1.2 + fbm(p * 1.5) * 1.5);
        float lap = smoothstep(0.0, 0.05, lw - 0.92);
        // 縁の少し手前は葉が反り返って明るい
        float lip = smoothstep(0.82, 0.9, lw) * (1.0 - lap);
        col *= 1.0 - 0.4 * lap;
        col *= 1.0 + 0.2 * lip;
        // 葉のちりめん状の凹凸
        float cr = fbm(p * 9.0);
        col *= 0.9 + 0.16 * cr;
        bump = vein * 0.9 + cr * 0.4 - lap * 0.6 + lip * 0.3;
      }`,
  },
  extrasRoughness: 0.55,
  capRoughness: 0.3,
  glow: 0xd0ff90,
  palette: [0x9fe06a, 0xe8ffc8, 0x5aa03a, 0xffffff],
  initialRotation: [0.65, 2.9, -0.05],
  sound: 'leafy',
  build(q = 1) {
    const body = shape.build(160 * q, 104 * q);
    paint(body, (p) => {
      const qq = shape.toShapeSpace(p[0], p[1], p[2]);
      let c: Vec3 = mix([0.42, 0.62, 0.32], [0.56, 0.72, 0.38], fbm(p[0] * 2 + 3, p[1] * 2, p[2] * 2));
      c = mix(c, [0.7, 0.82, 0.48], smooth(0.2, 0.95, qq[1]) * 0.5); // 上は淡い
      c = mix(c, [0.82, 0.86, 0.66], smooth(-0.7, -0.95, qq[1]) * 0.7); // 底は白っぽい
      return c;
    });

    const bottom = shape.surfacePoint(0, -1, 0);
    const extras = buildTube((t) => [bottom[0], bottom[1] + 0.12 - 0.2 * t, bottom[2]], (t) => 0.13 - 0.02 * t, 6, 16);
    paint(extras, () => [0.86, 0.88, 0.72]);

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const s = shape.depth(x, y, z);
      const qq = shape.toShapeSpace(x, y, z);
      // 芯：底から上へ伸びる円錐
      const rho = Math.hypot(qq[0], qq[2]);
      const coreR = 0.17 * (1 - smooth(-0.95, 0.25, qq[1])) + 0.02;
      if (qq[1] < 0.25 && rho < coreR) return mix([0.95, 0.95, 0.82], [0.88, 0.9, 0.7], smooth(coreR * 0.5, coreR, rho));
      if (s > 0.985) return [0.4, 0.62, 0.26];
      const L = leafLayer(s, x, y, z);
      const f = L - Math.floor(L);
      const edge = Math.min(f, 1 - f);
      // 外側の葉は緑、内側は淡い黄白色
      let c: Vec3 = mix([0.98, 0.98, 0.84], [0.82, 0.92, 0.6], smooth(0.55, 0.97, s));
      c = mix(c, [0.94, 0.96, 0.78], 0.3 * ((Math.floor(L) * 0.41) % 1));
      // 葉と葉のすき間（細い線）と、葉の中の太い葉脈
      c = mix(c, [0.68, 0.78, 0.5], (1 - smooth(0.03, 0.09, edge)) * 0.8);
      if (fbm(x * 6, y * 6, z * 6) > 0.66) c = mix(c, [1.0, 1.0, 0.92], 0.5);
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.93, 0.94, 0.8] };
  },
};
