// 切断結果の検算。ゲーム本体の切断処理（ローカル座標・辺の共有）とは別の実装で、
// ワールド座標に変換した三角形を平面で切り取り、片側の体積を求め直す。
import { Vector3 } from 'three';
import type { CutOutcome, VegObject } from './vegetableObject';
import type { View } from '../render/view';

export function worldVolumeCheck(
  veg: VegObject,
  o: CutOutcome,
  first: 0 | 1,
  S: { x: number; y: number },
  E: { x: number; y: number },
  view: View,
) {
  const mesh = veg.assets.model.body;
  const M = o.baseMatrix;
  const P = mesh.positions;
  const nv = P.length / 3;
  const W: Vector3[] = [];
  for (let i = 0; i < nv; i++) W.push(new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(M));
  const n = o.worldPlane.normal;
  const origin = n.clone().multiplyScalar(-o.worldPlane.constant);
  const dist = (p: Vector3) => o.worldPlane.distanceToPoint(p);
  let volPos = 0, volAll = 0;
  const tet = (a: Vector3, b: Vector3, c: Vector3) => {
    const x = a.clone().sub(origin), y = b.clone().sub(origin), z = c.clone().sub(origin);
    return x.dot(y.cross(z)) / 6;
  };
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [W[I[t]], W[I[t + 1]], W[I[t + 2]]];
    volAll += tet(tri[0], tri[1], tri[2]);
    // Sutherland–Hodgman で正側の多角形を取り出し、扇形に分割して体積を足す
    const poly: Vector3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const da = dist(a), db = dist(b);
      if (da >= 0) poly.push(a);
      if (da >= 0 !== db >= 0) poly.push(a.clone().lerp(b, da / (da - db)));
    }
    for (let k = 1; k + 1 < poly.length; k++) volPos += tet(poly[0], poly[k], poly[k + 1]);
  }
  const fracPos = (volPos / volAll) * 100;
  const fracFirstIndependent = o.pieces[first].side === 1 ? fracPos : 100 - fracPos;
  const fracFirstGame = (o.pieces[first].volume / o.totalVolume) * 100;

  // 断面の頂点（切断した瞬間の位置）が、画面上でスワイプの直線にどれだけ近いか（px）
  let maxLinePx = 0;
  const capPos = o.result.pos.cap.positions;
  const dx = E.x - S.x, dy = E.y - S.y;
  const len = Math.hypot(dx, dy);
  const savedScale = view.distanceScale;
  view.distanceScale = 1; // 切断した瞬間のカメラ位置で比べる
  view.updateCamera();
  for (let i = 0; i < capPos.length; i += 3 * 7) {
    const s = view.worldToScreen(new Vector3(capPos[i], capPos[i + 1], capPos[i + 2]).applyMatrix4(M));
    maxLinePx = Math.max(maxLinePx, Math.abs((s.x - S.x) * dy - (s.y - S.y) * dx) / len);
  }
  view.distanceScale = savedScale;
  view.updateCamera();
  return {
    fracFirstGame,
    fracFirstIndependent,
    diffPercent: Math.abs(fracFirstGame - fracFirstIndependent),
    conservation: Math.abs(o.volumePos + o.volumeNeg - o.totalVolume) / o.totalVolume,
    totalWorldVsLocal: volAll / (o.totalVolume * M.getMaxScaleOnAxis() ** 3),
    capLoops: o.result.loopCount,
    maxLinePx,
  };
}
