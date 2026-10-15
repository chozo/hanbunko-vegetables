import { buildTube, paint, type Vec3 } from '../geometry/mesh';
import { Revolve, capEnd, fbm, mix, smooth, vnoise, type VegDef } from './common';

// 白菜：縦長で、上の方が太い。下は白く太い葉の軸（中肋）、上はちぢれた緑の葉。
// 少し傾いて片側が張っている。断面は巻いた葉の層（上は緑、下は白）と、底の芯。底の切り口は体積から除外する。

const Y0 = -1.35;
const Y1 = 1.35;

const axis = (y: number): [number, number] => {
  const u = (y - Y0) / (Y1 - Y0);
  return [0.1 * u * u, -0.03 * u];
};

const shape = new Revolve(
  Y0,
  Y1,
  (y, ph) => {
    const u = (y - Y0) / (Y1 - Y0);
    // 上の方が太い（高さの真ん中で横に切っても半分にならない）
    let r = 0.42 + 0.22 * smooth(0.0, 0.75, u) - 0.05 * smooth(0.8, 1.0, u);
    r *= capEnd(y - Y0, 0.22) * capEnd(Y1 - y, 0.42);
    // 外葉の重なりの段差と片側の張り出し
    r *= 1 + 0.035 * Math.sin(3 * ph + u * 2.2) + 0.05 * Math.cos(ph - 0.9) * smooth(0.3, 0.9, u);
    // 上の葉はちぢれてでこぼこ
    r *= 1 + 0.1 * smooth(0.55, 0.95, u) * (vnoise(Math.cos(ph) * 2.2 + 4, y * 2.6, Math.sin(ph) * 2.2) - 0.5) * 2;
    return r;
  },
  axis,
);

/** 緑と白の境目の高さ（方向でゆらぐ） */
function greenLine(ph: number): number {
  return 0.25 + 0.18 * Math.sin(3 * ph + 0.5) + 0.08 * Math.sin(7 * ph);
}

export const hakusai: VegDef = {
  id: 'hakusai',
  name: '白菜',
  skin: {
    roughness: 0.42,
    clearcoat: 0.55,
    clearcoatRoughness: 0.3,
    bumpScale: 1.1,
    glsl: /* glsl */ `
      void skinDetail(vec3 p, inout vec3 col, out float bump) {
        float a = atan(p.z, p.x);
        float green = smoothstep(1.2, 1.8, col.g / max(col.r, 0.01));
        // 白い中肋の縦すじ（細い筋が密に並ぶ）
        vec2 cs = normalize(p.xz + 1e-5);
        float rib = vnoise(vec3(cs.x * 9.0, p.y * 0.8, cs.y * 9.0));
        // 外葉の重なりの縁：縦に走る段差（その縁の下は影）
        float lf = fract(a * 6.0 / 6.28318 + 0.25 * sin(p.y * 2.0 + a));
        float lap = 1.0 - smoothstep(0.0, 0.05, lf);
        // 緑の葉のちりめん：小さなふくらみが並び、すき間は暗い
        vec2 w = worley(p * 13.0);
        float cr = smoothstep(0.05, 0.5, w.x);
        col *= 0.94 + 0.1 * rib * (1.0 - green);
        col *= mix(1.0, 0.72 + 0.32 * cr, green);
        col *= 1.0 - 0.3 * lap;
        // 縁へ枝分かれする白い葉脈
        float vein = smoothstep(0.92, 1.0, sin(a * 11.0 + p.y * 7.0 + fbm(p * 6.0) * 4.0)) * green;
        col = mix(col, col * vec3(1.5, 1.35, 1.7), vein * 0.6);
        bump = mix(rib * 0.6, cr * 1.2, green) + vein * 0.5 - lap * 0.6;
      }`,
  },
  extrasRoughness: 0.6,
  capRoughness: 0.3,
  glow: 0xf2ffd0,
  palette: [0xffffff, 0xb8e87a, 0xfff8c8, 0x5aa03a],
  initialRotation: [0.15, 0.8, 1.2],
  sound: 'leafy',
  build(q = 1) {
    const body = shape.build(150 * q, 112 * q);
    paint(body, (p) => {
      const [ax, az] = axis(p[1]);
      const ph = Math.atan2(p[2] - az, p[0] - ax);
      const g = smooth(greenLine(ph) - 0.1, greenLine(ph) + 0.15, p[1]);
      let c: Vec3 = mix([0.95, 0.95, 0.86], [0.88, 0.9, 0.72], fbm(p[0] * 3, p[1] * 3, p[2] * 3) * 0.6);
      // 緑の葉の中にも白い中肋が上へ伸びる（先へ行くほど細い）
      const rib = smooth(0.82 + 0.12 * smooth(greenLine(ph), Y1, p[1]), 1.0, Math.cos(5 * ph + 0.4 + 0.3 * Math.sin(p[1] * 3)));
      // 写真の白菜は淡い黄緑（濃い緑ではない）
      const leaf = mix(mix([0.6, 0.76, 0.32], [0.74, 0.84, 0.42], fbm(p[0] * 4 + 3, p[1] * 4, p[2] * 4)), [0.9, 0.93, 0.74], rib * 0.85);
      c = mix(c, leaf, g);
      c = mix(c, [0.86, 0.84, 0.66], smooth(Y0 + 0.25, Y0, p[1]) * 0.7);
      return c;
    });

    const [bx, bz] = axis(Y0);
    const extras = buildTube((t) => [bx, Y0 + 0.14 - 0.18 * t, bz], (t) => 0.15 - 0.02 * t, 6, 16);
    paint(extras, () => [0.88, 0.86, 0.7]);

    const flesh = (x: number, y: number, z: number): Vec3 => {
      const L = shape.local(x, y, z);
      // 芯
      const coreTop = Y0 + 0.55;
      if (y < coreTop && L.rho < 0.16 * (1 - smooth(Y0, coreTop, y)) + 0.03) return [0.95, 0.94, 0.8];
      if (L.s > 0.985) return y > greenLine(L.ph) ? [0.56, 0.72, 0.3] : [0.92, 0.92, 0.82];
      // 巻いた葉の層
      const k = L.s * 9 + 0.8 * (fbm(x * 2.5, y * 0.8, z * 2.5) - 0.5) * 2;
      const f = k - Math.floor(k);
      const edge = Math.min(f, 1 - f);
      // 上の外側は緑の葉、内側は黄色っぽい、下は白い中肋
      const g = smooth(greenLine(L.ph) - 0.3, greenLine(L.ph) + 0.25, y) * smooth(0.35, 0.8, L.s);
      let c: Vec3 = mix([0.98, 0.98, 0.9], [0.98, 0.95, 0.68], smooth(0.5, 0.0, L.s) * smooth(-0.3, 0.6, y));
      c = mix(c, [0.72, 0.84, 0.44], g);
      c = mix(c, [0.74, 0.78, 0.58], (1 - smooth(0.03, 0.12, edge)) * 0.8);
      // 中肋の中の細い筋（下の白い部分）
      if (g < 0.5 && fbm(x * 30, y * 4, z * 30) > 0.68) c = mix(c, [0.9, 0.92, 0.78], 0.5);
      return c;
    };
    return { body, extras, flesh, extrasCapColor: [0.94, 0.93, 0.8] };
  },
};
