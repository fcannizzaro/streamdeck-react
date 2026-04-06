import {
  defineAction,
  useAction,
  useChannel,
  useDialRotate,
  useDialDown,
  useDialHint,
  ProgressBar,
  tw,
} from "@fcannizzaro/streamdeck-react";
import {
  SHAPES,
  SHAPE_CONFIGS,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_DEPTH,
  DEFAULT_ROTATE,
  MIN_DIM,
  MAX_DIM,
  MAX_ROTATE,
  DIM_STEP,
  ROTATE_STEP,
} from "../params";
import type { ShapeName } from "../params";
import { ShapePreview } from "../shapes";

// ── Shape Dial ──────────────────────────────────────────────────────
//
// Encoder action for the 3D Shape Editor.  Behavior by column:
//
//   Column 0 — SHAPE:  rotate to cycle through shape types
//   Columns 1-3 — controlled by the `dialMode` channel:
//
//     "dimension" mode (default):
//       Col 1 = WIDTH, Col 2 = HEIGHT, Col 3 = DEPTH
//
//     "rotation" mode (toggled by pressing any of dials 1-3):
//       Col 1 = ROT X, Col 2 = ROT Y, Col 3 = ROT Z
//
// The `dialMode` channel is global — pressing any dial toggles ALL
// three parameter dials between dimension and rotation modes.

type DialMode = "dimension" | "rotation";

// ── Shape Selector (column 0) ───────────────────────────────────────

function ShapeSelector() {
  const [activeId] = useChannel<string | null>("activeId", null);
  const [shape, setShape] = useChannel<ShapeName>(
    activeId ? `${activeId}:shape` : "__idle__",
    "box",
  );
  const [width] = useChannel<number>(activeId ? `${activeId}:width` : "__idle_w__", DEFAULT_WIDTH);
  const [height] = useChannel<number>(
    activeId ? `${activeId}:height` : "__idle_h__",
    DEFAULT_HEIGHT,
  );
  const [depth] = useChannel<number>(activeId ? `${activeId}:depth` : "__idle_d__", DEFAULT_DEPTH);
  const [rotateX] = useChannel<number>(
    activeId ? `${activeId}:rotateX` : "__idle_rx__",
    DEFAULT_ROTATE,
  );
  const [rotateY] = useChannel<number>(
    activeId ? `${activeId}:rotateY` : "__idle_ry__",
    DEFAULT_ROTATE,
  );
  const [rotateZ] = useChannel<number>(
    activeId ? `${activeId}:rotateZ` : "__idle_rz__",
    DEFAULT_ROTATE,
  );

  const config = SHAPE_CONFIGS[shape];

  useDialHint({
    rotate: activeId ? "Change shape" : "",
  });

  useDialRotate(({ ticks }) => {
    if (!activeId) return;
    const idx = SHAPES.indexOf(shape);
    const next = (idx + ticks + SHAPES.length) % SHAPES.length;
    setShape(SHAPES[next]!);
  });

  if (!activeId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-[#0a0a0a]">
        <span className="text-white/10 text-[14px]">{"\u2014"}</span>
      </div>
    );
  }

  return (
    <div
      className={tw(
        "flex flex-row items-center justify-center w-full h-full gap-2",
        `bg-[${config.color}15]`,
      )}
    >
      <ShapePreview
        shape={shape}
        width={width}
        height={height}
        depth={depth}
        rotateX={rotateX}
        rotateY={rotateY}
        rotateZ={rotateZ}
        color={config.color}
        size={56}
      />
      <div className="flex flex-col items-start gap-0.5">
        <span className="text-white/40 text-[7px] font-medium tracking-[0.15em]">SHAPE</span>
        <span className={tw("text-[14px] font-bold", `text-[${config.color}]`)}>
          {config.label}
        </span>
      </div>
    </div>
  );
}

// ── Parameter Dial (columns 1-3) ────────────────────────────────────
//
// Each dial switches between controlling a dimension (W/H/D) and a
// rotation axis (X/Y/Z) based on the `dialMode` channel.  Pressing
// ANY of the three dials toggles the mode for all of them.

interface ParamRole {
  dimLabel: string;
  dimSuffix: string;
  dimDefault: number;
  rotLabel: string;
  rotSuffix: string;
  rotDefault: number;
}

const PARAM_ROLES: ParamRole[] = [
  {
    dimLabel: "WIDTH",
    dimSuffix: "width",
    dimDefault: DEFAULT_WIDTH,
    rotLabel: "ROT X",
    rotSuffix: "rotateX",
    rotDefault: DEFAULT_ROTATE,
  },
  {
    dimLabel: "HEIGHT",
    dimSuffix: "height",
    dimDefault: DEFAULT_HEIGHT,
    rotLabel: "ROT Y",
    rotSuffix: "rotateY",
    rotDefault: DEFAULT_ROTATE,
  },
  {
    dimLabel: "DEPTH",
    dimSuffix: "depth",
    dimDefault: DEFAULT_DEPTH,
    rotLabel: "ROT Z",
    rotSuffix: "rotateZ",
    rotDefault: DEFAULT_ROTATE,
  },
];

function createParamDial(role: ParamRole) {
  return function ParamDial() {
    const [activeId] = useChannel<string | null>("activeId", null);
    const [mode, setMode] = useChannel<DialMode>("dialMode", "dimension");

    const [shape] = useChannel<ShapeName>(activeId ? `${activeId}:shape` : "__idle__", "box");

    // Dimension channel
    const [dimValue, setDimValue] = useChannel<number>(
      activeId ? `${activeId}:${role.dimSuffix}` : "__idle_dim__",
      role.dimDefault,
    );

    // Rotation channel
    const [rotValue, setRotValue] = useChannel<number>(
      activeId ? `${activeId}:${role.rotSuffix}` : "__idle_rot__",
      role.rotDefault,
    );

    const shapeConfig = SHAPE_CONFIGS[shape];
    const isRotation = mode === "rotation";
    const label = isRotation ? role.rotLabel : role.dimLabel;
    const value = isRotation ? rotValue : dimValue;
    const max = isRotation ? MAX_ROTATE : MAX_DIM;

    useDialHint({
      rotate: activeId ? `Adjust ${label.toLowerCase()}` : "",
      press: activeId ? (isRotation ? "Switch to dimensions" : "Switch to rotation") : "",
    });

    // ── Press to toggle mode ────────────────────────────────────
    useDialDown(() => {
      if (!activeId) return;
      setMode(isRotation ? "dimension" : "rotation");
    });

    // ── Rotate to adjust value ──────────────────────────────────
    useDialRotate(({ ticks }) => {
      if (!activeId) return;
      if (isRotation) {
        // Rotation wraps around 0–360
        setRotValue((((rotValue + ticks * ROTATE_STEP) % MAX_ROTATE) + MAX_ROTATE) % MAX_ROTATE);
      } else {
        // Dimensions clamp
        setDimValue(Math.max(MIN_DIM, Math.min(MAX_DIM, dimValue + ticks * DIM_STEP)));
      }
    });

    if (!activeId) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full bg-[#0a0a0a]">
          <span className="text-white/10 text-[14px]">{"\u2014"}</span>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center w-full h-full bg-[#111] gap-1.5 p-2">
        <span
          className={tw(
            "text-[8px] font-medium tracking-[0.15em]",
            isRotation ? "text-[#f59e0b]/60" : "text-white/40",
          )}
        >
          {label}
        </span>
        <span className={tw("text-[20px] font-bold", `text-[${shapeConfig.color}]`)}>
          {isRotation ? `${value}\u00B0` : value}
        </span>
        <ProgressBar
          value={value}
          max={max}
          height={4}
          color={isRotation ? "#f59e0b" : shapeConfig.color}
          background="#333"
          borderRadius={2}
        />
      </div>
    );
  };
}

// ── Action Definition ───────────────────────────────────────────────

const Dial1 = createParamDial(PARAM_ROLES[0]!);
const Dial2 = createParamDial(PARAM_ROLES[1]!);
const Dial3 = createParamDial(PARAM_ROLES[2]!);

const DIAL_COMPONENTS = [ShapeSelector, Dial1, Dial2, Dial3];

function ShapeDial() {
  const action = useAction();
  const column = action.coordinates?.column ?? 0;
  const Component = DIAL_COMPONENTS[column] ?? ShapeSelector;
  return <Component />;
}

export const shapeDialAction = defineAction({
  uuid: "com.example.react-coordinator.shape-dial",
  dial: ShapeDial,
  info: {
    name: "Shape Dial",
    icon: "imgs/actions/dial",
    tooltip:
      "Controls 3D shape properties. Dial 0: shape type, Dial 1-3: width/height/depth or rotation X/Y/Z. Press dials to toggle mode.",
    encoder: {
      layout: "$A0",
      triggerDescription: {
        rotate: "Adjust shape / dimensions",
        push: "Toggle dimension / rotation mode",
      },
    },
  },
});
