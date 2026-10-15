import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { CutResult } from '../geometry/cut';
import type { VegDef, VegModel } from '../vegetables/common';

export const GLSL_NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s / 0.9375;
  }
  // x: 最も近い点までの距離, y: 二番目
  vec2 worley(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash33(i + g);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return vec2(d1, d2);
  }
`;

/** 野菜の皮。頂点色に GLSL の細かな模様と凹凸を重ねる */
export function makeSkinMaterial(def: VegDef): MeshPhysicalMaterial {
  const s = def.skin;
  const mat = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: s.roughness,
    metalness: 0,
    clearcoat: s.clearcoat ?? 0,
    clearcoatRoughness: s.clearcoatRoughness ?? 0.3,
    sheen: s.sheen ?? 0,
    sheenColor: new Color(s.sheenColor ?? 0xffffff),
    sheenRoughness: 0.6,
    envMapIntensity: 0.9,
  });
  const bumpScale = s.bumpScale;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLpos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLpos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        // skinDetail は gCoat（つやの強さ）と gRough（粗さの下限）を変えてよい
        `#include <common>\nvarying vec3 vLpos;\nfloat gBump = 0.0;\nfloat gCoat = 1.0;\nfloat gRough = 0.0;\n${GLSL_NOISE}\n${s.glsl}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        { vec3 c = diffuseColor.rgb; float b = 0.0; skinDetail(vLpos, c, b); diffuseColor.rgb = c; gBump = b; }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, gRough);')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= gCoat;\n#endif',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float h = gBump * ${bumpScale.toFixed(3)} * 0.01;
          vec3 sp = -vViewPosition;
          vec3 sx = dFdx(sp), sy = dFdy(sp);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'skin-' + def.id;
  return mat;
}

export function makeExtrasMaterial(def: VegDef): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, roughness: def.extrasRoughness, metalness: 0 });
}

/** 断面の材質。テクスチャは本来の果肉、emissive は切断直後の発光 */
export function makeCapMaterial(map: Texture | null, def: VegDef, color?: Color): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map,
    color: color ?? new Color(0xffffff),
    roughness: def.capRoughness,
    metalness: 0,
    emissive: new Color(def.glow),
    emissiveIntensity: 0,
    // 環境マップの明るい照明が映り込むとブルームが出続けるので弱める
    envMapIntensity: 0.25,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
}

/**
 * 断面テクスチャを作る。断面の 2D 範囲をピクセルに区切り、各点の果肉の色を野菜の定義から求める。
 * 断面の形（メッシュ）と模様（関数）は同じ形状定義から来ているので、皮の厚みや芯の位置が一致する。
 */
export function makeCapTexture(res: CutResult, model: VegModel, maxSize: number): DataTexture {
  const b = res.bounds;
  const spanX = Math.max(1e-6, b.maxX - b.minX);
  const spanY = Math.max(1e-6, b.maxY - b.minY);
  const k = maxSize / Math.max(spanX, spanY);
  const W = Math.max(8, Math.round(spanX * k));
  const H = Math.max(8, Math.round(spanY * k));
  const data = new Uint8Array(W * H * 4);
  const [ox, oy, oz] = res.origin;
  const [ux, uy, uz] = res.u;
  const [wx, wy, wz] = res.w;
  for (let r = 0; r < H; r++) {
    const Y = b.minY + ((r + 0.5) / H) * spanY;
    for (let c = 0; c < W; c++) {
      const X = b.minX + ((c + 0.5) / W) * spanX;
      const col = model.flesh(ox + ux * X + wx * Y, oy + uy * X + wy * Y, oz + uz * X + wz * Y);
      const o = (r * W + c) * 4;
      data[o] = col[0] * 255;
      data[o + 1] = col[1] * 255;
      data[o + 2] = col[2] * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
