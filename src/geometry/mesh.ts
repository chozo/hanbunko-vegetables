// 野菜の形状データ。表示・切断・体積計算はすべてこの閉じた三角形メッシュを共有する。

export interface MeshData {
  /** 頂点座標（野菜のローカル座標） */
  positions: Float32Array;
  normals: Float32Array;
  /** 頂点色（リニア RGB） */
  colors: Float32Array;
  /** 三角形（反時計回りが外向き）。頂点は共有されており、メッシュは閉じている */
  indices: Uint32Array;
}

export type Vec3 = [number, number, number];

/**
 * リング状に並んだ頂点と両端の極からなる閉じたメッシュを作る。
 * 球・回転体・チューブ（バナナや枝）すべてをこの形で作るので、継ぎ目のない多様体になる。
 */
export function buildRings(
  nRings: number,
  nSeg: number,
  ringPoint: (i: number, j: number) => Vec3,
  poleA: Vec3,
  poleB: Vec3,
): MeshData {
  const nv = 2 + nRings * nSeg;
  const positions = new Float32Array(nv * 3);
  positions.set(poleA, 0);
  for (let i = 0; i < nRings; i++) {
    for (let j = 0; j < nSeg; j++) {
      positions.set(ringPoint(i, j), (1 + i * nSeg + j) * 3);
    }
  }
  positions.set(poleB, (nv - 1) * 3);
  const idx: number[] = [];
  const r = (i: number, j: number) => 1 + i * nSeg + (j % nSeg);
  for (let j = 0; j < nSeg; j++) idx.push(0, r(0, j), r(0, j + 1));
  for (let i = 0; i < nRings - 1; i++) {
    for (let j = 0; j < nSeg; j++) {
      idx.push(r(i, j + 1), r(i, j), r(i + 1, j));
      idx.push(r(i, j + 1), r(i + 1, j), r(i + 1, j + 1));
    }
  }
  for (let j = 0; j < nSeg; j++) idx.push(nv - 1, r(nRings - 1, j + 1), r(nRings - 1, j));
  const mesh: MeshData = {
    positions,
    normals: new Float32Array(nv * 3),
    colors: new Float32Array(nv * 3).fill(1),
    indices: new Uint32Array(idx),
  };
  if (signedVolume(mesh) < 0) flipWinding(mesh);
  computeNormals(mesh);
  return mesh;
}

export function flipWinding(mesh: MeshData): void {
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t + 1];
    ix[t + 1] = ix[t + 2];
    ix[t + 2] = a;
  }
}

/** 面積で重み付けした頂点法線 */
export function computeNormals(mesh: MeshData): void {
  const p = mesh.positions;
  const n = mesh.normals;
  n.fill(0);
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l;
    n[k + 1] /= l;
    n[k + 2] /= l;
  }
}

/** 発散定理による閉じたメッシュの体積（原点を頂点とする四面体の符号付き体積の和） */
export function signedVolume(mesh: { positions: ArrayLike<number>; indices: ArrayLike<number> }): number {
  const p = mesh.positions;
  const ix = mesh.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    v += tetVolume(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
  }
  return v;
}

export function tetVolume(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
}

export function mergeMeshes(list: MeshData[]): MeshData {
  let nv = 0, ni = 0;
  for (const m of list) {
    nv += m.positions.length / 3;
    ni += m.indices.length;
  }
  const out: MeshData = {
    positions: new Float32Array(nv * 3),
    normals: new Float32Array(nv * 3),
    colors: new Float32Array(nv * 3),
    indices: new Uint32Array(ni),
  };
  let vo = 0, io = 0;
  for (const m of list) {
    out.positions.set(m.positions, vo * 3);
    out.normals.set(m.normals, vo * 3);
    out.colors.set(m.colors, vo * 3);
    for (let k = 0; k < m.indices.length; k++) out.indices[io + k] = m.indices[k] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return out;
}

/** 頂点ごとに色を塗る。fn は位置・法線・頂点番号を受け取り RGB(0..1, sRGB) を返す */
export function paint(mesh: MeshData, fn: (p: Vec3, n: Vec3, i: number) => Vec3): void {
  const p = mesh.positions, n = mesh.normals, c = mesh.colors;
  for (let i = 0; i < p.length / 3; i++) {
    const k = i * 3;
    const rgb = fn([p[k], p[k + 1], p[k + 2]], [n[k], n[k + 1], n[k + 2]], i);
    c[k] = srgbToLinear(rgb[0]);
    c[k + 1] = srgbToLinear(rgb[1]);
    c[k + 2] = srgbToLinear(rgb[2]);
  }
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 曲線に沿ったチューブ（枝・ヘタの軸など）。両端は少し丸めた極で閉じる。
 * path(t) は t∈[0,1] の中心線、radius(t) は太さ。
 */
export function buildTube(
  path: (t: number) => Vec3,
  radius: (t: number) => number,
  nRings = 10,
  nSeg = 8,
): MeshData {
  const frames: { c: Vec3; u: Vec3; v: Vec3; t: Vec3 }[] = [];
  for (let i = 0; i < nRings; i++) {
    const t = i / (nRings - 1);
    const c = path(t);
    const a = path(Math.max(0, t - 0.01));
    const b = path(Math.min(1, t + 0.01));
    const tan = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const helper: Vec3 = Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(tan, helper));
    const v = cross(tan, u);
    frames.push({ c, u, v, t: tan });
  }
  const f0 = frames[0], f1 = frames[nRings - 1];
  const r0 = radius(0), r1 = radius(1);
  return buildRings(
    nRings,
    nSeg,
    (i, j) => {
      const f = frames[i];
      const r = radius(i / (nRings - 1));
      const a = (j / nSeg) * Math.PI * 2;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      return [f.c[0] + f.u[0] * ca + f.v[0] * sa, f.c[1] + f.u[1] * ca + f.v[1] * sa, f.c[2] + f.u[2] * ca + f.v[2] * sa];
    },
    [f0.c[0] - f0.t[0] * r0 * 0.6, f0.c[1] - f0.t[1] * r0 * 0.6, f0.c[2] - f0.t[2] * r0 * 0.6],
    [f1.c[0] + f1.t[0] * r1 * 0.6, f1.c[1] + f1.t[1] * r1 * 0.6, f1.c[2] + f1.t[2] * r1 * 0.6],
  );
}

/**
 * 中心から見て星形（どの方向にも表面が一度だけある）の立体。
 * radiusFn(方向) で半径を決め、最後に 3x3 行列 m（行優先）と平行移動 offset をかける。
 * 同じ定義から「点が表面からどれだけ内側か」を逆算できるので、断面の模様もこの形に一致する。
 */
export class StarShape {
  readonly inv: number[];
  constructor(
    readonly radiusFn: (dx: number, dy: number, dz: number) => number,
    readonly m: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1],
    readonly offset: Vec3 = [0, 0, 0],
  ) {
    this.inv = invert3(m);
  }

  surfacePoint(dx: number, dy: number, dz: number): Vec3 {
    const r = this.radiusFn(dx, dy, dz);
    return this.apply([dx * r, dy * r, dz * r]);
  }

  apply(q: Vec3): Vec3 {
    const m = this.m;
    return [
      m[0] * q[0] + m[1] * q[1] + m[2] * q[2] + this.offset[0],
      m[3] * q[0] + m[4] * q[1] + m[5] * q[2] + this.offset[1],
      m[6] * q[0] + m[7] * q[1] + m[8] * q[2] + this.offset[2],
    ];
  }

  /** 変形前の座標（単位球空間）に戻す */
  toShapeSpace(x: number, y: number, z: number): Vec3 {
    const i = this.inv;
    x -= this.offset[0];
    y -= this.offset[1];
    z -= this.offset[2];
    return [i[0] * x + i[1] * y + i[2] * z, i[3] * x + i[4] * y + i[5] * z, i[6] * x + i[7] * y + i[8] * z];
  }

  /** 中心 0、表面 1 となる正規化深さ（表面より外は 1 超） */
  depth(x: number, y: number, z: number): number {
    const q = this.toShapeSpace(x, y, z);
    const l = Math.hypot(q[0], q[1], q[2]);
    if (l < 1e-9) return 0;
    return l / this.radiusFn(q[0] / l, q[1] / l, q[2] / l);
  }

  /** thMap: 0..1 を 0..1 へ写す単調な関数。極の近くに輪を集めたいときに使う */
  build(nSeg: number, nRings: number, thMap: (u: number) => number = (u) => u): MeshData {
    return buildRings(
      nRings - 1,
      nSeg,
      (i, j) => {
        const th = Math.PI * thMap((i + 1) / nRings);
        const ph = (2 * Math.PI * j) / nSeg;
        return this.surfacePoint(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      },
      this.surfacePoint(0, 1, 0),
      this.surfacePoint(0, -1, 0),
    );
  }
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/** 3x3 行列（行優先）の積 */
export function mul3(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function rotY3(a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotX3(a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotZ3(a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
export function scale3(x: number, y: number, z: number): number[] {
  return [x, 0, 0, 0, y, 0, 0, 0, z];
}

/** メッシュを 3x3 行列（行優先）と平行移動で変換する（法線は逆転置で変換） */
export function transformMesh(mesh: MeshData, m: number[], offset: Vec3 = [0, 0, 0]): MeshData {
  const p = mesh.positions, n = mesh.normals;
  const inv = invert3(m);
  const out: MeshData = { positions: new Float32Array(p.length), normals: new Float32Array(n.length), colors: mesh.colors.slice(), indices: mesh.indices.slice() };
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out.positions[i] = m[0] * x + m[1] * y + m[2] * z + offset[0];
    out.positions[i + 1] = m[3] * x + m[4] * y + m[5] * z + offset[1];
    out.positions[i + 2] = m[6] * x + m[7] * y + m[8] * z + offset[2];
    const nx = n[i], ny = n[i + 1], nz = n[i + 2];
    // (M^-1)^T · n
    const tx = inv[0] * nx + inv[3] * ny + inv[6] * nz;
    const ty = inv[1] * nx + inv[4] * ny + inv[7] * nz;
    const tz = inv[2] * nx + inv[5] * ny + inv[8] * nz;
    const l = Math.hypot(tx, ty, tz) || 1;
    out.normals[i] = tx / l;
    out.normals[i + 1] = ty / l;
    out.normals[i + 2] = tz / l;
  }
  if (signedVolume(out) < 0) flipWinding(out);
  return out;
}
