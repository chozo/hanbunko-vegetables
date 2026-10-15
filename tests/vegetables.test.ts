import { describe, expect, it } from 'vitest';
import { cutMesh, type PlaneDef } from '../src/geometry/cut';
import { signedVolume, type MeshData, type Vec3 } from '../src/geometry/mesh';
import { rng } from '../src/vegetables/common';
import { VEGETABLES } from '../src/vegetables';
import { Euler, Matrix4, Vector3 } from 'three';
import { closedVolume } from './helpers';

function bounds(mesh: MeshData): { c: Vec3; r: number } {
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], p[i + k]);
    max[k] = Math.max(max[k], p[i + k]);
  }
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { c, r: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 };
}

/** 野菜を通る平面（中心付近を通るものが多くなるように） */
function planes(mesh: MeshData, seed: number, count: number): PlaneDef[] {
  const { c, r } = bounds(mesh);
  const rnd = rng(seed);
  const out: PlaneDef[] = [];
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const n: Vec3 = [s * Math.cos(a), u, s * Math.sin(a)];
    const off = (rnd() * 2 - 1) * r * 0.5;
    out.push({ n, c: -(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) + off });
  }
  return out;
}

describe.each(VEGETABLES.map((f) => [f.name, f] as const))('%s', (_name, def) => {
  const model = def.build(1);
  const V = signedVolume(model.body);

  it('体積が正で、切断の前後で保存され、断面がかけらを閉じる', () => {
    expect(V).toBeGreaterThan(0);
    let worstCons = 0, worstCap = 0;
    for (const pl of planes(model.body, 3, 40)) {
      const res = cutMesh(model.body, pl);
      worstCons = Math.max(worstCons, Math.abs(res.pos.volume + res.neg.volume - V) / V);
      worstCap = Math.max(worstCap, Math.abs(closedVolume(res.pos) - res.pos.volume) / V, Math.abs(closedVolume(res.neg) - res.neg.volume) / V);
    }
    // 保存誤差・断面の閉じ具合とも 0.001% 未満
    expect(worstCons * 100).toBeLessThan(1e-3);
    expect(worstCap * 100).toBeLessThan(1e-3);
  });

  it('メッシュを2倍細かくしても体積比の差は 0.1% 未満（1%判定に十分な精度）', () => {
    const fine = def.build(2);
    const Vf = signedVolume(fine.body);
    let worst = 0;
    for (const pl of planes(model.body, 17, 30)) {
      const a = (cutMesh(model.body, pl, false).pos.volume / V) * 100;
      const b = (cutMesh(fine.body, pl, false).pos.volume / Vf) * 100;
      worst = Math.max(worst, Math.abs(a - b));
    }
    console.log(`${def.name}: 解像度による体積比の最大差 ${worst.toFixed(4)}%`);
    expect(worst).toBeLessThan(0.1);
  });
});

describe('空洞のある野菜（ピーマン）', () => {
  it.each(['pepper'])('%s：空洞は外形の内側にあり、輪切りの断面に穴が出る', (id) => {
    const def = VEGETABLES.find((v) => v.id === id)!;
    const model = def.build(1);
    const V = signedVolume(model.body);
    // 空洞の分だけ体積が減っている（外形の体積より小さい）。空洞が外へ突き抜けると切断で閉じない断面ができる
    const { c } = bounds(model.body);
    // 長い軸（y）に垂直な平面で、中ほどを切る
    const pl: PlaneDef = { n: [0, 1, 0], c: -(c[1] + 0.1) };
    const res = cutMesh(model.body, pl);
    expect(res.pos.volume + res.neg.volume).toBeCloseTo(V, 9);
    expect(res.loopCount).toBeGreaterThan(1);
    expect(Math.abs(closedVolume(res.pos) - res.pos.volume) / V).toBeLessThan(1e-5);
  });
});

describe('初期姿勢のまま中心を縦・横に切ると 1% を超えてずれる（観察が必要）', () => {
  it.each(VEGETABLES.map((v) => [v.name, v] as const))('%s', (_n, def) => {
    const model = def.build(1);
    const V = signedVolume(model.body);
    const { c } = boxCenter(model.body);
    const inv = new Matrix4().makeRotationFromEuler(new Euler(...def.initialRotation)).invert();
    const errs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)].map((nw) => {
      const n = nw.applyMatrix4(inv).normalize();
      const pl: PlaneDef = { n: [n.x, n.y, n.z], c: -(n.x * c[0] + n.y * c[1] + n.z * c[2]) };
      return Math.abs((cutMesh(model.body, pl, false).pos.volume / V) * 100 - 50);
    });
    console.log(`${def.name}: 縦 ${errs[0].toFixed(2)}% / 横 ${errs[1].toFixed(2)}%`);
    expect(Math.min(...errs)).toBeGreaterThan(1.0);
  });
});

/** ゲームの回転中心（本体のバウンディングボックスの中心） */
function boxCenter(mesh: MeshData): { c: Vec3 } {
  return { c: bounds(mesh).c };
}
