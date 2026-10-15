// 光の演出：パーティクル、刃の軌跡（リボン）、光の輪
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';

export class Particles {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private alive = 0;
  readonly material: ShaderMaterial;

  constructor(readonly capacity: number) {
    const g = new BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const attr = (a: Float32Array, n: number) => new BufferAttribute(a, n).setUsage(DynamicDrawUsage);
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('aColor', attr(this.col, 3));
    g.setAttribute('aAlpha', attr(this.alpha, 1));
    g.setAttribute('aSize', attr(this.size, 1));
    this.material = new ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / -mv.z : 0.0;
          vColor = aColor; vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float core = exp(-r * r * 9.0);
          float halo = (1.0 - r) * (1.0 - r);
          gl_FragColor = vec4(vColor * (core * 1.6 + halo * 0.6), vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  spawn(p: Vector3, v: Vector3, color: Color, size: number, life: number, grav = 0, drag = 1.5): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.alive = this.capacity;
  }

  update(dt: number): void {
    if (!this.alive) return;
    let any = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      any++;
      const k = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr;
      this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
      this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.5);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    if (!any) this.alive = 0;
    const g = this.points.geometry;
    for (const n of ['position', 'aColor', 'aAlpha', 'aSize']) g.getAttribute(n).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.alive = 1;
  }
}

export interface RibbonPoint {
  x: number;
  y: number;
  /** 半幅（CSS px） */
  w: number;
  /** 0..1 */
  a: number;
}

/** 画面座標の折れ線を、カメラ手前の平面に光る帯として描く */
export class Ribbon {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly posArr: Float32Array;
  private readonly sideArr: Float32Array;
  private readonly alongArr: Float32Array;
  private readonly alphaArr: Float32Array;
  private readonly geo: BufferGeometry;

  constructor(readonly maxPoints: number, core: Color, edge: Color, dashed = false) {
    const g = new BufferGeometry();
    this.posArr = new Float32Array(maxPoints * 2 * 3);
    this.sideArr = new Float32Array(maxPoints * 2);
    this.alongArr = new Float32Array(maxPoints * 2);
    this.alphaArr = new Float32Array(maxPoints * 2);
    g.setAttribute('position', new BufferAttribute(this.posArr, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aSide', new BufferAttribute(this.sideArr, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aAlong', new BufferAttribute(this.alongArr, 1).setUsage(DynamicDrawUsage));
    g.setAttribute('aAlpha', new BufferAttribute(this.alphaArr, 1).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.material = new ShaderMaterial({
      uniforms: {
        uCore: { value: core.clone() },
        uEdge: { value: edge.clone() },
        uIntensity: { value: 1 },
        uDash: { value: dashed ? 1 : 0 },
        uDashCount: { value: 18 },
        uCoreWidth: { value: 10 },
      },
      vertexShader: /* glsl */ `
        attribute float aSide; attribute float aAlong; attribute float aAlpha;
        varying float vSide; varying float vAlong; varying float vAlpha;
        void main() {
          vSide = aSide; vAlong = aAlong; vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCore; uniform vec3 uEdge; uniform float uIntensity;
        uniform float uDash; uniform float uDashCount; uniform float uCoreWidth;
        varying float vSide; varying float vAlong; varying float vAlpha;
        void main() {
          float s = abs(vSide);
          float core = exp(-s * s * uCoreWidth);
          float glow = (1.0 - s) * (1.0 - s);
          vec3 col = uEdge * glow + uCore * core;
          float dash = mix(1.0, step(0.45, fract(vAlong * uDashCount)), uDash);
          gl_FragColor = vec4(col, vAlpha * uIntensity * dash);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** toWorld は画面座標（CSS px）をワールド座標に直す関数 */
  set(points: RibbonPoint[], toWorld: (x: number, y: number) => Vector3): void {
    const n = Math.min(points.length, this.maxPoints);
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    let total = 0;
    const lens = [0];
    for (let i = 1; i < n; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lens.push(total);
    }
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const nx = -dy * p.w, ny = dx * p.w;
      const L = toWorld(p.x + nx, p.y + ny);
      const R = toWorld(p.x - nx, p.y - ny);
      this.posArr.set([L.x, L.y, L.z, R.x, R.y, R.z], i * 6);
      this.sideArr[i * 2] = -1;
      this.sideArr[i * 2 + 1] = 1;
      const along = total > 0 ? lens[i] / total : 0;
      this.alongArr[i * 2] = this.alongArr[i * 2 + 1] = along;
      this.alphaArr[i * 2] = this.alphaArr[i * 2 + 1] = p.a;
    }
    for (const k of ['position', 'aSide', 'aAlong', 'aAlpha']) this.geo.getAttribute(k).needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  hide(): void {
    this.geo.setDrawRange(0, 0);
  }
}

/** 成功時に広がる光の輪 */
export class RingFx {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  age = Infinity;
  duration = 1.1;
  delay = 0;
  maxScale = 3;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(1, 1, 1) }, uFade: { value: 0 }, uThick: { value: 0.06 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFade; uniform float uThick;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float d = abs(r - 0.9) / uThick;
          float a = exp(-d * d) + 0.35 * exp(-d * d * 0.08) * (1.0 - smoothstep(0.85, 1.0, r));
          gl_FragColor = vec4(uColor * a, a * uFade);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  start(color: Color, delay: number, maxScale: number): void {
    this.material.uniforms.uColor.value.copy(color);
    this.age = -delay;
    this.maxScale = maxScale;
  }

  update(dt: number): void {
    if (this.age === Infinity) return;
    this.age += dt;
    if (this.age < 0) {
      this.mesh.visible = false;
      return;
    }
    const t = this.age / this.duration;
    if (t >= 1) {
      this.mesh.visible = false;
      this.age = Infinity;
      return;
    }
    const e = 1 - (1 - t) ** 3;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(0.4 + e * this.maxScale);
    this.material.uniforms.uFade.value = (1 - t) ** 1.5 * 1.6;
    this.material.uniforms.uThick.value = 0.05 + 0.08 * t;
  }
}
