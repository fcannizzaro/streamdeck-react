// ── 3D Shape Definitions ────────────────────────────────────────────
//
// Shared constants for the 3D Shape Editor coordinator sample.

export const SHAPES = ["box", "sphere", "cone", "cylinder", "torus"] as const;
export type ShapeName = (typeof SHAPES)[number];

export interface ShapeConfig {
  name: ShapeName;
  label: string;
  icon: string;
  color: string;
}

export const SHAPE_CONFIGS: Record<ShapeName, ShapeConfig> = {
  box: { name: "box", label: "BOX", icon: "\u25A3", color: "#6366f1" },
  sphere: { name: "sphere", label: "SPHERE", icon: "\u25CF", color: "#ec4899" },
  cone: { name: "cone", label: "CONE", icon: "\u25B2", color: "#f59e0b" },
  cylinder: { name: "cylinder", label: "CYL", icon: "\u25CE", color: "#10b981" },
  torus: { name: "torus", label: "TORUS", icon: "\u25C9", color: "#8b5cf6" },
};

// ── Dimension defaults ──────────────────────────────────────────────

export const DEFAULT_WIDTH = 50;
export const DEFAULT_HEIGHT = 50;
export const DEFAULT_DEPTH = 50;
export const MIN_DIM = 10;
export const MAX_DIM = 100;
export const DIM_STEP = 2;

// ── Rotation defaults ───────────────────────────────────────────────

export const DEFAULT_ROTATE = 0;
export const MAX_ROTATE = 360;
export const ROTATE_STEP = 5;

// ── Per-Key Settings ────────────────────────────────────────────────
//
// Persisted to the SDK via useSettings.  Survives plugin restart.
// Channels provide real-time cross-action communication; settings
// provide durability.

// Type alias (not interface) so it satisfies JsonObject's index signature
// constraint required by useSettings<S extends JsonObject>.
export type EditorSettings = {
  shape: ShapeName;
  width: number;
  height: number;
  depth: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
};

export const DEFAULT_SETTINGS: EditorSettings = {
  shape: "box",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  depth: DEFAULT_DEPTH,
  rotateX: DEFAULT_ROTATE,
  rotateY: DEFAULT_ROTATE,
  rotateZ: DEFAULT_ROTATE,
};
