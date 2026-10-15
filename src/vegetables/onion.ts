import { StarShape, buildTube, mergeMeshes, mul3, paint, rotZ3, scale3, type MeshData, type Vec3 } from '../geometry/mesh';
import { buildRibbon, fbm, mix, rng, smooth, type VegDef } from './common';

// 玉ねぎ：少しつぶれた球で、上は短い首へすぼまり、底は根の付いた平たい盤（底盤）。片側の肩が張り出す。
// 断面は同心の層（りん片）。上の乾いた首と下のひげ根は体積から除外する。

const shape = new StarShape(
  (dx, dy, dz) => {
    const th = Math.acos(Math.max(-1, Math.min(1, dy)));
    const ph = Math.atan2(dz, dx);
    const s = Math.sin(th);
    let r = 0.95 + 0.06 * s;
    r += 0.2 * Math.exp(-((th / 0.3) ** 2)); // 短くすぼまる首
    r -= 0.16 * Math.exp(-(((Math.PI - th) / 0.45) ** 2)); // 平たい底
    // 片側の張り出し
    const t = dx * 0.6 + dz * 0.8;
    r += 0.12 * (t * t * t - 0.55 * t) * s;
    // +x 側の上下の肩が角ばってふくらむ（真横の幅は変えずに、重さを片側へ寄せる）
    r += 0.24 * Math.max(0, dx) * Math.abs(dy) * s;
    r += 0.025 * Math.cos(3 * ph + 0.7) * s * s;
    return r;
  },
  mul3(rotZ3(-0.06), scale3(1, 0.8, 0.98)),
);

/** 層の境目：中心からの深さ s を 0..1 の層番号のずれに。底盤に向かって層が集まるよう、下側ほど少し詰める */
function layerCoord(s: number, qy: number): number {
  return s * (8.5 + 1.5 * qy) + 0.15 * Math.sin(qy * 3);
}

export const onion: VegDef = {
  id: 'onion',
  name: '玉ねぎ',
  skin: {
    roughness: 0.55,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
    bumpScale: 0.25,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        // 縦に走る細い筋（乾いた薄皮）
        vec3 d = normalize(p);
        float ang = atan(d.z, d.x);
        float v = sin(ang * 46.0 + fbm(p * 3.0) * 7.0 + d.y * 2.0);
        float vein = smoothstep(0.75, 1.0, v);
        col = mix(col, col * vec3(0.7, 0.55, 0.38), vein * 0.5);
        // 薄皮がはがれて白い身が見える部分
        float peel = smoothstep(0.7, 0.76, fbm(p * 3.2 + 4.0));
        col = mix(col, col * vec3(1.5, 1.45, 1.3), peel * 0.4);
        col *= 0.92 + 0.14 * vnoise(p * 24.0);
        bump = vein * 0.4 - peel * 0.3;
      }`,
  },
  extrasRoughness: 0.85,
  capRoughness: 0.24,
  glow: 0xfff3c8,
  palette: [0xfff3c8, 0xffcf70, 0xc07a30, 0xffffff],
  initialRotation: [0.3, 2.2, 0.1],
  sound: 'crisp',
  build(q = 1) {
    const body = shape.build(144 * q, 104 * q);
    paint(body, (p) => {
      const qq = shape.toShapeSpace(p[0], p[1], p[2]);
      let c: Vec3 = mix([0.78, 0.48, 0.2], [0.62, 0.34, 0.13], fbm(p[0] * 2.5 + 2, p[1] * 2.5, p[2] * 2.5));
      c = mix(c, [0.5, 0.28, 0.1], smooth(0.6, 1.1, qq[1]) * 0.6); // 首は濃い
      c = mix(c, [0.7, 0.55, 0.35], smooth(-0.6, -0.95, qq[1]) * 0.6); // 底は薄い
      return c;
    });

    const top = shape.surfacePoint(0, 1, 0);
    const bottom = shape.surfacePoint(0, -1, 0);
    // 乾いた首：ねじれた薄い帯が数枚
    const neck: MeshData[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      neck.push(
        buildRibbon(
          (t) => [top[0] + 0.03 * Math.cos(a) + 0.08 * t * t, top[1] - 0.08 + 0.28 * t, top[2] + 0.03 * Math.sin(a) + 0.04 * Math.sin(t * 3 + a)],
          (t) => 0.07 * (1 - 0.7 * t),
          () => 0.008,
          (t) => [Math.cos(a + t * 2), 0, Math.sin(a + t * 2)],
          10,
          8,
        ),
      );
    }
    // ひげ根：底盤から放射状に垂れる細い根
    const r = rng(7);
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const d0 = 0.04 + r() * 0.1;
      const len = 0.12 + r() * 0.18;
      const sx = Math.cos(a), sz = Math.sin(a);
      const w = r() * 6;
      neck.push(
        buildTube(
          (t) => [bottom[0] + sx * (d0 + 0.25 * t * len * 2), bottom[1] + 0.04 - len * t, bottom[2] + sz * (d0 + 0.25 * t * len * 2) + 0.02 * Math.sin(w + t * 6)],
          (t) => 0.011 - 0.004 * t,
          6,
          5,
        ),
      );
    }
    neck.push(buildTube((t) => [bottom[0], bottom[1] + 0.06 - 0.07 * t, bottom[2]], () => 0.11, 4, 14)); // 底盤の外側
    const extras = mergeMeshes(neck);
    paint(extras, (p) => (p[1] > 0 ? mix([0.6, 0.42, 0.22], [0.66, 0.54, 0.34], smooth(top[1], top[1] + 0.3, p[1])) : [0.78, 0.68, 0.5]));

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const s = shape.depth(x, y, z);
      if (s > 0.985) return [0.66, 0.4, 0.16];
      const qq = shape.toShapeSpace(x, y, z);
      // 底盤（根の付く固い部分）
      const rho = Math.hypot(qq[0], qq[2]);
      if (qq[1] < -0.72 && rho < 0.38 - 0.4 * (qq[1] + 0.72)) return mix([0.9, 0.86, 0.68], [0.82, 0.76, 0.55], fbm(x * 20, y * 20, z * 20));
      const L = layerCoord(s, qq[1]);
      const f = L - Math.floor(L);
      // 層ごとにわずかに色が違い、境目は薄い膜で透ける
      const layer = Math.floor(L);
      let c: Vec3 = mix([0.99, 0.98, 0.9], [0.96, 0.95, 0.8], ((layer * 0.37) % 1) * 0.6 + smooth(0.3, 0.98, s) * 0.4);
      c = mix(c, [0.93, 0.95, 0.8], smooth(0.8, 0.98, s) * 0.5); // 外側の層は少し黄緑
      const edge = Math.min(f, 1 - f);
      c = mix(c, [0.8, 0.8, 0.6], (1 - smooth(0.025, 0.09, edge)) * 0.9);
      // 中心の芽（若い層）は黄緑
      if (s < 0.14) c = mix(c, [0.86, 0.92, 0.62], smooth(0.14, 0.06, s));
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.85, 0.75, 0.55] };
  },
};
