import { describe, expect, it } from 'vitest';
import { cutMesh, type PlaneDef } from '../src/geometry/cut';
import { StarShape, signedVolume, type MeshData, type Vec3 } from '../src/geometry/mesh';
import { rng } from '../src/vegetables/common';
import { closedVolume } from './helpers';

function randomPlane(r: () => number, spread = 0.5): PlaneDef {
  const u = r() * 2 - 1, a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  const n: Vec3 = [s * Math.cos(a), u, s * Math.sin(a)];
  return { n, c: (r() * 2 - 1) * spread };
}


describe('切断と体積（解析解との比較）', () => {
  const sphere = new StarShape(() => 1).build(144, 96);
  const V = signedVolume(sphere);

  it('球のメッシュ体積は 4/3π に近い', () => {
    expect(Math.abs(V / ((4 / 3) * Math.PI) - 1)).toBeLessThan(0.002);
  });

  it('高さ h で切った球冠の割合が解析解と 0.05% 以内で一致', () => {
    for (const h of [-0.8, -0.5, -0.2, 0, 0.13, 0.37, 0.66, 0.9]) {
      const res = cutMesh(sphere, { n: [0.3, 0.9, 0.316].map((x) => x / Math.hypot(0.3, 0.9, 0.316)) as Vec3, c: -h });
      // 正側 = n·p > h の球冠: π(1-h)^2(2+h)/3
      const cap = (Math.PI * (1 - h) ** 2 * (2 + h)) / 3;
      const exact = (cap / ((4 / 3) * Math.PI)) * 100;
      expect(Math.abs((res.pos.volume / V) * 100 - exact)).toBeLessThan(0.05);
    }
  });
});

function checkConservation(mesh: MeshData, seed: number, count = 40) {
  const r = rng(seed);
  const V = signedVolume(mesh);
  let worstCons = 0, worstCap = 0;
  for (let i = 0; i < count; i++) {
    const res = cutMesh(mesh, randomPlane(r));
    worstCons = Math.max(worstCons, Math.abs(res.pos.volume + res.neg.volume - V) / V);
    if (!res.pos.empty && !res.neg.empty) {
      worstCap = Math.max(
        worstCap,
        Math.abs(closedVolume(res.pos) - res.pos.volume) / V,
        Math.abs(closedVolume(res.neg) - res.neg.volume) / V,
      );
    }
  }
  return { worstCons, worstCap };
}

describe('凹みのある形でも体積が保存され、断面が閉じる', () => {
  it('上下にくぼみのある球', () => {
    const dimpled = new StarShape((_x, dy) => 1 - 0.45 * Math.exp(-(((Math.acos(dy)) / 0.3) ** 2))).build(96, 64);
    const { worstCons, worstCap } = checkConservation(dimpled, 7, 60);
    expect(worstCons).toBeLessThan(1e-6);
    expect(worstCap).toBeLessThan(1e-5);
  });
});
