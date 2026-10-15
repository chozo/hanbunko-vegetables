// 閉じた三角形メッシュを平面で二つに切る。
// 体積は切断で生じた表面三角形だけから厳密に求める（平面上の点を頂点とする四面体の和。断面は平面上にあるので寄与 0）。
// 断面（キャップ）は交線のループを三角形分割して作り、表示とパーティクルの発生位置に使う。

import { ShapeUtils, Vector2 } from 'three';
import type { MeshData, Vec3 } from './mesh';

/** n·p + c = 0 （n は単位ベクトル）。n の向きの側を「正側」と呼ぶ */
export interface PlaneDef {
  n: Vec3;
  c: number;
}

export interface CapData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface CutSide {
  surface: MeshData;
  cap: CapData;
  /** 切断平面の片側にある体積（倍精度で計算） */
  volume: number;
  /** この側に表面三角形があるか */
  empty: boolean;
}

export interface CutResult {
  pos: CutSide;
  neg: CutSide;
  /** 断面の 2D 座標系：点 = origin + u*X + w*Y */
  origin: Vec3;
  u: Vec3;
  w: Vec3;
  /** 断面の 2D 範囲（キャップの UV はこの範囲で 0..1） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** 断面ループの数（ピーマンの輪切りなら外周と空洞の数） */
  loopCount: number;
  /** 断面の総面積 */
  capArea: number;
}

const EPS = 1e-9;

class SideBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vol = 0;
  readonly map: Int32Array;
  readonly interMap = new Map<number, number>();
  constructor(nVerts: number) {
    this.map = new Int32Array(nVerts).fill(-1);
  }
  push(p: ArrayLike<number>, po: number, n: ArrayLike<number>, no: number, c: ArrayLike<number>, co: number): number {
    const id = this.pos.length / 3;
    this.pos.push(p[po], p[po + 1], p[po + 2]);
    this.nor.push(n[no], n[no + 1], n[no + 2]);
    this.col.push(c[co], c[co + 1], c[co + 2]);
    return id;
  }
}

export function cutMesh(mesh: MeshData, plane: PlaneDef, makeCaps = true): CutResult {
  const P = mesh.positions, N = mesh.normals, C = mesh.colors, I = mesh.indices;
  const nv = P.length / 3;
  const [nx, ny, nz] = plane.n;
  const ox = -plane.c * nx, oy = -plane.c * ny, oz = -plane.c * nz;

  const d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    let v = nx * P[i * 3] + ny * P[i * 3 + 1] + nz * P[i * 3 + 2] + plane.c;
    if (Math.abs(v) < EPS) v = EPS; // 平面上の頂点は正側に寄せて退化を避ける
    d[i] = v;
  }

  // 交点（元メッシュの辺上）。隣り合う三角形で同じ点を共有するため辺キーで管理する
  const interPos: number[] = [];
  const interNor: number[] = [];
  const interCol: number[] = [];
  const edgeMap = new Map<number, number>();
  const interOf = (a: number, b: number): number => {
    const key = a < b ? a * nv + b : b * nv + a;
    const hit = edgeMap.get(key);
    if (hit !== undefined) return hit;
    const t = d[a] / (d[a] - d[b]);
    const id = interPos.length / 3;
    for (let k = 0; k < 3; k++) {
      interPos.push(P[a * 3 + k] + (P[b * 3 + k] - P[a * 3 + k]) * t);
      interNor.push(N[a * 3 + k] + (N[b * 3 + k] - N[a * 3 + k]) * t);
      interCol.push(C[a * 3 + k] + (C[b * 3 + k] - C[a * 3 + k]) * t);
    }
    const l = Math.hypot(interNor[id * 3], interNor[id * 3 + 1], interNor[id * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) interNor[id * 3 + k] /= l;
    edgeMap.set(key, id);
    return id;
  };

  const sides = [new SideBuilder(nv), new SideBuilder(nv)]; // 0: 正側, 1: 負側
  const vOrig = (s: SideBuilder, v: number) => {
    let id = s.map[v];
    if (id < 0) {
      id = s.push(P, v * 3, N, v * 3, C, v * 3);
      s.map[v] = id;
    }
    return id;
  };
  const vInter = (s: SideBuilder, k: number) => {
    let id = s.interMap.get(k);
    if (id === undefined) {
      id = s.push(interPos, k * 3, interNor, k * 3, interCol, k * 3);
      s.interMap.set(k, id);
    }
    return id;
  };
  // 頂点の座標（倍精度）。>=0 は元の頂点、<0 は交点 -(k+1)
  const coord = (ref: number, out: number[], o: number) => {
    if (ref >= 0) {
      out[o] = P[ref * 3] - ox;
      out[o + 1] = P[ref * 3 + 1] - oy;
      out[o + 2] = P[ref * 3 + 2] - oz;
    } else {
      const k = -ref - 1;
      out[o] = interPos[k * 3] - ox;
      out[o + 1] = interPos[k * 3 + 1] - oy;
      out[o + 2] = interPos[k * 3 + 2] - oz;
    }
  };
  const tmp = new Array(9).fill(0);
  const emit = (si: number, a: number, b: number, c: number) => {
    const s = sides[si];
    const ia = a >= 0 ? vOrig(s, a) : vInter(s, -a - 1);
    const ib = b >= 0 ? vOrig(s, b) : vInter(s, -b - 1);
    const ic = c >= 0 ? vOrig(s, c) : vInter(s, -c - 1);
    s.idx.push(ia, ib, ic);
    coord(a, tmp, 0);
    coord(b, tmp, 3);
    coord(c, tmp, 6);
    s.vol +=
      (tmp[0] * (tmp[4] * tmp[8] - tmp[5] * tmp[7]) -
        tmp[1] * (tmp[3] * tmp[8] - tmp[5] * tmp[6]) +
        tmp[2] * (tmp[3] * tmp[7] - tmp[4] * tmp[6])) /
      6;
  };

  // 正側キャップの境界辺（交点番号 → 交点番号）
  const capNext = new Map<number, number>();

  for (let t = 0; t < I.length; t += 3) {
    const v0 = I[t], v1 = I[t + 1], v2 = I[t + 2];
    const s0 = d[v0] > 0, s1 = d[v1] > 0, s2 = d[v2] > 0;
    if (s0 === s1 && s1 === s2) {
      emit(s0 ? 0 : 1, v0, v1, v2);
      continue;
    }
    // 孤立した頂点を先頭にそろえる（巻き順は保つ）
    let a: number, b: number, c: number;
    if (s0 !== s1 && s0 !== s2) [a, b, c] = [v0, v1, v2];
    else if (s1 !== s0 && s1 !== s2) [a, b, c] = [v1, v2, v0];
    else [a, b, c] = [v2, v0, v1];
    const lonePos = d[a] > 0;
    const i1 = interOf(a, b), i2 = interOf(c, a);
    const r1 = -i1 - 1, r2 = -i2 - 1;
    const lone = lonePos ? 0 : 1, other = lonePos ? 1 : 0;
    emit(lone, a, r1, r2);
    emit(other, r1, b, c);
    emit(other, r1, c, r2);
    // 正側の表面境界辺を逆向きにしたものが正側キャップの境界辺
    if (lonePos) capNext.set(i2, i1);
    else capNext.set(i1, i2);
  }

  // 断面の座標系：u × w = -n（正側キャップの外向き法線が -n）
  const helper: Vec3 = Math.abs(nx) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  let u: Vec3 = [ny * helper[2] - nz * helper[1], nz * helper[0] - nx * helper[2], nx * helper[1] - ny * helper[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w: Vec3 = [u[1] * nz - u[2] * ny, u[2] * nx - u[0] * nz, u[0] * ny - u[1] * nx];

  const loops: number[][] = [];
  const visited = new Set<number>();
  for (const start of capNext.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let cur: number | undefined = start;
    let guard = 0;
    while (cur !== undefined && !visited.has(cur) && guard++ < 1e6) {
      visited.add(cur);
      loop.push(cur);
      cur = capNext.get(cur);
    }
    if (loop.length >= 3) loops.push(loop);
  }

  const to2D = (k: number): Vector2 => {
    const x = interPos[k * 3] - ox, y = interPos[k * 3 + 1] - oy, z = interPos[k * 3 + 2] - oz;
    return new Vector2(x * u[0] + y * u[1] + z * u[2], x * w[0] + y * w[1] + z * w[2]);
  };
  const loops2D = loops.map((l) => l.map(to2D));
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const l of loops2D)
    for (const p of l) {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  if (!loops.length) Object.assign(bounds, { minX: 0, minY: 0, maxX: 1, maxY: 1 });

  // 正側キャップの三角形（交点番号の三つ組）
  const capTris: number[] = [];
  let capArea = 0;
  if (makeCaps && loops.length) {
    const areas = loops2D.map((l) => ShapeUtils.area(l));
    capArea = Math.abs(areas.reduce((s, a) => s + a, 0));
    let maxI = 0;
    areas.forEach((a, i) => {
      if (Math.abs(a) > Math.abs(areas[maxI])) maxI = i;
    });
    const outerSign = Math.sign(areas[maxI]);
    const outers = loops.map((_, i) => i).filter((i) => Math.sign(areas[i]) === outerSign);
    const holes = loops.map((_, i) => i).filter((i) => Math.sign(areas[i]) !== outerSign);
    const holesOf = new Map<number, number[]>(outers.map((i) => [i, []]));
    for (const h of holes) {
      // 穴を含む最小の外周に割り当てる
      let best = -1;
      for (const o of outers) {
        if (pointInPolygon(loops2D[h][0], loops2D[o]) && (best < 0 || Math.abs(areas[o]) < Math.abs(areas[best]))) best = o;
      }
      if (best >= 0) holesOf.get(best)!.push(h);
    }
    for (const o of outers) {
      const hs = holesOf.get(o)!;
      const ids = [loops[o], ...hs.map((h) => loops[h])].flat();
      const pts2 = [loops2D[o], ...hs.map((h) => loops2D[h])].flat();
      const faces = ShapeUtils.triangulateShape(
        loops2D[o],
        hs.map((h) => loops2D[h]),
      );
      for (const f of faces) {
        let [a, b, c] = f;
        const pa = pts2[a], pb = pts2[b], pc = pts2[c];
        const cr = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
        if (cr < 0) [b, c] = [c, b]; // (u, w) 平面で反時計回り = 法線 -n
        capTris.push(ids[a], ids[b], ids[c]);
      }
    }
  }

  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const buildCap = (flip: boolean): CapData => {
    const used = new Map<number, number>();
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const vid = (k: number) => {
      let id = used.get(k);
      if (id === undefined) {
        id = pos.length / 3;
        used.set(k, id);
        pos.push(interPos[k * 3], interPos[k * 3 + 1], interPos[k * 3 + 2]);
        const p = to2D(k);
        uv.push((p.x - bounds.minX) / spanX, (p.y - bounds.minY) / spanY);
      }
      return id;
    };
    for (let t = 0; t < capTris.length; t += 3) {
      const a = vid(capTris[t]), b = vid(capTris[t + 1]), c = vid(capTris[t + 2]);
      if (flip) idx.push(a, c, b);
      else idx.push(a, b, c);
    }
    const nvc = pos.length / 3;
    const nor = new Float32Array(nvc * 3);
    const sgn = flip ? 1 : -1;
    for (let i = 0; i < nvc; i++) {
      nor[i * 3] = nx * sgn;
      nor[i * 3 + 1] = ny * sgn;
      nor[i * 3 + 2] = nz * sgn;
    }
    return { positions: new Float32Array(pos), normals: nor, uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
  };

  const finish = (s: SideBuilder, cap: CapData): CutSide => ({
    surface: {
      positions: new Float32Array(s.pos),
      normals: new Float32Array(s.nor),
      colors: new Float32Array(s.col),
      indices: new Uint32Array(s.idx),
    },
    cap,
    volume: s.vol,
    empty: s.idx.length === 0,
  });

  return {
    pos: finish(sides[0], buildCap(false)),
    neg: finish(sides[1], buildCap(true)),
    origin: [ox, oy, oz],
    u,
    w,
    bounds,
    loopCount: loops.length,
    capArea,
  };
}

function pointInPolygon(p: Vector2, poly: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
