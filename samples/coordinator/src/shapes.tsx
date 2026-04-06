import type { CSSProperties, ReactElement } from "react";
import type { ShapeName } from "./params";
import { MIN_DIM, MAX_DIM } from "./params";

// ── 3D Shape Renderer ───────────────────────────────────────────────
//
// True 3D rendering pipeline (no fake scaling):
//
//   1. Define meshes as 3D vertices + polygon faces
//   2. Apply rotation matrices  Rx → Ry → Rz
//   3. Orthographic projection  (x, y, z) → (x, y)
//   4. Backface culling         discard rear-facing polygons
//   5. Lambertian lighting      shade each face by angle to light
//   6. Painter's algorithm      draw far faces first
//   7. Emit SVG <polygon> elements
//
// Coordinate system: Y-down (matches SVG), +Z towards the viewer.

// ── Types ───────────────────────────────────────────────────────────

type V3 = [number, number, number];
type V2 = [number, number];

// ── Constants ───────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

// Light direction: upper-left, towards viewer
const LIGHT: V3 = (() => {
  const l: V3 = [-0.35, -0.65, 0.65];
  const m = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
  return [l[0] / m, l[1] / m, l[2] / m] as V3;
})();

// ── Color ───────────────────────────────────────────────────────────

function shade(hex: string, f: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${c(r * f)
    .toString(16)
    .padStart(2, "0")}${c(g * f)
    .toString(16)
    .padStart(2, "0")}${c(b * f)
    .toString(16)
    .padStart(2, "0")}`;
}

// ── Dimension mapping (10–100 → 3D units) ───────────────────────────

function t(v: number): number {
  return (v - MIN_DIM) / (MAX_DIM - MIN_DIM);
}

function lerp(n: number, a: number, b: number): number {
  return a + n * (b - a);
}

function dim(v: number): number {
  return lerp(t(v), 10, 32);
}

// ── 3D Math ─────────────────────────────────────────────────────────

function rx(v: V3, a: number): V3 {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function ry(v: V3, a: number): V3 {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rz(v: V3, a: number): V3 {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

function rot(v: V3, ax: number, ay: number, az: number): V3 {
  return rz(ry(rx(v, ax), ay), az);
}

function cross(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function normalize(v: V3): V3 {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return m === 0 ? [0, 0, 1] : [v[0] / m, v[1] / m, v[2] / m];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ── Face type ───────────────────────────────────────────────────────

interface Face {
  v: V3[];
  c: string;
}

// ── Rendering pipeline ──────────────────────────────────────────────

interface Poly {
  pts: string;
  fill: string;
}

function renderMesh(
  faces: Face[],
  rotX: number,
  rotY: number,
  rotZ: number,
): { polys: Poly[]; radius: number } {
  const ax = rotX * DEG,
    ay = rotY * DEG,
    az = rotZ * DEG;
  const sorted: { pts: string; fill: string; z: number }[] = [];
  let maxR = 0;

  for (const face of faces) {
    const rv = face.v.map((v) => rot(v, ax, ay, az));
    const pv: V2[] = rv.map((v) => [v[0], v[1]]);

    // Backface culling — positive winding = front-facing (Y-down + Z-towards)
    if (pv.length >= 3) {
      const [a, b, c] = [pv[0]!, pv[1]!, pv[2]!];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 0) continue;
    }

    // Per-face Lambertian lighting
    const n = normalize(cross(rv[0]!, rv[1]!, rv[2]!));
    const br = dot(n, LIGHT);
    const fill = shade(face.c, 0.35 + (br + 1) * 0.525);

    // Bounding radius
    for (const p of pv) {
      const d = Math.abs(p[0]) > Math.abs(p[1]) ? Math.abs(p[0]) : Math.abs(p[1]);
      if (d > maxR) maxR = d;
    }

    // Depth sort key
    let zSum = 0;
    for (const v of rv) zSum += v[2];

    sorted.push({
      pts: pv.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "),
      fill,
      z: zSum / rv.length,
    });
  }

  // Painter's algorithm: draw farthest first
  sorted.sort((a, b) => a.z - b.z);

  return {
    polys: sorted.map(({ pts, fill }) => ({ pts, fill })),
    radius: maxR,
  };
}

// ── Mesh generators ─────────────────────────────────────────────────

// ── Cube ────────────────────────────────────────────────────────────

function cubeMesh(w: number, h: number, d: number, color: string): Face[] {
  const hw = dim(w) / 2,
    hh = dim(h) / 2,
    hd = dim(d) / 2;
  // 8 vertices
  const p: V3[] = [
    [-hw, -hh, -hd],
    [hw, -hh, -hd],
    [hw, hh, -hd],
    [-hw, hh, -hd], // back
    [-hw, -hh, hd],
    [hw, -hh, hd],
    [hw, hh, hd],
    [-hw, hh, hd], // front
  ];
  // 6 faces — CCW winding when viewed from outside (Y-down, Z-towards)
  return [
    { v: [p[4]!, p[5]!, p[6]!, p[7]!], c: color }, // front  +Z
    { v: [p[1]!, p[0]!, p[3]!, p[2]!], c: color }, // back   -Z
    { v: [p[0]!, p[4]!, p[7]!, p[3]!], c: color }, // left   -X
    { v: [p[5]!, p[1]!, p[2]!, p[6]!], c: color }, // right  +X
    { v: [p[0]!, p[1]!, p[5]!, p[4]!], c: color }, // top    -Y
    { v: [p[7]!, p[6]!, p[2]!, p[3]!], c: color }, // bottom +Y
  ];
}

// ── Sphere (UV mesh) ────────────────────────────────────────────────

function sphereMesh(w: number, h: number, d: number, color: string): Face[] {
  const sx = dim(w) / 2,
    sy = dim(h) / 2,
    sz = dim(d) / 2;
  const NLAT = 7,
    NLON = 10;
  const faces: Face[] = [];

  for (let j = 0; j < NLAT; j++) {
    const p0 = (Math.PI * j) / NLAT,
      p1 = (Math.PI * (j + 1)) / NLAT;
    const sp0 = Math.sin(p0),
      cp0 = Math.cos(p0);
    const sp1 = Math.sin(p1),
      cp1 = Math.cos(p1);

    for (let i = 0; i < NLON; i++) {
      const t0 = (TAU * i) / NLON,
        t1 = (TAU * (i + 1)) / NLON;
      const ct0 = Math.cos(t0),
        st0 = Math.sin(t0);
      const ct1 = Math.cos(t1),
        st1 = Math.sin(t1);

      const v00: V3 = [sx * sp0 * ct0, -sy * cp0, sz * sp0 * st0];
      const v10: V3 = [sx * sp0 * ct1, -sy * cp0, sz * sp0 * st1];
      const v01: V3 = [sx * sp1 * ct0, -sy * cp1, sz * sp1 * st0];
      const v11: V3 = [sx * sp1 * ct1, -sy * cp1, sz * sp1 * st1];

      if (j === 0) {
        faces.push({ v: [v00, v01, v11], c: color });
      } else if (j === NLAT - 1) {
        faces.push({ v: [v00, v01, v10], c: color });
      } else {
        faces.push({ v: [v00, v01, v11, v10], c: color });
      }
    }
  }
  return faces;
}

// ── Cylinder ────────────────────────────────────────────────────────

function cylinderMesh(w: number, h: number, d: number, color: string): Face[] {
  const radX = dim(w) / 2,
    radZ = dim(d) / 2,
    hh = dim(h) / 2;
  const N = 14;
  const faces: Face[] = [];

  const top: V3[] = [],
    bot: V3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (TAU * i) / N;
    const cx = radX * Math.cos(a),
      cz = radZ * Math.sin(a);
    top.push([cx, -hh, cz]);
    bot.push([cx, hh, cz]);
  }

  // Side quads
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    faces.push({ v: [top[i]!, bot[i]!, bot[j]!, top[j]!], c: color });
  }
  // Top cap (normal → -Y = upward)
  faces.push({ v: [...top], c: color });
  // Bottom cap (reversed → normal +Y = downward)
  faces.push({ v: [...bot].reverse(), c: color });

  return faces;
}

// ── Cone ────────────────────────────────────────────────────────────

function coneMesh(w: number, h: number, d: number, color: string): Face[] {
  const radX = dim(w) / 2,
    radZ = dim(d) / 2,
    hh = dim(h) / 2;
  const N = 14;
  const faces: Face[] = [];
  const apex: V3 = [0, -hh, 0];

  const base: V3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (TAU * i) / N;
    base.push([radX * Math.cos(a), hh, radZ * Math.sin(a)]);
  }

  // Side triangles
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    faces.push({ v: [apex, base[i]!, base[j]!], c: color });
  }
  // Base cap (reversed → normal +Y = downward)
  faces.push({ v: [...base].reverse(), c: color });

  return faces;
}

// ── Torus ───────────────────────────────────────────────────────────

function torusMesh(w: number, h: number, d: number, color: string): Face[] {
  const R = lerp(t((w + h) / 2), 12, 24);
  const r = lerp(t(d), 3, 9);
  const NR = 14,
    NT = 8;
  const faces: Face[] = [];

  function vert(i: number, j: number): V3 {
    const theta = (TAU * i) / NR,
      phi = (TAU * j) / NT;
    const ct = Math.cos(theta),
      st = Math.sin(theta);
    const cp = Math.cos(phi),
      sp = Math.sin(phi);
    return [(R + r * cp) * ct, r * sp, (R + r * cp) * st];
  }

  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NT; j++) {
      faces.push({
        v: [vert(i, j), vert(i, j + 1), vert(i + 1, j + 1), vert(i + 1, j)],
        c: color,
      });
    }
  }
  return faces;
}

// ── Public Interface ────────────────────────────────────────────────

export interface ShapePreviewProps {
  shape: ShapeName;
  width: number;
  height: number;
  depth: number;
  color: string;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  size?: number;
  dimmed?: boolean;
}

export function ShapePreview({
  shape,
  width,
  height,
  depth,
  color,
  rotateX: rotXDeg = 0,
  rotateY: rotYDeg = 0,
  rotateZ: rotZDeg = 0,
  size = 80,
  dimmed,
}: ShapePreviewProps): ReactElement {
  const style: CSSProperties = dimmed ? { opacity: 0.35 } : {};

  // Generate mesh for the current shape
  let faces: Face[];
  switch (shape) {
    case "box":
      faces = cubeMesh(width, height, depth, color);
      break;
    case "sphere":
      faces = sphereMesh(width, height, depth, color);
      break;
    case "cylinder":
      faces = cylinderMesh(width, height, depth, color);
      break;
    case "cone":
      faces = coneMesh(width, height, depth, color);
      break;
    case "torus":
      faces = torusMesh(width, height, depth, color);
      break;
  }

  // Run 3D pipeline
  const { polys, radius } = renderMesh(faces, rotXDeg, rotYDeg, rotZDeg);
  const r = Math.ceil(radius) + 3;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-r} ${-r} ${r * 2} ${r * 2}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
    >
      {polys.map((p, i) => (
        <polygon key={i} points={p.pts} fill={p.fill} />
      ))}
    </svg>
  );
}
